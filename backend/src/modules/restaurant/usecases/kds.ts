// restaurant/usecases/kds.ts — Pantalla de cocina (RES-4). Cola de líneas activas por estación y
// transición de estado por línea (new→preparing→ready→served). El estado de la ORDEN se deriva de sus
// líneas. hotelId SIEMPRE del JWT. Ver specs/kds.spec.md.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, TableDTO, LineStatus, CurrentUser, IngredientChanges, RecipeIngredient } from '../types'
import type { RestaurantSockets } from '../sockets'
import type { RecipePorts } from './food-cost'
import { isLineActive } from './order-totals'

export interface KdsDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  sockets: RestaurantSockets
  // #211 — el ticket dice "Terraza · Mesa 3" / "Hab. 204": mesas del módulo y número de habitación
  // (tabla `rooms`, leída como Hotels/Users: shared por el ORM, sin importar el módulo). Opcionales:
  // sin ellos el ticket cae al tipo de comanda, como antes.
  tables?: RepositoryAdapter<TableDTO>
  rooms?: RepositoryAdapter<any>
  // KDS con receta: `getRecipeIngredients` lo provee el conector restaurante-inventario. Sin él (o sin
  // tabla de recetas) las líneas salen sin `ingredients` y el tablero muestra "sin receta".
  recipePorts?: RecipePorts
}

// Estados "en cocina" (visibles en el KDS). served/cancelled/voided salen de la cola.
const ACTIVE: LineStatus[] = ['new', 'preparing', 'ready']
// Transiciones válidas por línea. Saltos fuera de esto se rechazan.
// #207: cocina NO cancela de un toque. `cancelled`/`voided` no son transiciones del KDS: la única
// forma de sacar un plato ya enviado es `voidLine` (order-lines.ts), que exige motivo y audita.
const TRANSITIONS: Record<LineStatus, LineStatus[]> = {
  new: ['preparing'],
  preparing: ['ready'],
  ready: ['served'],
  served: [],
  cancelled: [],
  voided: [],
}
// La orden solo se re-deriva mientras está en fase de cocina (no toca open/billed/charged/paid/cancelled).
const KITCHEN_ORDER_STATES: OrderDTO['status'][] = ['sent', 'preparing', 'ready', 'served']

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

export interface KdsTicket {
  order: Pick<OrderDTO, 'id' | 'number' | 'type' | 'tableId' | 'openedAt' | 'status'> & {
    // #211 — resueltos por el server para que la pantalla de cocina no tenga que pedir mesas ni habitaciones.
    tableName?: string
    tableZone?: string
    roomNumber?: string
  }
  lines: KdsLine[]
}

/** Línea del tablero: la fila de la comanda + su receta resuelta (solo lectura; lo que cocina cambió va en `ingredientChanges`). */
export type KdsLine = OrderItemDTO & { ingredients?: RecipeIngredient[] }

// Tope de nombres de ingrediente por lista y largo por nombre: es una anotación de cocina, no un texto libre.
const MAX_INGREDIENT_CHANGES = 30
const MAX_INGREDIENT_NAME = 60

/** Normaliza lo que manda la pantalla: strings recortados, sin vacíos ni repetidos (sin distinguir mayúsculas), con tope. */
export function normalizeIngredientChanges(input: unknown): IngredientChanges {
  const pick = (v: unknown): string[] => {
    if (!Array.isArray(v)) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of v) {
      if (typeof raw !== 'string') continue
      const name = raw.trim().slice(0, MAX_INGREDIENT_NAME)
      const key = name.toLocaleLowerCase('es')
      if (!name || seen.has(key)) continue
      seen.add(key)
      out.push(name)
      if (out.length >= MAX_INGREDIENT_CHANGES) break
    }
    return out
  }
  const src = (input ?? {}) as Record<string, unknown>
  const removed = pick(src.removed)
  const lower = new Set(removed.map((n) => n.toLocaleLowerCase('es')))
  // Un ingrediente quitado no puede ir doble: gana "sin" (es lo que el cliente pidió no comer).
  const doubled = pick(src.doubled).filter((n) => !lower.has(n.toLocaleLowerCase('es')))
  return { removed, added: pick(src.added), doubled }
}
export const hasIngredientChanges = (c: IngredientChanges): boolean => c.removed.length > 0 || c.added.length > 0 || c.doubled.length > 0

