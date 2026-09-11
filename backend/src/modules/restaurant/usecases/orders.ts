// restaurant/usecases/orders.ts — Ciclo de la comanda: abrir, listar, ver, enviar a cocina, cancelar (RES-3).
// Reglas: tipo↔tableId/reservationId; una mesa = una comanda abierta; cancelar libera la mesa.
// Los totales viven en order-totals; las líneas en order-lines. hotelId SIEMPRE del JWT.
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, TableDTO, OrderType, CurrentUser } from '../types'
import type { RestaurantSockets } from '../sockets'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { nextOrderNumber } from './order-number'
import { isLineActive, round2 } from './order-totals'

export interface OrdersDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  tables: RepositoryAdapter<TableDTO>
  config: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  sockets: RestaurantSockets
  // #207: auditoría de cancelaciones (puerto inyectado por connectors/restaurante-auditlog.ts). Opcional.
  audit?: AuditPort | null
  logger?: Logger
}

const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger

// Una comanda "ocupa" la mesa mientras no esté liquidada ni cancelada.
// `refunded` también es terminal: una orden reembolsada fue cobrada con tarjeta (la mesa ya se liberó
// al pagar) y no se puede reabrir; sin este flag, openOrder la ignoraría al buscar comandas activas
// en la mesa — correcto, pero deja la constant sin cobertura defensiva por si llegara otro estado derivado.
const TERMINAL: OrderDTO['status'][] = ['charged', 'paid', 'cancelled', 'refunded']
const ORDER_TYPES: OrderType[] = ['dine_in', 'room_service', 'takeaway']

export interface OpenOrderInput {
  type: OrderType
  tableId?: string
  reservationId?: string
  guestId?: string
  roomId?: string
  waiterId?: string
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
  const order = await deps.orders.create({
    hotelId,
    number: await nextOrderNumber(deps.config, hotelId),
    type: dto.type,
    tableId: dto.type === 'dine_in' ? dto.tableId : undefined,
    reservationId: dto.type === 'room_service' ? dto.reservationId : undefined,
    guestId: dto.guestId,
    roomId: dto.roomId,
    waiterId: dto.waiterId || user.id,   // users.id del mesero (por defecto, quien la abre)
    status: 'open',
    subtotal: 0, tax: 0, tip: 0, total: 0,
    openedAt: now,
  } as Omit<OrderDTO, 'id'>)

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

/** Envía la comanda a cocina (open → sent). Emite el evento para el KDS. */
export async function sendOrder(deps: OrdersDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  if (order.status !== 'open') throw new ConflictError(`La comanda ya fue enviada (estado ${order.status})`)
  const lines = (await deps.lines.findMany({ orderId: id })) as OrderItemDTO[]
  if (!lines.some(isLineActive)) throw new ValidationError('La comanda no tiene líneas para enviar')
  const updated = (await deps.orders.update(id, { status: 'sent' } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await deps.sockets.onOrderSent?.(updated, lines)
  return updated
}

/**
 * Cancela la comanda (si no está liquidada) y libera la mesa. Requiere restaurant:delete (ruta).
 * #207: exige `reason`. Si la comanda ya había salido a cocina (estado ≠ open), sus líneas vivas pasan
 * a `voided` con ese motivo — así el KDS y el reporte de anulaciones ven lo mismo que la comanda. Una
 * comanda `open` nunca llegó a cocina: sus líneas quedan como estaban (fue un error de toma, no una
 * anulación). Audita `restaurant.order.cancelled` con el monto que se dejó de cobrar.
 */
export async function cancelOrder(deps: OrdersDeps, id: string, reason: string | undefined, user: CurrentUser): Promise<OrderDTO> {
  const reasonText = String(reason ?? '').trim()
  if (!reasonText) throw new ValidationError('Indicá el motivo de la cancelación')
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
  const now = new Date().toISOString()
  // Snapshot ANTES de escribir: un adapter puede devolver la misma referencia que después muta.
  const previousStatus = order.status
  const amount = round2(Number(order.total || 0))
  let voidedLines = 0
  if (order.status !== 'open') {
    const lines = ((await deps.lines.findMany({ orderId: id })) as OrderItemDTO[]).filter(isLineActive)
    const voidPatch = { status: 'voided', voidReason: reasonText, voidedBy: user.id, voidedAt: now } as Partial<Omit<OrderItemDTO, 'id'>>
    for (const l of lines) await deps.lines.update(l.id, voidPatch)
    voidedLines = lines.length
  }
  const updated = (await deps.orders.update(id, { status: 'cancelled', closedAt: now } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  if (order.tableId) await deps.tables.update(order.tableId, { status: 'free' } as Partial<Omit<TableDTO, 'id'>>)
  await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
    hotelId: order.hotelId,
    userId: user.id,
    action: 'restaurant.order.cancelled',
    entity: 'restaurant_order',
    entityId: id,
    detail: JSON.stringify({
      orderId: id, orderNumber: order.number, tableId: order.tableId, previousStatus,
      amount, voidedLines, reason: reasonText,
    }),
  })
  return updated
}
