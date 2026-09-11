// restaurant/usecases/settlement.ts — Cuenta y cobro de la comanda (RES-5).
// Dos vías MUTUAMENTE EXCLUYENTES: cargo a la habitación (folio) XOR cobro directo (payment). Una
// venta se cuenta UNA sola vez. El POS no mueve plata: delega en folios/payments vía puertos que
// inyecta un conector (setSettlementDeps). Ver specs/billing-payment.md + design.md.
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser } from '../types'
import type { RestaurantSockets } from '../sockets'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { recomputeTotals } from './order-totals'
import { round2 } from '../../../shared/utils/money'

// Puertos que provee el conector (folios/payments). El módulo NO importa esos módulos.
// `orderId` viaja SIEMPRE: el conector lo usa para construir `reference: 'pos:' + orderId`, la
// idempotency key que el módulo destino (payments/folios) usa para el claim-first atómico contra
// el UNIQUE index parcial (ver idempotencia-settlement-pos). Sin orderId acá, el conector no tiene
// forma de armar esa referencia.
export interface ChargeToFolioInput { hotelId: string; reservationId: string; guestId?: string; roomId?: string; description: string; amount: number; quantity: number; orderId: string }
export interface RecordPaymentInput { hotelId: string; method: string; amount: number; description: string; folioId?: string; currency?: string; orderId: string }
// fix-refund-pos-card: cobro con tarjeta vía Stripe Checkout Session (reemplaza el `recordPayment`
// manual para method==='card'). `successUrl`/`cancelUrl` vienen del frontend (vuelta a la orden con
// query param); `orderId` viaja igual que en recordPayment/chargeToFolio para que el conector arme
// `reference: 'pos:' + orderId` (mismo esquema de idempotencia-settlement-pos).
export interface ChargeCardPaymentInput {
  orderId: string
  hotelId: string
  amount: number
  currency?: string
  description: string
  successUrl: string
  cancelUrl: string
}
export interface SettlementPorts {
  chargeToFolio?: (input: ChargeToFolioInput, user: CurrentUser) => Promise<{ folioId: string }>
  recordPayment?: (input: RecordPaymentInput, user: CurrentUser) => Promise<{ paymentId: string }>
  chargeCardPayment?: (input: ChargeCardPaymentInput, user: CurrentUser) => Promise<{ paymentId: string; checkoutUrl: string }>
  refundPayment?: (input: { paymentId: string }, user: CurrentUser) => Promise<void>
}

export interface SettlementDeps {
  orders: RepositoryAdapter<OrderDTO>
  lines: RepositoryAdapter<OrderItemDTO>
  tables: RepositoryAdapter<TableDTO>
  hotels: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
  sockets: RestaurantSockets
  ports: SettlementPorts
  // #207: auditoría del reembolso (puerto inyectado por connectors/restaurante-auditlog.ts). Opcional.
  audit?: AuditPort | null
  logger?: Logger
}

const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger

// Una comanda ya liquidada — o CANCELADA — no se liquida.
function assertSettleable(order: OrderDTO): void {
  // A1 (QA): sin este guard, una comanda `cancelled` (que NO cancela sus líneas) se podía cobrar/cargar
  // al folio → dinero por una venta anulada.
  if (order.status === 'cancelled') throw new ConflictError('La comanda está cancelada')
  // fix-refund-pos-card: mientras espera el webhook de Stripe (Checkout Session abierta), un doble
  // click de payOrder(card) NO debe abrir una SEGUNDA sesión — el cajero espera a que expire (15/30min,
  // ver StripeGateway.createCharge) o a que confirme, nunca se reintenta sobre la misma orden.
  if (order.status === 'processing_payment') {
    throw new ConflictError('La comanda está esperando la confirmación del cobro con tarjeta')
  }
  if (order.settlement || order.status === 'charged' || order.status === 'paid') {
    throw new ConflictError('La comanda ya fue liquidada')
  }
}

/** Carga la comanda validando ownership (findById + assertOwnership inline en el mismo scope). */
export async function loadOrder(deps: SettlementDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  return order
}

