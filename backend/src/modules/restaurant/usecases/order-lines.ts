// restaurant/usecases/order-lines.ts — Líneas de la comanda (RES-3): agregar, editar, quitar, anular.
// Cada línea SNAPSHOTEA name/unitPrice/taxRate/estación al crearse (la comanda no muta si cambia la
// carta después). Los totales se recalculan en el server tras cada cambio. hotelId SIEMPRE del JWT.
// #207: quitar (DELETE) solo vale mientras la comanda está `open` (error de toma). Una línea ya
// enviada a cocina se ANULA con motivo (`voidLine`): queda en la comanda tachada y se audita.
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, MenuItemDTO, CategoryDTO, StationDTO, CurrentUser, ModifierGroupDTO, ModifierDTO, OrderItemModifierSnapshot, ComboDTO, ComboItemDTO } from '../types'
import type { RestaurantSockets } from '../sockets'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { resolveStation, recomputeTotals, round2, isWithinAvailabilityWindow, isLineActive } from './order-totals'
import { recomputeOrderStatus } from './kds'
import { getCombo } from './combos-crud'

export interface OrderLinesDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  items: RepositoryAdapter<MenuItemDTO>
  categories: RepositoryAdapter<CategoryDTO>
  stations: RepositoryAdapter<StationDTO>
  config: RepositoryAdapter<any>
  hotels: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  // F1: grupos/opciones de modificadores (opcionales para no romper callers que aún no los configuran).
  modifierGroups?: RepositoryAdapter<ModifierGroupDTO>
  modifiers?: RepositoryAdapter<ModifierDTO>
  // F2: catálogo de combos (opcional por el mismo motivo que modifierGroups/modifiers). Wireado en
  // service.ts (comboDeps/orderLinesDeps, tarea 2.6).
  combos?: RepositoryAdapter<ComboDTO>
  comboItems?: RepositoryAdapter<ComboItemDTO>
  // #207: auditoría (puerto inyectado por connectors/restaurante-auditlog.ts) + sockets para que el
  // KDS se entere de una anulación. Ambos opcionales: el módulo funciona sin conectores.
  audit?: AuditPort | null
  logger?: Logger
  sockets?: RestaurantSockets
}

// Una vez liquidada o cancelada, la comanda no acepta cambios de líneas. fix-refund-pos-card:
// 'processing_payment' también bloquea — el monto ya viaja en una Checkout Session de Stripe abierta;
// si se editara una línea acá, el total recalculado NO coincidiría con lo que Stripe va a confirmar.
const LINES_LOCKED: OrderDTO['status'][] = ['charged', 'paid', 'cancelled', 'processing_payment']
// auditSafely exige un logger; si el service no inyectó uno (tests viejos), el fallo del audit se traga
// igual que con el logger real — auditar nunca tumba la operación de negocio.
const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger

export interface AddLineInput {
  menuItemId?: string
  comboId?: string
  quantity?: number
  notes?: string
  modifiers?: Array<{ modifierId: string }>
}
export interface UpdateLineInput { quantity?: number; notes?: string }

/**
 * F1 — Resuelve las opciones elegidas para un ítem: valida que cada `modifierId` exista, pertenezca
 * a un grupo del `menuItemId` de la línea y al mismo hotel, y que se cumplan required/minSelect/maxSelect
 * de CADA grupo del ítem (no solo los elegidos) antes de crear la fila. Devuelve el ajuste de precio
 * total (Σ priceDelta) y el snapshot a persistir en `modifiers` de la línea.
 */