/** Nombre de mesa/zona y número de habitación de una comanda, según su tipo. Vacío si no aplica o no se encuentra. */
async function resolvePlace(deps: KdsDeps, order: OrderDTO, tables: Map<string, TableDTO>): Promise<Pick<KdsTicket['order'], 'tableName' | 'tableZone' | 'roomNumber'>> {
  const out: Pick<KdsTicket['order'], 'tableName' | 'tableZone' | 'roomNumber'> = {}
  const table = order.tableId ? tables.get(order.tableId) : undefined
  if (table) { out.tableName = table.name; out.tableZone = table.zone || undefined }
  if (order.type === 'room_service' && order.roomId && deps.rooms) {
    // findOne acotado al hotel del JWT (no findById): la habitación es de otro módulo, acá solo se lee el número.
    const room = await deps.rooms.findOne({ id: order.roomId, hotelId: order.hotelId })
    if (room?.number) out.roomNumber = String(room.number)
  }
  return out
}

/**
 * Cola del KDS: líneas activas (new/preparing/ready) del hotel, opcionalmente filtradas por estación,
 * agrupadas por comanda y ordenadas FIFO (por apertura de la comanda). `station` vacío = todas las
 * estaciones (para el hotel de una sola pantalla); `station='__none__'` = líneas sin estación asignada.
 * F2: excluye SIEMPRE las filas `kind='combo_header'` — no representan un plato a preparar (RES-4).
 * Hoy se auto-excluyen por no tener `stationId`, pero se refuerza explícito por claridad, no como efecto
 * colateral (spec `menu-combos`).
 */
export async function kdsQueue(deps: KdsDeps, station: string | undefined, user: CurrentUser): Promise<{ data: KdsTicket[]; total: number }> {
  const hotelId = hotelFor(user)
  let lines = ((await deps.lines.findMany({ hotelId })) as OrderItemDTO[])
    .filter((l) => ACTIVE.includes(l.status) && l.kind !== 'combo_header')
  if (station === '__none__') lines = lines.filter((l) => !l.stationId)
  else if (station) lines = lines.filter((l) => l.stationId === station)

  const byOrder = new Map<string, OrderItemDTO[]>()
  for (const l of lines) {
    const arr = byOrder.get(l.orderId) ?? []
    arr.push(l)
    byOrder.set(l.orderId, arr)
  }
  const tickets: KdsTicket[] = []
  // Una sola lectura de mesas por cola (no una por ticket).
  const tables = new Map<string, TableDTO>()
  if (deps.tables && byOrder.size) for (const t of (await deps.tables.findMany({ hotelId })) as TableDTO[]) tables.set(t.id, t)
  for (const [orderId, orderLines] of byOrder) {
    const order = await deps.orders.findById(orderId)
    if (!order || order.hotelId !== hotelId) continue   // aislamiento multi-tenant
    // Solo comandas en fase de cocina: excluye `open` (aún NO enviada — el mesero sigue tipeando) y
    // billed/charged/paid/cancelled (ya cerradas). Sin esto, una línea `new` de una comanda abierta o
    // las líneas de una comanda cancelada quedarían colgadas en la pantalla para siempre.
    if (!KITCHEN_ORDER_STATES.includes(order.status)) continue
    tickets.push({
      order: { id: order.id, number: order.number, type: order.type, tableId: order.tableId, openedAt: order.openedAt, status: order.status, ...(await resolvePlace(deps, order, tables)) },
      lines: orderLines,
    })
  }
  tickets.sort((a, b) => String(a.order.openedAt || '').localeCompare(String(b.order.openedAt || '')))   // FIFO
  await attachIngredients(deps, tickets, user)
  return { data: tickets, total: tickets.length }
}

/** Pega la receta (con nombres) a cada línea del tablero: UNA llamada al puerto para todos los platos de la cola. */
async function attachIngredients(deps: KdsDeps, tickets: KdsTicket[], user: CurrentUser): Promise<void> {
  const port = deps.recipePorts?.getRecipeIngredients
  if (!port) return
  const ids = [...new Set(tickets.flatMap((t) => t.lines.map((l) => l.menuItemId || '')).filter(Boolean))]
  if (!ids.length) return
  let byItem: Record<string, RecipeIngredient[]> = {}
  try { byItem = await port(ids, user) } catch { return }   // la receta es un extra: sin inventario el tablero sigue
  for (const t of tickets) for (const l of t.lines) {
    const recipe = l.menuItemId ? byItem[l.menuItemId] : undefined
    if (recipe?.length) l.ingredients = recipe
  }
}

// Comandas en las que se puede tocar la receta de una línea: `open` (el mozo la arma, todavía no fue a
// cocina) más la fase de cocina. Cerradas (billed/charged/paid/cancelled) no.
const INGREDIENT_EDITABLE_ORDER_STATES: OrderDTO['status'][] = ['open', ...KITCHEN_ORDER_STATES]

