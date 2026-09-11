// restaurant/usecases/discounts.ts — #215 (REST-13): descuentos y cortesías con motivo, permiso y tope.
//
// Antes no existía: "invitación de la casa", "10 % al huésped del hotel" o "el plato salió mal" se
// resolvían anulando la línea (desaparecía de la venta) o cobrando completo. Sin descuento con motivo
// tampoco hay control: una cortesía es indistinguible de un faltante de caja.
//
// Reglas:
//   - Dos niveles: LÍNEA (sobre `lineTotal`, bruto) y COMANDA (sobre la suma de líneas ya descontadas).
//     `percent` (0 < v ≤ 100; 100 = cortesía) o `amount` (monto fijo, recortado a la base). El cálculo
//     vive en order-totals.ts (`computeDiscountAmount` / `computeOrderTotals`): el impuesto se calcula
//     sobre el neto descontado, línea por línea con su tasa congelada.
//   - Motivo obligatorio (400 sin él). Predefinidos en configuration('restaurant_discount_reasons') +
//     texto libre; queda en la fila (`discountReason`) y en el audit log.
//   - Permiso `restaurant:discount` en la ruta (hotel_admin y receptionist por defecto; el mozo no).
//   - Tope: configuration('restaurant').maxDiscountPercent (default 20) para todo rol que no sea
//     hotel_admin/super_admin (sin tope). Se mide sobre el DESCUENTO EFECTIVO TOTAL de la comanda
//     (`computeEffectiveDiscount`: Σ descuentos de línea + descuento de comanda, en % del bruto) tal
//     como quedaría DESPUÉS de la operación — no sobre cada operación suelta: una línea al 20 % más
//     la comanda al 20 % dejan de cobrar el 36 % y un tope del 25 % frena la segunda aunque por sí sola
//     esté por debajo. Un monto fijo entra en la misma cuenta. Superarlo → 403 "supera el máximo
//     permitido (N %)" con el % total que quedaría. La cortesía (100 %) solo entra con un tope que la
//     habilite: hotel_admin/super_admin, o un hotel con maxDiscountPercent = 100.
//   - Una comanda `paid/charged/cancelled/processing_payment` no admite descuentos (LINES_LOCKED → 409,
//     misma regla que editar líneas). Una línea anulada tampoco.
//   - La línea con cortesía se MANTIENE en la venta (no es `voided`): el cierre del día (#213) la lista
//     en "Cortesías" con motivo y usuario a partir de `discountValue = 100`.
//   - Todo queda en `auditlog` vía connectors/restaurante-auditlog.ts: `restaurant.discount.applied` /
//     `restaurant.discount.removed` con alcance, monto, motivo y usuario.
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, CurrentUser, DiscountType } from '../types'
import type { RestaurantSockets } from '../sockets'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { round2 } from '../../../shared/utils/money'
import { recomputeTotals, computeOrderTotals, computeDiscountAmount, computeEffectiveDiscount, isLineActive } from './order-totals'
import { loadOrderForEdit } from './order-lines'
import { getReasonList, setReasonList, type ReasonListSpec, type VoidReasonsDeps } from './void-reasons'

export interface DiscountsDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  config: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  audit?: AuditPort | null
  logger?: Logger
  sockets?: RestaurantSockets
}

export interface DiscountInput { type?: string; value?: number; reason?: string }

/** Clave en `configuration` del tope por hotel: `{ maxDiscountPercent: number }` (se conservan otras claves del objeto). */
export const RESTAURANT_CONFIG_KEY = 'restaurant'
export const DEFAULT_MAX_DISCOUNT_PERCENT = 20
/** Roles sin tope (100 %): el dueño decide sobre su propia plata. Todo lo demás (receptionist, roles custom) usa el tope del hotel. */
const UNCAPPED_ROLES: readonly string[] = ['hotel_admin', 'super_admin']

export const DISCOUNT_REASONS_KEY = 'restaurant_discount_reasons'
export const DEFAULT_DISCOUNT_REASONS: readonly string[] = ['Cortesía de la casa', 'Huésped del hotel', 'Plato con demora o error', 'Promoción', 'Otro']
export const DISCOUNT_REASONS_SPEC: ReasonListSpec = { key: DISCOUNT_REASONS_KEY, defaults: DEFAULT_DISCOUNT_REASONS, description: 'Motivos de descuento del restaurante' }