async function resolveModifiers(
  deps: OrderLinesDeps,
  menuItemId: string,
  hotelId: string,
  selected: Array<{ modifierId: string }> | undefined,
): Promise<{ priceDelta: number; snapshot: OrderItemModifierSnapshot[] }> {
  if (!deps.modifierGroups || !deps.modifiers) {
    if (selected?.length) throw new ValidationError('Los modificadores no están configurados en este módulo')
    return { priceDelta: 0, snapshot: [] }
  }
  const groups = (await deps.modifierGroups.findMany({ hotelId, menuItemId })) as ModifierGroupDTO[]
  const chosenByGroup = new Map<string, ModifierDTO[]>()
  const snapshot: OrderItemModifierSnapshot[] = []
  let priceDelta = 0

  for (const sel of selected ?? []) {
    const modifier = await deps.modifiers.findOne({ id: sel.modifierId })
    if (!modifier || modifier.hotelId !== hotelId) throw new ValidationError('El modificador no existe o es de otro hotel')
    const group = groups.find((g) => g.id === modifier.groupId)
    if (!group) throw new ValidationError('El modificador no pertenece a un grupo de este ítem')
    const arr = chosenByGroup.get(group.id) ?? []
    arr.push(modifier)
    chosenByGroup.set(group.id, arr)
    const delta = Number(modifier.priceDelta || 0)
    priceDelta += delta
    snapshot.push({
      groupId: group.id, groupName: group.name, modifierId: modifier.id, name: modifier.name, priceDelta: delta,
      inventoryItemId: modifier.inventoryItemId || undefined,
      inventoryQuantity: modifier.inventoryQuantity ?? undefined,
    })
  }

  for (const group of groups) {
    const chosen = chosenByGroup.get(group.id) ?? []
    if (group.selectionType === 'multiple') {
      const minSelect = group.required ? (group.minSelect ?? 1) : 0
      if (chosen.length < minSelect) throw new ValidationError(`El grupo "${group.name}" requiere al menos ${minSelect} opción(es)`)
      if (group.maxSelect !== undefined && group.maxSelect !== null && chosen.length > group.maxSelect) {
        throw new ValidationError(`El grupo "${group.name}" admite como máximo ${group.maxSelect} opción(es)`)
      }
    } else {
      // single
      if (group.required && chosen.length < 1) throw new ValidationError(`Falta elegir una opción del grupo "${group.name}"`)
      if (chosen.length > 1) throw new ValidationError(`El grupo "${group.name}" admite una sola opción`)
    }
  }

  return { priceDelta, snapshot }
}

/**
 * Tasa de impuesto (%) del hotel — copia local (el codebase duplica taxRateFor por módulo en vez de
 * cross-importar; ver folios/folio-math.ts y facturas/billing.ts). `configuration(key='taxes')` o
 * fallback a `hotels.taxRate`. NO hardcodeado.
 */
async function hotelTaxRate(config: RepositoryAdapter<any>, hotels: RepositoryAdapter<any>, hotelId: string): Promise<number> {
  try {
    let c = await config.findOne({ hotelId, key: 'taxes' })
    if (!c) c = await config.findOne({ hotelId, key: 'impuestos' })
    const arr: any[] = c?.value ?? []
    const configured = arr.filter((t) => t && (t.activo ?? t.active)).reduce((s, t) => s + Number(t.tasa ?? t.rate ?? 0), 0)
    if (configured > 0) return configured
  } catch { /* cae al fallback */ }
  try {
    const hotel = await hotels.findById(hotelId)
    return Number((hotel as any)?.taxRate) || 0
  } catch { return 0 }
}

async function loadOrderForEdit(deps: OrderLinesDeps, orderId: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await deps.orders.findById(orderId)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  if (LINES_LOCKED.includes(order.status)) throw new ConflictError(`La comanda está ${order.status}; no admite cambios`)
  return order
}

function assertQuantity(q: number | undefined): number {
  const n = Number(q ?? 1)
  if (!Number.isInteger(n) || n < 1) throw new ValidationError('La cantidad debe ser un entero ≥ 1')
  return n
}

/**
 * F2 — resuelve combo + componentes vía `combos-crud.getCombo` (reuso, no reimplementa la búsqueda +
 * ownership) y explota la venta en 1 fila `combo_header` + N filas `combo_component` reales. El precio
 * completo vive SOLO en el header (componentes en 0) para que `recomputeTotals`/`order-totals.ts` sigan
 * sin cambios: ya suman `lineTotal` de todas las filas sin importar `kind`.
 */
