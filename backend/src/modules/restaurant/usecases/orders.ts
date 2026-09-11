// restaurant/usecases/orders.ts — Ciclo de la comanda: abrir, listar, ver, enviar a cocina, cancelar (RES-3).
// Reglas: tipo↔tableId/reservationId; una mesa = una comanda abierta; cancelar libera la mesa.
// Los totales viven en order-totals; las líneas en order-lines. hotelId SIEMPRE del JWT.
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, TableDTO, OrderType, CurrentUser } from '../types'
import type { RestaurantSockets } from '../sockets'
import { nextOrderNumber, type CounterCas } from './order-number'
import { isUniqueViolation } from '../../../shared/utils/db-errors'

export interface OrdersDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  tables: RepositoryAdapter<TableDTO>
  config: RepositoryAdapter<any>
  /** UPDATE condicional para el numerador (#206). Lo cablea index.ts con el orm; ver order-number.ts. */
  counterCas?: CounterCas
  userRepo: RepositoryAdapter<any>
  auth: Auth
  sockets: RestaurantSockets
}

/** Reintentos cuando el UNIQUE (hotelId, number) rechaza la fila: el CAS ya evita casi todas las carreras. */
const NUMBER_RETRIES = 5

/**
 * Reserva el correlativo y crea la comanda, reintentando con un número mayor si otra apertura se
 * quedó con el mismo (mismo esquema que facturas/usecases/create-invoice.ts). Sin número de respaldo.
 */
async function createWithReservedNumber(
  deps: OrdersDeps,
  hotelId: string,
  buildRecord: (number: string) => Omit<OrderDTO, 'id'>,
): Promise<OrderDTO> {
  let minSeq = 0
  let lastError: unknown
  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
    const { number, seq } = await nextOrderNumber({ config: deps.config, counterCas: deps.counterCas }, hotelId, minSeq)
    try {
      return await deps.orders.create(buildRecord(number))
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      lastError = e
      minSeq = seq
    }
  }
  throw lastError
}

// Una comanda "ocupa" la mesa mientras no esté liquidada ni cancelada.
// `refunded` también es terminal: una orden reembolsada fue cobrada con tarjeta (la mesa ya se liberó
// al pagar) y no se puede reabrir; sin este flag, openOrder la ignoraría al buscar comandas activas
// en la mesa — correcto, pero deja la constant sin cobertura defensiva por si llegara otro estado derivado.
const TERMINAL: OrderDTO['status'][] = ['charged', 'paid', 'cancelled', 'refunded']
const ORDER_TYPES: OrderType[] = ['dine_in', 'room_service', 'takeaway']

// #210 — estados en los que una comanda YA enviada sigue aceptando un re-envío parcial (las líneas
// que el mozo agregó después). Fuera de estos (billed/charged/paid/cancelled/processing_payment/
// refunded) la cuenta ya está cerrada o en manos del cobro: no se manda nada más a cocina.
const RESENDABLE: OrderDTO['status'][] = ['sent', 'preparing', 'ready', 'served']

/** Tope defensivo de comensales: una mesa de más de 200 cubiertos es un tipeo, no un servicio. */
const MAX_COVERS = 200

export interface OpenOrderInput {
  type: OrderType
  tableId?: string
  reservationId?: string
  guestId?: string
  roomId?: string
  waiterId?: string
  /** #210 — comensales. Solo se persiste en `dine_in` (default 1); en el resto se ignora. */
  covers?: number
}

/**
 * #210 — Líneas que el mozo cargó y todavía NO confirmó a cocina. `status:'new'` por sí solo no
 * alcanza: una línea enviada sigue en `new` hasta que cocina la toma. El discriminador es `sentAt`.
 */
export function unsentLines(lines: OrderItemDTO[]): OrderItemDTO[] {
  return lines.filter((l) => l.status === 'new' && !l.sentAt)
}

function assertCovers(covers: number | undefined | null): number | undefined {
  if (covers === undefined || covers === null) return undefined
  const n = Number(covers)
  if (!Number.isInteger(n) || n < 1 || n > MAX_COVERS) {
    throw new ValidationError(`Los comensales deben ser un entero entre 1 y ${MAX_COVERS}`)
  }
  return n
}

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

export async function openOrder(deps: OrdersDeps, dto: OpenOrderInput, user: CurrentUser): Promise<OrderDTO> {
  const hotelId = hotelFor(user)
  if (!ORDER_TYPES.includes(dto.type)) throw new ValidationError(`Tipo de comanda inválido: ${dto.type}`)

  if (dto.type === 'dine_in') {
    if (!dto.tableId) throw new ValidationError('Una comanda en salón requiere una mesa (tableId)')
    // findOne (no findById): la mesa se valida por hotelId a mano, no es acceso por-ownership del que llama.
    const table = await deps.tables.findOne({ id: dto.tableId })
    if (!table || table.hotelId !== hotelId) throw new ValidationError('La mesa no existe o es de otro hotel')
    // Una mesa, una comanda abierta: rechazar si ya hay una no-liquidada en esa mesa.
    const onTable = (await deps.orders.findMany({ hotelId, tableId: dto.tableId })) as OrderDTO[]
    if (onTable.some((o) => !TERMINAL.includes(o.status))) {
      throw new ConflictError('La mesa ya tiene una comanda abierta')
    }
  } else if (dto.type === 'room_service') {
    if (!dto.reservationId) throw new ValidationError('Un room service requiere la reserva del huésped (reservationId)')
  }
  // takeaway: sin mesa ni reserva.

  const now = new Date().toISOString()
  const order = await createWithReservedNumber(deps, hotelId, (number) => ({
    hotelId,
    number,
    type: dto.type,
    tableId: dto.type === 'dine_in' ? dto.tableId : undefined,
    reservationId: dto.type === 'room_service' ? dto.reservationId : undefined,
    guestId: dto.guestId,
    roomId: dto.roomId,
    waiterId: dto.waiterId || user.id,   // users.id del mesero (por defecto, quien la abre)
    // #210 — comensales: mismo criterio que tableId arriba (solo tiene sentido en salón; en
    // room_service/takeaway se descarta en silencio). Default 1 para que el ticket promedio por
    // comensal del reporte del día nunca divida por null.
    covers: dto.type === 'dine_in' ? (assertCovers(dto.covers) ?? 1) : undefined,
    status: 'open',
    subtotal: 0, tax: 0, tip: 0, total: 0,
    openedAt: now,
  } as Omit<OrderDTO, 'id'>))

  if (order.type === 'dine_in' && order.tableId) {
    await deps.tables.update(order.tableId, { status: 'occupied' } as Partial<Omit<TableDTO, 'id'>>)
  }
  return order
}