const DISCOUNT_TYPES: readonly string[] = ['percent', 'amount']
const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger

const NO_DISCOUNT = { discountType: null, discountValue: null, discountReason: null, discountBy: null, discountAt: null }

interface ParsedDiscount { type: DiscountType; value: number; reason: string }

/** Valida tipo, valor y motivo (400). El schema ya tipó el body; acá van las reglas de negocio. */
export function parseDiscountInput(dto: DiscountInput): ParsedDiscount {
  const type = String(dto.type ?? '')
  if (!DISCOUNT_TYPES.includes(type)) throw new ValidationError('El tipo de descuento debe ser "percent" o "amount"')
  const value = Number(dto.value)
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError('El valor del descuento debe ser mayor que 0')
  if (type === 'percent' && value > 100) throw new ValidationError('Un descuento porcentual no puede superar el 100 %')
  const reason = String(dto.reason ?? '').trim()
  if (!reason) throw new ValidationError('Indicá el motivo del descuento')
  if (reason.length > 500) throw new ValidationError('El motivo no puede superar 500 caracteres')
  return { type: type as DiscountType, value: round2(value), reason }
}

/** Tope (%) que aplica a ESTE usuario en ESTE hotel. hotel_admin/super_admin: 100. Resto: configuration('restaurant').maxDiscountPercent o 20. */
export async function maxDiscountPercentFor(deps: Pick<DiscountsDeps, 'config'>, hotelId: string, user: CurrentUser): Promise<number> {
  if (UNCAPPED_ROLES.includes(String(user.role ?? ''))) return 100
  return readMaxDiscountPercent(deps, hotelId)
}

async function readMaxDiscountPercent(deps: Pick<DiscountsDeps, 'config'>, hotelId: string): Promise<number> {
  const row = await deps.config.findOne({ hotelId, key: RESTAURANT_CONFIG_KEY })
  const raw = row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? (row.value as Record<string, unknown>).maxDiscountPercent : undefined
  const n = Number(raw)
  if (raw !== undefined && raw !== null && Number.isFinite(n) && n >= 0 && n <= 100) return n
  return DEFAULT_MAX_DISCOUNT_PERCENT
}

/**
 * 403 si, con la operación aplicada, el descuento efectivo TOTAL de la comanda (líneas + comanda, en %
 * del bruto) supera el tope del usuario. `lines`/`order` ya vienen como quedarían tras la operación;
 * `base` y el `amount` devuelto son los de la operación (para el audit log y el mensaje).
 */
function assertWithinCap(
  lines: OrderItemDTO[],
  order: Pick<OrderDTO, 'tip' | 'discountType' | 'discountValue'>,
  base: number,
  input: ParsedDiscount,
  cap: number,
): number {
  const amount = computeDiscountAmount(base, input.type, input.value)
  const eff = computeEffectiveDiscount(lines, order)
  if (eff.percent > cap + 1e-9) {
    const askedPct = base > 0 ? round2((amount / base) * 100) : 0
    const asked = input.type === 'percent' ? `${input.value} %` : `${round2(amount)} = ${askedPct} %`
    const sumado = round2(eff.discountTotal - amount) > 0 ? ' sumado a los descuentos ya aplicados' : ''
    throw new ForbiddenError(`El descuento (${asked})${sumado} deja la comanda con ${eff.percent} % de descuento total y supera el máximo permitido (${cap} %)`)
  }
  return amount
}

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

async function audit(deps: DiscountsDeps, action: string, entity: string, entityId: string, hotelId: string, user: CurrentUser, detail: Record<string, unknown>): Promise<void> {
  await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
    hotelId, userId: user.id, action, entity, entityId, detail: JSON.stringify(detail),
  })
}

// ─── Comanda ───

/**
 * Aplica (o reemplaza) el descuento de la comanda. La base es la suma de las líneas vivas ya
 * descontadas — lo que `computeOrderTotals` usa como `subtotal` antes del descuento de comanda.
 */