async function addComboLine(
  deps: OrderLinesDeps,
  order: OrderDTO,
  comboId: string,
  quantity: number,
  notes: string | undefined,
  user: CurrentUser,
): Promise<OrderItemDTO> {
  if (!deps.combos || !deps.comboItems) throw new ValidationError('Los combos no están configurados en este módulo')
  const combo = await getCombo(
    { combos: deps.combos, comboItems: deps.comboItems, items: deps.items, userRepo: deps.userRepo, auth: deps.auth },
    comboId,
    user,
  )

  // DT-10 — resolver y validar disponibilidad de TODOS los componentes ANTES de crear ninguna fila
  // (mismo criterio que addLine: available + franja horaria). Si un componente falla, se rechaza
  // el combo COMPLETO — no se vende "a medias" con un componente inventado o agotado.
  const resolvedComponents: { component: NonNullable<typeof combo.items>[number]; item: NonNullable<Awaited<ReturnType<typeof deps.items.findOne>>> }[] = []
  for (const component of combo.items ?? []) {
    const item = await deps.items.findOne({ id: component.menuItemId })
    if (!item || item.hotelId !== order.hotelId) throw new ValidationError('El ítem no existe o es de otro hotel')
    if ((item.available ?? 1) === 0) throw new ValidationError(`"${item.name}" no está disponible ahora mismo`)
    if (!isWithinAvailabilityWindow(item, new Date())) throw new ValidationError(`"${item.name}" no está disponible en este horario`)
    resolvedComponents.push({ component, item })
  }

  const unitPrice = Number(combo.price || 0)
  const taxRate = combo.taxRate ?? await hotelTaxRate(deps.config, deps.hotels, order.hotelId)
  const headerData = {
    hotelId: order.hotelId,
    orderId: order.id,
    kind: 'combo_header',
    comboId: combo.id,
    menuItemId: undefined,
    name: combo.name,               // snapshot
    unitPrice,                      // snapshot del precio propio del combo
    quantity,
    notes,
    taxRate,
    stationId: undefined,           // el header no rutea a ningún KDS
    stationName: undefined,
    status: 'new',
    lineTotal: round2(unitPrice * quantity),
    modifiers: null,                // F1: los combos NUNCA aceptan modificadores
  } as Omit<OrderItemDTO, 'id'>
  const header = (await deps.lines.create(headerData)) as OrderItemDTO

  for (const { component, item } of resolvedComponents) {
    const station = await resolveStation(deps, item, order.hotelId)
    const componentData = {
      hotelId: order.hotelId,
      orderId: order.id,
      kind: 'combo_component',
      parentLineId: header.id,
      menuItemId: item.id,          // snapshot, IGUAL que una línea normal
      name: item.name,
      unitPrice: 0,                 // el precio vive en el header, el componente no duplica el monto
      quantity: Number(component.quantity) * quantity,
      taxRate: 0,
      stationId: station.stationId, // MISMO resolveStation() que una línea normal
      stationName: station.stationName,
      status: 'new',
      lineTotal: 0,
      modifiers: null,
    } as Omit<OrderItemDTO, 'id'>
    await deps.lines.create(componentData)
  }

  await recomputeTotals(deps, order)
  return header
}

