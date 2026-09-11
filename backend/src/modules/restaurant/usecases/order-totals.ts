// restaurant/usecases/order-totals.ts — Resolución de estación y recálculo de totales (RES-3).
// Puramente sobre repos del dominio. El impuesto sale de la tasa CONGELADA por línea (snapshot),
// nunca hardcodeado. Ver design.md §Resolución de estación + specs/billing-payment.
import type { RepositoryAdapter } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, MenuItemDTO, CategoryDTO, StationDTO, OrderItemModifierSnapshot, DiscountType } from '../types'
import { round2 } from '../../../shared/utils/money'

/**
 * Total neto de una línea: (precio unitario + Σ priceDelta de los modificadores) × cantidad.
 *
 * ÚNICO cálculo de `lineTotal` — lo usan `addLine` y `updateLine`. #206: `updateLine` recalculaba
 * `unitPrice × quantity` por su cuenta y perdía el recargo de los modificadores al cambiar la
 * cantidad (una pizza "+ extra queso 50" pasaba de 1 a 2 y el hotel perdía los 50 de cada una).
 * `unitPrice` es el snapshot NETO (sin modificadores); el ajuste vive en el snapshot `modifiers`
 * de la línea, así que no hace falta releer el catálogo (que puede haber cambiado).
 */
export function computeLineTotal(
  unitPrice: number,
  modifiers: Pick<OrderItemModifierSnapshot, 'priceDelta'>[] | null | undefined,
  quantity: number,
): number {
  const delta = (modifiers ?? []).reduce((sum, m) => sum + Number(m?.priceDelta || 0), 0)
  return round2((Number(unitPrice || 0) + delta) * quantity)
}

/**
 * #207 — Una línea "viva" es la que cuenta para totales, cocina, stock y estado de la comanda.
 * `voided` (anulada con motivo) y `cancelled` (legacy, anterior a #207) quedan fuera. Único lugar
 * donde se decide: cualquier filtro nuevo sobre líneas usa esto, no compara el status a mano.
 */
export function isLineActive(line: Pick<OrderItemDTO, 'status'>): boolean {
  return line.status !== 'cancelled' && line.status !== 'voided'
}

/**
 * Estados en los que una COMANDA ya no ocupa la mesa: liquidada (`charged`/`paid`), cancelada, o
 * reembolsada (`refunded`: fue cobrada con tarjeta, la mesa se liberó al pagar, y no se reabre).
 * Único lugar donde se decide (#208): lo usan `openOrder` ("una mesa, una comanda abierta") y
 * `deleteTable` ("una mesa con comanda viva no se borra"). Distinto de `LINES_LOCKED`
 * (order-lines.ts), que dice cuándo las LÍNEAS dejan de editarse — `processing_payment` bloquea
 * líneas pero la comanda sigue viva en la mesa.
 */
export const TERMINAL_ORDER_STATUSES: OrderDTO['status'][] = ['charged', 'paid', 'cancelled', 'refunded']
export const isTerminalOrder = (order: Pick<OrderDTO, 'status'>): boolean => TERMINAL_ORDER_STATUSES.includes(order.status)

/** "HH:mm" → minutos desde medianoche. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * F6 — ¿el ítem está disponible AHORA por franja horaria? `availableFrom`/`availableTo` ambos
 * null/undefined → sin restricción, siempre `true` (compat retro total). Compara la hora del
 * SERVIDOR (`now`, sin conversión a `hotel.timezone` — deuda ya documentada y compartida con
 * `attendance`, D10, NO se resuelve acá). Franja que cruza medianoche (`availableFrom > availableTo`,
 * ej. 22:00-02:00) se evalúa como `hora >= availableFrom OR hora <= availableTo`.
 * Ver specs/menu-featured-availability/spec.md.
 */
export function isWithinAvailabilityWindow(
  item: Pick<MenuItemDTO, 'availableFrom' | 'availableTo'>,
  now: Date,
): boolean {
  if (!item.availableFrom || !item.availableTo) return true
  const from = toMinutes(item.availableFrom)
  const to = toMinutes(item.availableTo)
  const current = now.getHours() * 60 + now.getMinutes()
  if (from <= to) return current >= from && current <= to
  return current >= from || current <= to   // cruza medianoche
}

/**
 * Resuelve la estación (pantalla KDS) de una línea: override del ítem → estación de la categoría →
 * primera estación activa del hotel → ninguna. Devuelve id + nombre para snapshotear en la línea.
 */
export async function resolveStation(
  deps: { categories: RepositoryAdapter<CategoryDTO>; stations: RepositoryAdapter<StationDTO> },
  item: MenuItemDTO, hotelId: string,
): Promise<{ stationId?: string; stationName?: string }> {
  let stationId: string | undefined = item.stationId || undefined
  if (!stationId && item.categoryId) {
    const cat = await deps.categories.findOne({ id: item.categoryId })
    stationId = cat?.stationId || undefined
  }
  if (!stationId) {
    const all = (await deps.stations.findMany({ hotelId })) as StationDTO[]
    const active = all.filter((s) => (s.active ?? 1) === 1).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    stationId = active[0]?.id
  }
  if (!stationId) return { stationId: undefined, stationName: undefined }
  const st = await deps.stations.findOne({ id: stationId })
  return { stationId, stationName: st?.name }
}

/**
 * #215 — Monto que resta un descuento sobre una base. `percent` → base × v / 100; `amount` → v, recortado
 * a la base (nunca deja un neto negativo). Sin tipo/valor → 0. ÚNICO cálculo: lo usan la línea, la
 * comanda y el chequeo del tope (que convierte un monto a % con esta misma base).
 */