export async function applyOrderDiscount(deps: DiscountsDeps, orderId: string, dto: DiscountInput, user: CurrentUser): Promise<OrderDTO> {
  const input = parseDiscountInput(dto)
  const order = await loadOrderForEdit(deps, orderId, user)
  const active = ((await deps.lines.findMany({ orderId })) as OrderItemDTO[]).filter(isLineActive)
  const base = computeOrderTotals(active, { tip: 0, discountType: null, discountValue: null }).subtotal
  if (base <= 0) throw new ValidationError('La comanda no tiene monto para descontar')
  const cap = await maxDiscountPercentFor(deps, order.hotelId, user)
  const amount = assertWithinCap(active, { tip: 0, discountType: input.type, discountValue: input.value }, base, input, cap)
  const previous = order.discountType ? { type: order.discountType, value: order.discountValue, amount: order.discountAmount, reason: order.discountReason } : null

  const patch = { discountType: input.type, discountValue: input.value, discountReason: input.reason, discountBy: user.id, discountAt: new Date().toISOString() }
  await deps.orders.update(order.id, patch as Partial<Omit<OrderDTO, 'id'>>)
  const updated = await recomputeTotals(deps, { ...order, ...patch })
  await audit(deps, 'restaurant.discount.applied', 'restaurant_order', order.id, order.hotelId, user, {
    scope: 'order', orderId: order.id, orderNumber: order.number, type: input.type, value: input.value,
    amount, base, reason: input.reason, previous, subtotal: updated.subtotal, tax: updated.tax, total: updated.total,
  })
  return updated
}

/** Quita el descuento de la comanda (409 si no tenía). Audita `restaurant.discount.removed`. */
export async function removeOrderDiscount(deps: DiscountsDeps, orderId: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrderForEdit(deps, orderId, user)
  if (!order.discountType) throw new ConflictError('La comanda no tiene descuento')
  const removed = { type: order.discountType, value: order.discountValue, amount: order.discountAmount, reason: order.discountReason }
  await deps.orders.update(order.id, NO_DISCOUNT as unknown as Partial<Omit<OrderDTO, 'id'>>)
  const updated = await recomputeTotals(deps, { ...order, ...NO_DISCOUNT } as OrderDTO)
  await audit(deps, 'restaurant.discount.removed', 'restaurant_order', order.id, order.hotelId, user, {
    scope: 'order', orderId: order.id, orderNumber: order.number, ...removed, total: updated.total,
  })
  return updated
}

// ─── Línea ───

async function loadLineForDiscount(deps: DiscountsDeps, order: OrderDTO, lineId: string): Promise<OrderItemDTO> {
  const line = (await deps.lines.findOne({ id: lineId })) as OrderItemDTO | null
  if (!line || line.orderId !== order.id || line.hotelId !== order.hotelId) throw new NotFoundError('Línea no encontrada')
  if (line.kind === 'combo_component') throw new ValidationError('Esta línea pertenece a un combo; descontá el combo completo')
  if (!isLineActive(line)) throw new ConflictError('La línea está anulada; no admite descuento')
  return line
}

/** Aplica (o reemplaza) el descuento de UNA línea sobre su `lineTotal` bruto. Cortesía = percent 100. */
export async function applyLineDiscount(deps: DiscountsDeps, orderId: string, lineId: string, dto: DiscountInput, user: CurrentUser): Promise<OrderItemDTO> {
  const input = parseDiscountInput(dto)
  const order = await loadOrderForEdit(deps, orderId, user)
  const line = await loadLineForDiscount(deps, order, lineId)
  const base = round2(Number(line.lineTotal || 0))
  if (base <= 0) throw new ValidationError('La línea no tiene monto para descontar')
  const cap = await maxDiscountPercentFor(deps, order.hotelId, user)
  // Simula la comanda como quedaría: esta línea con el descuento pedido, el resto y el descuento de comanda como están.
  const active = ((await deps.lines.findMany({ orderId: order.id })) as OrderItemDTO[]).filter(isLineActive)
    .map((l) => (l.id === line.id ? { ...l, discountType: input.type, discountValue: input.value } : l))
  const amount = assertWithinCap(active, order, base, input, cap)
  const previous = line.discountType ? { type: line.discountType, value: line.discountValue, amount: line.discountAmount, reason: line.discountReason } : null

  const patch = { discountType: input.type, discountValue: input.value, discountAmount: amount, discountReason: input.reason, discountBy: user.id, discountAt: new Date().toISOString() }
  await deps.lines.update(line.id, patch as Partial<Omit<OrderItemDTO, 'id'>>)
  const updatedOrder = await recomputeTotals(deps, order)
  await audit(deps, 'restaurant.discount.applied', 'restaurant_order_item', line.id, order.hotelId, user, {
    scope: 'line', orderId: order.id, orderNumber: order.number, lineId: line.id, name: line.name, quantity: line.quantity,
    type: input.type, value: input.value, amount, base, courtesy: input.type === 'percent' && input.value === 100,
    reason: input.reason, previous, total: updatedOrder.total,
  })
  return ((await deps.lines.findOne({ id: line.id })) as OrderItemDTO | null) ?? { ...line, ...patch }
}