/**
 * Cocina (KDS) o el mozo (comanda) quitan, agregan o doblan ingredientes de un plato. Solo sobre líneas
 * activas (new/preparing/ready) de una comanda abierta o en cocina: un plato ya servido o anulado no se
 * toca. Reemplaza la anotación completa (la pantalla manda el estado final, no deltas). No cambia
 * precio ni estado; avisa por el canal en vivo para que el KDS de al lado y la comanda del mozo lo vean.
 */
export async function setLineIngredients(deps: KdsDeps, lineId: string, input: unknown, user: CurrentUser): Promise<OrderItemDTO> {
  const changes = normalizeIngredientChanges(input)
  const line = await deps.lines.findOne({ id: lineId })
  if (!line) throw new NotFoundError('Línea no encontrada')
  const order = await deps.orders.findById(line.orderId)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  if (!ACTIVE.includes(line.status) || line.kind === 'combo_header') throw new ValidationError('Ese plato ya no se puede modificar')
  if (!INGREDIENT_EDITABLE_ORDER_STATES.includes(order.status)) throw new ValidationError('La comanda ya está cerrada')
  const value: IngredientChanges | null = hasIngredientChanges(changes) ? changes : null
  const updated = (await deps.lines.update(lineId, { ingredientChanges: value } as Partial<Omit<OrderItemDTO, 'id'>>)) as OrderItemDTO
  await deps.sockets.onLineStatusChanged?.(updated)
  return updated
}

/**
 * Deriva el estado agregado de la orden a partir de sus líneas vivas y lo persiste si cambió.
 * F2: excluye también las filas `kind='combo_header'` (mismo criterio que `kdsQueue`) — el header nunca
 * es tocado por cocina (queda fuera de la cola), así que si no se excluye acá queda `status:'new'` para
 * siempre y `active.every(...)` nunca se cumple: la orden queda encallada en `'preparing'` aunque los
 * componentes reales ya estén `served` (cambio real señalado por design.md R1, no cosmético).
 */
export async function recomputeOrderStatus(
  deps: { orders: RepositoryAdapter<OrderDTO>; lines: RepositoryAdapter<OrderItemDTO> },
  order: OrderDTO,
): Promise<void> {
  if (!KITCHEN_ORDER_STATES.includes(order.status)) return
  const all = (await deps.lines.findMany({ orderId: order.id })) as OrderItemDTO[]
  const active = all.filter((l) => isLineActive(l) && l.kind !== 'combo_header')
  if (!active.length) return
  let next: OrderDTO['status']
  if (active.every((l) => l.status === 'served')) next = 'served'
  else if (active.every((l) => l.status === 'ready' || l.status === 'served')) next = 'ready'
  else if (active.some((l) => l.status === 'preparing' || l.status === 'ready' || l.status === 'served')) next = 'preparing'
  else next = 'sent'
  if (next !== order.status) await deps.orders.update(order.id, { status: next } as Partial<Omit<OrderDTO, 'id'>>)
}

/** Cambia el estado de una línea (transición válida) y re-deriva el estado de la comanda. */
export async function setLineStatus(deps: KdsDeps, lineId: string, status: LineStatus, user: CurrentUser): Promise<OrderItemDTO> {
  if (!status || !(status in TRANSITIONS)) throw new ValidationError(`Estado de línea inválido: ${status}`)
  // findOne (no findById): el ownership se valida cargando la orden (findById + assertOwnership) abajo.
  const line = await deps.lines.findOne({ id: lineId })
  if (!line) throw new NotFoundError('Línea no encontrada')
  const order = await deps.orders.findById(line.orderId)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')

  if (!TRANSITIONS[line.status]?.includes(status)) {
    throw new ValidationError(`Transición inválida: ${line.status} → ${status}`)
  }
  const updated = (await deps.lines.update(lineId, { status } as Partial<Omit<OrderItemDTO, 'id'>>)) as OrderItemDTO
  await recomputeOrderStatus(deps, order)
  await deps.sockets.onLineStatusChanged?.(updated)
  return updated
}

/** Receta (ingredientes con nombre) de UN ítem de la carta, para la comanda del mozo. Vacío si no hay receta o no hay inventario. */
export async function menuItemIngredients(deps: Pick<KdsDeps, 'recipePorts'>, menuItemId: string, user: CurrentUser): Promise<{ data: RecipeIngredient[]; total: number }> {
  hotelFor(user)
  const port = deps.recipePorts?.getRecipeIngredients
  if (!port || !menuItemId) return { data: [], total: 0 }
  try {
    const data = (await port([menuItemId], user))[menuItemId] ?? []
    return { data, total: data.length }
  } catch { return { data: [], total: 0 } }
}