export async function addLine(deps: OrderLinesDeps, orderId: string, dto: AddLineInput, user: CurrentUser): Promise<OrderItemDTO> {
  const order = await loadOrderForEdit(deps, orderId, user)

  if (!!dto.menuItemId === !!dto.comboId) {
    throw new ValidationError('Debe especificar exactamente uno de menuItemId o comboId')
  }

  if (dto.comboId) {
    if (dto.modifiers && dto.modifiers.length) {
      throw new ValidationError('Los modificadores no están permitidos dentro de un combo')
    }
    return addComboLine(deps, order, dto.comboId, assertQuantity(dto.quantity), dto.notes, user)
  }

  const item = await deps.items.findOne({ id: dto.menuItemId })
  if (!item || item.hotelId !== order.hotelId) throw new ValidationError('El ítem no existe o es de otro hotel')
  if ((item.available ?? 1) === 0) throw new ValidationError(`"${item.name}" no está disponible`)
  // F6 — franja horaria, chequeo SEPARADO del `available` manual de arriba (ambas condiciones son
  // independientes y se combinan con AND). Solo bloquea AGREGAR líneas nuevas; una línea ya creada
  // conserva su snapshot sin importar que el ítem salga de franja después (no se re-evalúa en updateLine).
  if (!isWithinAvailabilityWindow(item, new Date())) throw new ValidationError(`"${item.name}" no está disponible en este horario`)
  const quantity = assertQuantity(dto.quantity)
  const { priceDelta, snapshot } = await resolveModifiers(deps, item.id, order.hotelId, dto.modifiers)
  const unitPrice = Number(item.price || 0)
  const taxRate = item.taxRate ?? await hotelTaxRate(deps.config, deps.hotels, order.hotelId)
  const station = await resolveStation(deps, item, order.hotelId)
  const line = await deps.lines.create({
    hotelId: order.hotelId,
    orderId,
    menuItemId: item.id,
    name: item.name,               // snapshot
    unitPrice,                     // snapshot (neto, SIN modificadores — el ajuste vive en lineTotal)
    quantity,
    notes: dto.notes,
    taxRate,                       // snapshot de la tasa (%)
    stationId: station.stationId,
    stationName: station.stationName,
    status: 'new',
    lineTotal: round2((unitPrice + priceDelta) * quantity),
    modifiers: snapshot.length ? snapshot : null,
  } as Omit<OrderItemDTO, 'id'>)
  await recomputeTotals(deps, order)
  return line
}

/**
 * F2 — propaga la cantidad del header a TODOS sus componentes (mismo `parentLineId`), multiplicando la
 * qty BASE de cada uno (`menu_combo_items.quantity`) por la nueva cantidad del combo vendido.
 */
async function recalcComboComponents(deps: OrderLinesDeps, header: OrderItemDTO, newQuantity: number): Promise<void> {
  if (!deps.comboItems || !header.comboId) return
  const comboItems = (await deps.comboItems.findMany({ hotelId: header.hotelId, comboId: header.comboId })) as ComboItemDTO[]
  const components = ((await deps.lines.findMany({ orderId: header.orderId })) as OrderItemDTO[])
    .filter((l) => l.parentLineId === header.id)
  for (const comp of components) {
    const def = comboItems.find((ci) => ci.menuItemId === comp.menuItemId)
    if (!def) continue
    const quantity = Number(def.quantity) * newQuantity
    await deps.lines.update(comp.id, { quantity } as Partial<Omit<OrderItemDTO, 'id'>>)
  }
}

export async function updateLine(deps: OrderLinesDeps, orderId: string, lineId: string, dto: UpdateLineInput, user: CurrentUser): Promise<OrderItemDTO> {
  const order = await loadOrderForEdit(deps, orderId, user)
  // findOne (no findById): la línea se valida por orderId+hotelId; el ownership ya lo hizo loadOrderForEdit.
  const line = (await deps.lines.findOne({ id: lineId })) as OrderItemDTO | null
  if (!line || line.orderId !== orderId || line.hotelId !== order.hotelId) throw new NotFoundError('Línea no encontrada')
  if (line.kind === 'combo_component') {
    throw new ValidationError('Esta línea pertenece a un combo; editá el combo completo')
  }
  const patch: Record<string, unknown> = {}
  if (dto.notes !== undefined) patch.notes = dto.notes
  if (dto.quantity !== undefined) {
    const quantity = assertQuantity(dto.quantity)
    patch.quantity = quantity
    patch.lineTotal = round2(Number(line.unitPrice || 0) * quantity)
  }
  const updated = (await deps.lines.update(lineId, patch as Partial<Omit<OrderItemDTO, 'id'>>)) as OrderItemDTO
  if (line.kind === 'combo_header' && dto.quantity !== undefined) {
    await recalcComboComponents(deps, updated, updated.quantity)
  }
  await recomputeTotals(deps, order)
  return updated
}