export function computeDiscountAmount(
  base: number,
  type: DiscountType | null | undefined,
  value: number | null | undefined,
): number {
  const b = Number(base || 0)
  const v = Number(value || 0)
  if (!type || !(v > 0) || !(b > 0)) return 0
  if (type === 'percent') return round2(Math.min(b, (b * v) / 100))
  return round2(Math.min(b, v))
}

export interface OrderTotals {
  subtotal: number
  tax: number
  total: number
  /** Descuento de comanda efectivamente aplicado. */
  discountAmount: number
  /** Σ descuentos de línea + descuento de comanda. */
  discountTotal: number
  /** Descuento efectivo por línea (id → monto), ya recortado al total de cada línea. */
  lineDiscounts: Map<string, number>
}

/**
 * #215 — Totales de una comanda a partir de sus líneas VIVAS, con descuentos:
 *   neto_i    = lineTotal_i − descuento de línea_i
 *   base      = Σ neto_i
 *   descuento = descuento de comanda sobre `base` (percent o amount recortado)
 *   subtotal  = base − descuento
 *   tax       = Σ neto_i × (1 − descuento/base) × tasa_i / 100   ← impuesto sobre el neto descontado,
 *               prorrateado por línea porque cada una congela su propia tasa
 *   total     = subtotal + tax + tip
 * Puro: sin repos. `recomputeTotals` lo persiste.
 */
export function computeOrderTotals(
  lines: Pick<OrderItemDTO, 'id' | 'lineTotal' | 'taxRate' | 'discountType' | 'discountValue'>[],
  order: Pick<OrderDTO, 'tip' | 'discountType' | 'discountValue'>,
): OrderTotals {
  const lineDiscounts = new Map<string, number>()
  let base = 0
  const nets: Array<{ net: number; rate: number }> = []
  for (const l of lines) {
    const gross = Number(l.lineTotal || 0)
    const disc = computeDiscountAmount(gross, l.discountType, l.discountValue)
    lineDiscounts.set(l.id, disc)
    const net = round2(gross - disc)
    nets.push({ net, rate: Number(l.taxRate || 0) })
    base += net
  }
  base = round2(base)
  const discountAmount = computeDiscountAmount(base, order.discountType, order.discountValue)
  const factor = base > 0 ? (base - discountAmount) / base : 1
  let tax = 0
  for (const { net, rate } of nets) tax += (net * factor * rate) / 100
  const subtotal = round2(base - discountAmount)
  tax = round2(tax)
  const tip = round2(Number(order.tip || 0))
  const total = round2(subtotal + tax + tip)
  let lineDiscountSum = 0
  for (const d of lineDiscounts.values()) lineDiscountSum += d
  const discountTotal = round2(lineDiscountSum + discountAmount)
  return { subtotal, tax, total, discountAmount, discountTotal, lineDiscounts }
}

export interface EffectiveDiscount {
  /** Σ lineTotal de las líneas vivas (antes de cualquier descuento). */
  gross: number
  /** Σ descuentos de línea + descuento de comanda, ya recortados. */
  discountTotal: number
  /** discountTotal como % del bruto (0 si no hay bruto). */
  percent: number
}

/**
 * #215 — Descuento EFECTIVO TOTAL de la comanda: lo que de verdad deja de cobrarse (líneas + comanda)
 * expresado como % del bruto. Es contra ESTO que se mide el tope del hotel, no contra cada operación
 * suelta: una línea al 20 % más la comanda al 20 % dejan de cobrar el 36 % del bruto, y un tope del
 * 25 % tiene que frenar la segunda operación aunque por sí sola esté por debajo. Puro: la operación
 * que se quiere validar se simula pasando las líneas/comanda como quedarían.
 */
export function computeEffectiveDiscount(
  lines: Pick<OrderItemDTO, 'id' | 'lineTotal' | 'taxRate' | 'discountType' | 'discountValue'>[],
  order: Pick<OrderDTO, 'tip' | 'discountType' | 'discountValue'>,
): EffectiveDiscount {
  let gross = 0
  for (const l of lines) gross += Number(l.lineTotal || 0)
  gross = round2(gross)
  const { discountTotal } = computeOrderTotals(lines, order)
  const percent = gross > 0 ? round2((discountTotal / gross) * 100) : 0
  return { gross, discountTotal, percent }
}

/**
 * Recalcula subtotal (neto), tax (por tasa congelada de cada línea, sobre el neto descontado) y total
 * (+ tip) de una comanda a partir de sus líneas vivas (ni canceladas ni anuladas), y persiste el
 * resultado. #215: también persiste `discountAmount` de cada línea cuyo descuento efectivo cambió (un
 * monto fijo se recorta si la cantidad bajó) y `discountAmount`/`discountTotal` de la comanda.
 * Devuelve el pedido actualizado.
 */
export async function recomputeTotals(
  deps: { orders: RepositoryAdapter<OrderDTO>; lines: RepositoryAdapter<OrderItemDTO> },
  order: OrderDTO,
): Promise<OrderDTO> {
  const all = (await deps.lines.findMany({ orderId: order.id })) as OrderItemDTO[]
  const active = all.filter(isLineActive)
  const t = computeOrderTotals(active, order)
  for (const l of active) {
    const disc = t.lineDiscounts.get(l.id) ?? 0
    if (round2(Number(l.discountAmount || 0)) !== disc) {
      await deps.lines.update(l.id, { discountAmount: disc } as Partial<Omit<OrderItemDTO, 'id'>>)
    }
  }
  const patch = { subtotal: t.subtotal, tax: t.tax, total: t.total, discountAmount: t.discountAmount, discountTotal: t.discountTotal }
  const updated = await deps.orders.update(order.id, patch as Partial<Omit<OrderDTO, 'id'>>)
  return (updated as OrderDTO) ?? { ...order, ...patch }
}