/** Quita el descuento de una línea (409 si no tenía). */
export async function removeLineDiscount(deps: DiscountsDeps, orderId: string, lineId: string, user: CurrentUser): Promise<OrderItemDTO> {
  const order = await loadOrderForEdit(deps, orderId, user)
  const line = await loadLineForDiscount(deps, order, lineId)
  if (!line.discountType) throw new ConflictError('La línea no tiene descuento')
  const removed = { type: line.discountType, value: line.discountValue, amount: line.discountAmount, reason: line.discountReason }
  const patch = { ...NO_DISCOUNT, discountAmount: 0 }
  await deps.lines.update(line.id, patch as unknown as Partial<Omit<OrderItemDTO, 'id'>>)
  const updatedOrder = await recomputeTotals(deps, order)
  await audit(deps, 'restaurant.discount.removed', 'restaurant_order_item', line.id, order.hotelId, user, {
    scope: 'line', orderId: order.id, orderNumber: order.number, lineId: line.id, name: line.name, ...removed, total: updatedOrder.total,
  })
  return ((await deps.lines.findOne({ id: line.id })) as OrderItemDTO | null) ?? ({ ...line, ...patch } as OrderItemDTO)
}

// ─── Política del hotel: tope + motivos ───

export interface DiscountPolicy { maxDiscountPercent: number; reasons: string[]; isDefault: boolean }

/** Lo que el modal necesita: el tope que aplica a ESTE usuario y los motivos predefinidos del hotel. */
export async function getDiscountPolicy(deps: Pick<DiscountsDeps, 'config'>, user: CurrentUser): Promise<DiscountPolicy> {
  const hotelId = hotelFor(user)
  const [maxDiscountPercent, list] = await Promise.all([
    maxDiscountPercentFor(deps, hotelId, user),
    getReasonList(deps as VoidReasonsDeps, user, DISCOUNT_REASONS_SPEC),
  ])
  return { maxDiscountPercent, reasons: list.reasons, isDefault: list.isDefault }
}

export interface DiscountPolicyInput { maxDiscountPercent?: number; reasons?: unknown }

/**
 * Config del hotel (ruta `restaurant-catalog:edit`): tope 0..100 en configuration('restaurant') (se
 * conservan otras claves del objeto) y/o la lista de motivos. Devuelve la política tal como la ve el
 * usuario que la guardó (hotel_admin → 100, sin tope).
 */
export async function setDiscountPolicy(deps: Pick<DiscountsDeps, 'config'>, input: DiscountPolicyInput, user: CurrentUser): Promise<DiscountPolicy> {
  const hotelId = hotelFor(user)
  if (input.maxDiscountPercent !== undefined) {
    const n = Number(input.maxDiscountPercent)
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError('El tope de descuento debe estar entre 0 y 100')
    const now = new Date().toISOString()
    const row = await deps.config.findOne({ hotelId, key: RESTAURANT_CONFIG_KEY })
    const current = row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? (row.value as Record<string, unknown>) : {}
    const value = { ...current, maxDiscountPercent: n }
    if (row) await deps.config.update(row.id, { value, updatedAt: now } as any)
    else await deps.config.create({ hotelId, key: RESTAURANT_CONFIG_KEY, value, description: 'Configuración del restaurante', createdAt: now, updatedAt: now } as any)
  }
  if (input.reasons !== undefined) await setReasonList(deps as VoidReasonsDeps, input.reasons, user, DISCOUNT_REASONS_SPEC)
  return getDiscountPolicy(deps, user)
}