export async function removeLine(deps: OrderLinesDeps, orderId: string, lineId: string, user: CurrentUser): Promise<void> {
  const order = await loadOrderForEdit(deps, orderId, user)
  // #207: borrar es solo para un error de toma, antes de enviar. Una vez que la comanda salió a
  // cocina (cualquier estado ≠ open) el plato ya se vio en el KDS: se anula con motivo, no se borra.
  if (order.status !== 'open') {
    throw new ConflictError('La línea ya fue enviada a cocina: anulala con motivo')
  }
  const line = (await deps.lines.findOne({ id: lineId })) as OrderItemDTO | null
  if (!line || line.orderId !== orderId || line.hotelId !== order.hotelId) throw new NotFoundError('Línea no encontrada')
  if (line.kind === 'combo_component') {
    throw new ValidationError('Esta línea pertenece a un combo; editá el combo completo')
  }
  if (line.kind === 'combo_header') {
    const components = ((await deps.lines.findMany({ orderId })) as OrderItemDTO[])
      .filter((l) => l.parentLineId === line.id)
    for (const c of components) await deps.lines.delete(c.id)
  }
  await deps.lines.delete(lineId)
  await recomputeTotals(deps, order)
}

/**
 * #207 — Anula con motivo una línea ya enviada a cocina. La línea NO se borra: pasa a `voided` con
 * `voidReason`/`voidedBy`/`voidedAt`, deja de contar en los totales y sale del KDS, pero sigue en la
 * comanda (tachada) para que el dueño sepa quién anuló qué. Un combo se anula completo (header +
 * componentes). Requiere `restaurant:delete` (ruta). Audita `restaurant.line.voided` con el monto.
 * No toca stock: el inventario se descuenta recién al liquidar (connectors/restaurante-inventario.ts),
 * y una comanda liquidada ya no llega acá (LINES_LOCKED).
 */
export async function voidLine(deps: OrderLinesDeps, orderId: string, lineId: string, reason: string | undefined, user: CurrentUser): Promise<OrderItemDTO> {
  const reasonText = String(reason ?? '').trim()
  if (!reasonText) throw new ValidationError('Indicá el motivo de la anulación')
  const order = await loadOrderForEdit(deps, orderId, user)
  if (order.status === 'open') {
    throw new ConflictError('La línea todavía no fue enviada a cocina: quitala de la comanda')
  }
  const line = (await deps.lines.findOne({ id: lineId })) as OrderItemDTO | null
  if (!line || line.orderId !== orderId || line.hotelId !== order.hotelId) throw new NotFoundError('Línea no encontrada')
  if (line.kind === 'combo_component') {
    throw new ValidationError('Esta línea pertenece a un combo; anulá el combo completo')
  }
  if (!isLineActive(line)) throw new ConflictError('La línea ya está anulada')
  // Snapshot ANTES de escribir: un adapter puede devolver la misma referencia que después muta.
  const previousStatus = line.status
  const amount = round2(Number(line.lineTotal || 0))

  const voidPatch = { status: 'voided', voidReason: reasonText, voidedBy: user.id, voidedAt: new Date().toISOString() } as Partial<Omit<OrderItemDTO, 'id'>>
  if (line.kind === 'combo_header') {
    const components = ((await deps.lines.findMany({ orderId })) as OrderItemDTO[])
      .filter((l) => l.parentLineId === line.id && isLineActive(l))
    for (const c of components) await deps.lines.update(c.id, voidPatch)
  }
  const updated = (await deps.lines.update(lineId, voidPatch)) as OrderItemDTO
  await recomputeTotals(deps, order)
  // Si la línea anulada era la única que frenaba la comanda (ej. las demás ya `ready`), el estado
  // agregado tiene que avanzar — mismo criterio que una transición del KDS.
  await recomputeOrderStatus(deps, order)

  await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
    hotelId: order.hotelId,
    userId: user.id,
    action: 'restaurant.line.voided',
    entity: 'restaurant_order_item',
    entityId: lineId,
    detail: JSON.stringify({
      orderId: order.id, orderNumber: order.number, lineId, name: line.name, quantity: line.quantity,
      amount, reason: reasonText, previousStatus,
    }),
  })
  await deps.sockets?.onLineStatusChanged?.(updated)
  return updated
}