export async function listOrders(deps: OrdersDeps, query: { status?: string; tableId?: string } | undefined, user: CurrentUser): Promise<{ data: OrderDTO[]; total: number }> {
  const filters: Record<string, unknown> = { hotelId: hotelFor(user) }
  if (query?.status) filters.status = query.status
  if (query?.tableId) filters.tableId = query.tableId
  const data = (await deps.orders.findMany(filters)) as OrderDTO[]
  data.sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')))
  return { data, total: data.length }
}

export async function getOrder(deps: OrdersDeps, id: string, user: CurrentUser): Promise<OrderDTO & { lines: OrderItemDTO[] }> {
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  const lines = (await deps.lines.findMany({ orderId: id })) as OrderItemDTO[]
  return { ...order, lines }
}

/**
 * Envía la comanda a cocina. Dos caminos, la MISMA ruta (`POST /orders/:id/send`):
 *
 *  - `open → sent`: primer envío. Exige al menos una línea viva y emite `onOrderSent` con todas.
 *  - comanda ya enviada (`sent|preparing|ready|served`): re-envío PARCIAL de las líneas que el mozo
 *    agregó después (#210). Idempotente — sin líneas sin confirmar devuelve la comanda tal cual (200),
 *    no un 409: el mozo puede tocar el botón dos veces sin romper nada.
 *
 * En ambos casos se estampa `sentAt` en las líneas despachadas: es lo que hace desaparecer el botón
 * "Enviar N nuevas" del ticket. El KDS NO mira `sentAt` (ver model.ts) — una línea nueva ya entra en
 * la cola apenas se agrega; el envío es la confirmación para el mozo, no la puerta de la cocina.
 */
export async function sendOrder(deps: OrdersDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  if (order.status !== 'open' && !RESENDABLE.includes(order.status)) {
    throw new ConflictError(`La comanda está ${order.status}; no se puede enviar a cocina`)
  }
  const lines = (await deps.lines.findMany({ orderId: id })) as OrderItemDTO[]
  const pending = unsentLines(lines)

  if (order.status === 'open') {
    if (!lines.some((l) => l.status !== 'cancelled')) throw new ValidationError('La comanda no tiene líneas para enviar')
    await stampSent(deps, pending)
    const updated = (await deps.orders.update(id, { status: 'sent' } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
    await deps.sockets.onOrderSent?.(updated, lines)
    return updated
  }

  if (!pending.length) return order
  const dispatched = await stampSent(deps, pending)
  // El header de un combo no es un plato a preparar (lo excluye `kdsQueue`): se estampa, pero no viaja
  // en el evento de cocina — la cocina recibe sus componentes, que sí son filas reales.
  await deps.sockets.onOrderSent?.(order, dispatched.filter((l) => l.kind !== 'combo_header'))
  return order
}

/** Marca las líneas como confirmadas a cocina y devuelve el snapshot ya estampado. */
async function stampSent(deps: OrdersDeps, lines: OrderItemDTO[]): Promise<OrderItemDTO[]> {
  const sentAt = new Date().toISOString()
  const out: OrderItemDTO[] = []
  for (const l of lines) {
    await deps.lines.update(l.id, { sentAt } as Partial<Omit<OrderItemDTO, 'id'>>)
    out.push({ ...l, sentAt })
  }
  return out
}

/** Cancela la comanda (si no está liquidada) y libera la mesa. Requiere restaurant:delete (ruta). */
export async function cancelOrder(deps: OrdersDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  if (order.status === 'charged' || order.status === 'paid') {
    throw new ConflictError('No se puede cancelar una comanda ya liquidada')
  }
  // fix-refund-pos-card: cancelar acá NO cancela la Checkout Session de Stripe que sigue abierta. Si
  // el huésped paga después, el webhook (`settlePaidOrder`) encontraría la orden `cancelled` en vez de
  // `processing_payment` y fallaría al confirmar. Hay que esperar a que expire (unsettleOrder la
  // vuelve a `billed`, recién ahí es cancelable) o a que confirme.
  if (order.status === 'processing_payment') {
    throw new ConflictError('La comanda tiene un cobro con tarjeta en curso — esperá a que se confirme o expire antes de cancelarla')
  }
  if (order.status === 'cancelled') return order
  const updated = (await deps.orders.update(id, { status: 'cancelled', closedAt: new Date().toISOString() } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  if (order.tableId) await deps.tables.update(order.tableId, { status: 'free' } as Partial<Omit<TableDTO, 'id'>>)
  return updated
}