async function freeTable(deps: SettlementDeps, order: OrderDTO): Promise<void> {
  if (order.tableId) await deps.tables.update(order.tableId, { status: 'free' } as Partial<Omit<TableDTO, 'id'>>)
}

/** Calcula la cuenta: recomputa subtotal/tax y fija la propina. Deja la comanda en `billed`. */
export async function billOrder(deps: SettlementDeps, id: string, dto: { tip?: number }, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrder(deps, id, user)
  assertSettleable(order)
  const tip = round2(Number(dto.tip ?? order.tip ?? 0))
  if (!Number.isFinite(tip) || tip < 0) throw new ValidationError('La propina debe ser ≥ 0')
  await deps.orders.update(id, { tip, status: 'billed' } as Partial<Omit<OrderDTO, 'id'>>)
  return recomputeTotals(deps, { ...order, tip, status: 'billed' })
}

/**
 * Carga la comanda a la habitación del huésped (folio). Postea el SUBTOTAL NETO: el folio aplica su
 * propio impuesto (como todo room-charge) → no se dobla el ITBIS. La propina NO se transfiere al folio
 * (solo aplica al cobro directo). Deja la comanda en `charged` y libera la mesa.
 */
export async function chargeToRoom(deps: SettlementDeps, id: string, dto: { reservationId?: string }, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrder(deps, id, user)
  assertSettleable(order)
  const reservationId = dto.reservationId || order.reservationId
  if (!reservationId) throw new ValidationError('La comanda no tiene reserva asociada; solo cabe el cobro directo')
  if (!deps.ports.chargeToFolio) throw new ValidationError('Cargo a habitación no disponible (folios no conectado)')

  const fresh = await recomputeTotals(deps, order)
  // M2 (QA): el folio no transfiere la propina; en vez de perderla en silencio, se rechaza. La propina
  // se cobra directo (efectivo/tarjeta), no se carga a la habitación.
  if (Number(fresh.tip || 0) > 0) throw new ValidationError('La comanda tiene propina: el cargo a habitación no la transfiere. Cobrá directo o quitá la propina.')
  const amount = round2(Number(fresh.subtotal || 0))   // neto; el folio le aplica el impuesto
  if (amount <= 0) throw new ValidationError('La comanda no tiene consumos para cargar')

  // M1 (QA, RESUELTO — idempotencia-settlement-pos): el cargo al folio sigue ocurriendo ANTES del
  // update de la comanda ("el dinero primero"), pero ya no puede duplicarse: `orderId` viaja hasta
  // el conector, que arma `reference: 'pos:' + orderId` y el módulo folios lo reclama atómico contra
  // un UNIQUE index parcial (claim-first). Si el update de la comanda fallara tras un postCharge
  // exitoso, el reintento vuelve a pedir el MISMO postCharge y folios devuelve el cargo ya existente
  // en vez de duplicarlo.
  const res = await deps.ports.chargeToFolio({
    hotelId: order.hotelId, reservationId, guestId: order.guestId, roomId: order.roomId,
    description: `Restaurante · comanda ${order.number ?? id}`, amount, quantity: 1, orderId: id,
  }, user)

  const updated = (await deps.orders.update(id, {
    status: 'charged', settlement: 'folio', folioId: res.folioId,
    reservationId, closedAt: new Date().toISOString(),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await freeTable(deps, order)
  await deps.sockets.onOrderCharged?.(updated)
  return updated
}

/**
 * Cobra la comanda directo (efectivo/tarjeta/transferencia). Cobra el TOTAL BRUTO (subtotal + tax +
 * propina). El asiento de caja lo hace payments; el ingreso "Ventas Restaurante" lo reconoce el
 * conector de contabilidad (RES-6) al escuchar onOrderPaid.
 *
 * fix-refund-pos-card: `method==='card'` YA NO es síncrono. En vez de `recordPayment` (payment manual
 * sin cargo real, irreembolsable — ver openspec fix-refund-pos-card) abre una Stripe Checkout Session
 * vía `chargeCardPayment` y deja la comanda en `processing_payment` — NO `paid`, NO libera la mesa
 * todavía. El webhook de Stripe (`settlePaidOrder`/`unsettleOrder`, cableados por el conector
 * restaurante-payments) confirma o expira el cobro de forma asíncrona. `cash`/`transfer` no cambian:
 * siguen síncronos vía `recordPayment`.
 */
export async function payOrder(
  deps: SettlementDeps,
  id: string,
  dto: { method: string; successUrl?: string; cancelUrl?: string },
  user: CurrentUser,
): Promise<OrderDTO & { checkoutUrl?: string }> {
  const order = await loadOrder(deps, id, user)
  assertSettleable(order)
  if (!dto.method) throw new ValidationError('El método de cobro es obligatorio')

  const fresh = await recomputeTotals(deps, order)
  const amount = round2(Number(fresh.total || 0))   // bruto: incluye impuesto y propina
  if (amount <= 0) throw new ValidationError('La comanda no tiene monto para cobrar')

  // M3 (QA): la moneda sale del hotel (no default USD). findOne (no findById): el hotelId ya está
  // validado por loadOrder; solo releo ESE hotel para su moneda. Si el hotel no la define, payments defaultea.
  const hotel = await deps.hotels.findOne({ id: order.hotelId })
  const currency = (hotel as any)?.currency || undefined
  const description = `Restaurante · comanda ${order.number ?? id}`

  if (dto.method === 'card') {
    if (!deps.ports.chargeCardPayment) throw new ValidationError('Cobro con tarjeta no disponible (payments no conectado)')
    if (!dto.successUrl || !dto.cancelUrl) {
      throw new ValidationError('successUrl y cancelUrl son obligatorios para cobrar con tarjeta (retorno del Checkout de Stripe)')
    }

    const res = await deps.ports.chargeCardPayment({
      orderId: id, hotelId: order.hotelId, amount, currency, description,
      successUrl: dto.successUrl, cancelUrl: dto.cancelUrl,
    }, user)

    // NO se libera la mesa ni se marca settlement/closedAt todavía: el cobro no está confirmado.
    // `settlePaidOrder` (webhook completed) o `unsettleOrder` (webhook expired) deciden el desenlace.
    const updated = (await deps.orders.update(id, {
      status: 'processing_payment', paymentId: res.paymentId,
    } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
    return { ...updated, checkoutUrl: res.checkoutUrl }
  }

  if (!deps.ports.recordPayment) throw new ValidationError('Cobro directo no disponible (payments no conectado)')

  // M1 (QA, RESUELTO — idempotencia-settlement-pos): el payment se sigue creando ANTES del update de
  // la comanda ("el dinero primero"), pero ya no puede duplicarse: `orderId` viaja hasta el conector,
  // que arma `reference: 'pos:' + orderId` y el módulo payments lo reclama atómico contra un UNIQUE
  // index parcial (claim-first). Un reintento tras un payment completed pero update fallido devuelve
  // el MISMO payment en vez de crear uno nuevo.
  const res = await deps.ports.recordPayment({
    hotelId: order.hotelId, method: dto.method, amount, currency,
    description, orderId: id,
  }, user)

  const updated = (await deps.orders.update(id, {
    status: 'paid', settlement: 'payment', paymentId: res.paymentId,
    closedAt: new Date().toISOString(),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await freeTable(deps, order)
  await deps.sockets.onOrderPaid?.(updated)
  return updated
}

/**
 * Reembolsa una comanda cobrada con tarjeta (settlement='payment'). Delega la devolución del dinero
 * en payments vía `ports.refundPayment` (idempotente por paymentId del lado del gateway). v1 solo
 * reembolsa cobros directos con tarjeta: el cargo a folio (settlement='folio') no tiene reversión
 * aquí (deuda documentada). El inventario y la contabilidad se reversan por sockets (conectores).
 * Idempotente por estado: una segunda llamada sobre la misma orden ya `refunded` devuelve sin repetir
 * el port ni el socket (guard anti-reentrada).
 */
export async function refundOrder(deps: SettlementDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrder(deps, id, user)
  // Idempotencia por estado: ya reembolsada → no-op (no duplica port ni socket).
  if (order.status === 'refunded') return order
  // Solo se puede reembolsar una orden cobrada directo con tarjeta. Folio (cargo a habitación) y
  // cash quedan fuera de v1 (ver deudas: reversal de folio requiere credit-note; cash no tiene gateway).
  if (order.status !== 'paid' || order.settlement !== 'payment') {
    throw new ConflictError('Solo se puede reembolsar una orden cobrada con tarjeta')
  }
  if (!order.paymentId) throw new ValidationError('La comanda no tiene payment asociado')
  if (!deps.ports.refundPayment) throw new ValidationError('Reembolso no disponible (payments no conectado)')

  // M1 (QA, deuda documentada): el refund del payment se llama ANTES del update de la comanda
  // ("el dinero primero", misma convención que payOrder/chargeToRoom). Si el update fallara tras un
  // refund exitoso, un reintento encontraría la orden aún `paid` y repetiría el refund. Aceptado: el
  // refund de gateway es idempotente por paymentId (stripe); un fix robusto = idempotency key propia.
  await deps.ports.refundPayment({ paymentId: order.paymentId }, user)

  const updated = (await deps.orders.update(id, {
    status: 'refunded',
    closedAt: new Date().toISOString(),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await deps.sockets.onOrderRefunded?.(updated)
  await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
    hotelId: order.hotelId,
    userId: user.id,
    action: 'restaurant.order.refunded',
    entity: 'restaurant_order',
    entityId: id,
    detail: JSON.stringify({ orderId: id, orderNumber: order.number, paymentId: order.paymentId, amount: round2(Number(order.total || 0)) }),
  })
  return updated
}

/**
 * fix-refund-pos-card: confirma el cobro con tarjeta que el webhook de Stripe (checkout.session.completed)
 * acaba de asentar. Lo llama el conector `restaurante-payments` (`onPaymentCompleted`), con un user
 * sintético (sin request real) — por eso NO valida `dto.method`, solo el ESTADO de la comanda.
 * Idempotente: si ya está `paid` (reintento del webhook / evento duplicado que igual llegó a llamar
 * esto dos veces), no-op — no vuelve a liberar la mesa ni a emitir el socket.
 */
export async function settlePaidOrder(deps: SettlementDeps, id: string, paymentId: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrder(deps, id, user)
  if (order.status === 'paid') return order   // idempotente: ya confirmada, no repetir el socket
  if (order.status !== 'processing_payment') {
    throw new ConflictError('La comanda no está esperando confirmación de un cobro con tarjeta')
  }

  const updated = (await deps.orders.update(id, {
    status: 'paid', settlement: 'payment', paymentId,
    closedAt: new Date().toISOString(),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await freeTable(deps, order)
  await deps.sockets.onOrderPaid?.(updated)
  return updated
}

/**
 * fix-refund-pos-card: revierte una comanda `processing_payment` cuya Checkout Session EXPIRÓ
 * (checkout.session.expired, 15/30min — ver StripeGateway.createCharge) sin que el huésped completara
 * el pago. Vuelve a `billed` (NO `served`: la cuenta ya se había calculado) y LIBERA LA MESA — decisión
 * de producto 2026-07-28: el cajero re-cobra con una Checkout Session NUEVA, no se reintenta la
 * expirada. Idempotente: si ya salió de `processing_payment` (billed/paid/lo que sea), no-op.
 */
export async function unsettleOrder(deps: SettlementDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrder(deps, id, user)
  if (order.status !== 'processing_payment') return order   // idempotente: ya no está esperando

  // `paymentId: null` limpia el puntero al payment CANCELLED de la sesión expirada — así una
  // comanda `billed` nunca queda apuntando a un payment que ya no representa nada cobrado. `null`
  // (no `undefined`) porque el ORM solo persiste ausencia de columna con `undefined`; acá se quiere
  // escribir explícitamente NULL. `unknown` de paso: OrderDTO tipa `paymentId?: string`, sin `null`.
  const updated = (await deps.orders.update(id, {
    status: 'billed', paymentId: null,
  } as unknown as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await freeTable(deps, order)
  return updated
}
