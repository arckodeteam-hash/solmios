// restaurant/usecases/settlement.ts — Cuenta y cobro de la comanda (RES-5).
// Dos vías MUTUAMENTE EXCLUYENTES: cargo a la habitación (folio) XOR cobro directo (payment). Una
// venta se cuenta UNA sola vez. El POS no mueve plata: delega en folios/payments vía puertos que
// inyecta un conector (setSettlementDeps). Ver specs/billing-payment.md + design.md.
//
// #214 (COR-A): acá NO se recalculan totales. `subtotal`/`tax`/`total` los escribe SOLO una edición de
// líneas/descuentos bajo el lock de líneas (order-lines.withLinesLock → recomputeTotals); el cobro los LEE
// de la fila fresca y los condiciona en el UPDATE condicional (`casOrder`). Un `recomputeTotals` desde acá
// (fuera del lock) pisaba con el valor viejo el total que una anulación acababa de escribir, y el CAS
// "matcheaba" contra ese valor: comanda `paid` con 100 sobre líneas por 40.
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser } from '../types'
import type { RestaurantSockets } from '../sockets'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { hasOpenPart, hasPaidParts } from './order-totals'
import { round2 } from '../../../shared/utils/money'
import { assertReservationOfHotel, assertReservationChargeable, type ReservationPort } from './reservation-port'
import { hotelToday } from '../../../shared/utils/hotel-schedule'
import { closingStamp } from './business-date'
import { reserveBalance, releaseBalance, casUpdate, assertLinesUnlocked, dueOf, type OrderForCas } from './order-cas'
import type { CounterCas } from './order-number'

// Puertos que provee el conector (folios/payments). El módulo NO importa esos módulos.
// `orderId` viaja SIEMPRE: el conector lo usa para construir `reference: 'pos:' + orderId`, la
// idempotency key que el módulo destino (payments/folios) usa para el claim-first atómico contra
// el UNIQUE index parcial (ver idempotencia-settlement-pos). Sin orderId acá, el conector no tiene
// forma de armar esa referencia.
// #214: `reference` opcional — una PARTE de un cobro dividido manda `pos:<orderId>:<n>`; sin él el
// conector arma `pos:<orderId>` (cobro entero, como siempre).
export interface ChargeToFolioInput { hotelId: string; reservationId: string; guestId?: string; roomId?: string; description: string; amount: number; quantity: number; orderId: string; reference?: string }
export interface RecordPaymentInput { hotelId: string; method: string; amount: number; description: string; folioId?: string; currency?: string; orderId: string; reference?: string; metadata?: Record<string, unknown> }
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
  reference?: string
  metadata?: Record<string, unknown>
}
export interface SettlementPorts {
  chargeToFolio?: (input: ChargeToFolioInput, user: CurrentUser) => Promise<{ folioId: string }>
  recordPayment?: (input: RecordPaymentInput, user: CurrentUser) => Promise<{ paymentId: string }>
  chargeCardPayment?: (input: ChargeCardPaymentInput, user: CurrentUser) => Promise<{ paymentId: string; checkoutUrl: string }>
  /** Devuelve el cobro. Por método: tarjeta vía Stripe; efectivo/transferencia con un asiento `refund` en payments (lo decide el conector). */
  refundPayment?: (input: { paymentId: string }, user: CurrentUser) => Promise<void>
  /** #214: ¿existe ya un payment con esta referencia `pos:*`? Para conciliar cuando el puerto falló DESPUÉS de cobrar. */
  findPaymentByReference?: (input: { hotelId: string; reference: string }) => Promise<{ paymentId: string; status: string; method: string } | null>
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
  // #208: la reserva a la que se carga la cuenta debe ser del hotel (connectors/restaurante-reservas.ts).
  reservations?: ReservationPort | null
  // #214: UPDATE condicional sobre la comanda (usecases/order-cas.ts). El cobro ENTERO reserva el saldo
  // completo con el MISMO CAS que usa una parte: nunca entran los dos. Lo cablea index.ts con el orm;
  // sin él (tests viejos con repos en memoria) degrada a read-modify-write.
  cas?: CounterCas
}

const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger

// Una comanda ya liquidada — o CANCELADA — no se liquida.
export function assertSettleable(order: OrderDTO): void {
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
  // #214: una PARTE con Checkout de tarjeta abierto es el mismo caso que `processing_payment`, solo que
  // vive en la fila hija: Stripe puede confirmarla en cualquier momento. Cobrar entero encima = dos
  // cobros sobre una comanda (y `onOrderPaid` dos veces: inventario doble).
  if (hasOpenPart(order)) throw new ConflictError('La comanda tiene una parte del cobro esperando la confirmación de Stripe')
  // #214: con una parte ya cobrada, el cobro ENTERO (payOrder/chargeToRoom) cobraría de nuevo lo que ya
  // entró. El saldo se termina de cobrar por partes (split-payments.ts).
  if (hasPaidParts(order)) throw new ConflictError('La comanda tiene pagos parciales: cobrá el saldo por partes')
}

/** Carga la comanda validando ownership (findById + assertOwnership inline en el mismo scope). */
export async function loadOrder(deps: SettlementDeps, id: string, user: CurrentUser): Promise<OrderDTO> {
  const order = await deps.orders.findById(id)
  if (!order) throw new NotFoundError('Comanda no encontrada')
  const me = await deps.userRepo.findById(user.id)
  deps.auth.assertOwnership(order.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
  return order
}

/**
 * #212 — etiqueta con la que el cobro viaja a `payments` y, por el conector payments→caja, al
 * concepto del movimiento de la caja del restaurante: "Comanda CMD-2026-0007 · Mesa 3". Antes el
 * movimiento decía "Pago automático" y desde la caja no había forma de saber qué mesa fue. La mesa
 * se lee acá (y no en caja) porque el módulo caja no conoce mesas ni comandas — el enlace lo arma
 * el frontend con `reference: pos:<orderId>`.
 */
export async function orderLabel(deps: SettlementDeps, order: OrderDTO): Promise<string> {
  const head = `Comanda ${order.number ?? order.id}`
  if (order.type === 'room_service') return `${head} · Room service`
  if (order.type === 'takeaway') return `${head} · Para llevar`
  if (!order.tableId) return head
  const table = await deps.tables.findById(order.tableId)
  if (!table?.name) return head
  // El nombre de la mesa es texto libre ("3", "M1", "Mesa 3"): no duplicar el "Mesa" si ya lo trae.
  return /^mesa\b/i.test(table.name) ? `${head} · ${table.name}` : `${head} · Mesa ${table.name}`
}

export async function freeTable(deps: SettlementDeps, order: OrderDTO): Promise<void> {
  if (!order.tableId) return
  const table = await deps.tables.update(order.tableId, { status: 'free' } as Partial<Omit<TableDTO, 'id'>>)
  if (table) await deps.sockets.onTableChanged?.(table)   // #211 — el Salón libera la mesa en vivo
}

/**
 * #214 — El cobro ENTERO (payOrder/chargeToRoom) reserva el saldo COMPLETO de la comanda con el mismo
 * UPDATE condicional que usa una parte (`amountReserved`): si una parte reservó en el medio, el CAS
 * relee, `assertSettleable` ve la parte en curso y da 409; si el entero reservó primero, la parte ve
 * saldo 0 y da 400. Antes las dos vías eran read-check-write cada una por su lado y entraban las dos
 * (efectivo entero + parte de 40 → 140 cobrados sobre 100). La reserva se suelta si el puerto de
 * dinero falla, y se pasa a 0 en el mismo UPDATE que cierra la comanda.
 */
async function holdWhole(deps: SettlementDeps, id: string): Promise<OrderForCas> {
  const { fresh } = await reserveBalance(deps, id, (o) => dueOf(o), (o) => assertSettleable(o))
  return fresh
}
const releaseWhole = (deps: SettlementDeps, order: OrderForCas): Promise<void> => releaseBalance({ ...deps, logger: deps.logger ?? silentLogger }, order.id, dueOf(order))

/**
 * Calcula la cuenta: fija la propina y el total (saldo + propina) sobre la fila fresca, con el CAS del
 * dinero (una edición de líneas en curso → 409; una que terminó en el medio → relee). Deja la comanda en `billed`.
 */
export async function billOrder(deps: SettlementDeps, id: string, dto: { tip?: number }, user: CurrentUser): Promise<OrderDTO> {
  const order = await loadOrder(deps, id, user)
  assertSettleable(order)
  const tip = round2(Number(dto.tip ?? order.tip ?? 0))
  if (!Number.isFinite(tip) || tip < 0) throw new ValidationError('La propina debe ser ≥ 0')
  return casUpdate(deps, id, (fresh) => { assertLinesUnlocked(fresh); assertSettleable(fresh) }, (fresh) => ({ tip, status: 'billed', total: round2(dueOf(fresh) + tip) }))
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
  // #208: ANTES de tocar el folio — la reserva (venga del body o de la comanda) tiene que existir y
  // ser del hotel de la comanda. 404 y ningún folio abierto si no.
  const reservation = await assertReservationOfHotel(deps.reservations, reservationId, order.hotelId, user)
  // #209: y tiene que estar ALOJADA (checked_in, o confirmed vigente hoy en la zona del hotel). Cargar a
  // una checked_out/cancelled/no_show/pending abriría o reabriría un folio que ya no representa a nadie
  // en la casa. 409 antes de tocar el folio. `findOne` (no findById): el hotel ya está validado por loadOrder.
  const hotel = await deps.hotels.findOne({ id: order.hotelId })
  assertReservationChargeable(reservation, hotelToday(hotel))
  // #209: el huésped y la habitación que viajan al folio son los de la RESERVA validada, nunca los que
  // la comanda traía. Una comanda de room service nace con los de su reserva original; si el cajero la
  // recarga a OTRA reserva sin folio abierto, `folios.open` heredaría guest/room de la primera y la
  // factura de B saldría a nombre de A. La comanda también se actualiza para que "Hab. 204 · Pérez"
  // diga a dónde fue el cargo de verdad.
  const guestId = reservation.guestId ?? undefined
  const roomId = reservation.roomId ?? undefined

  // #214: la comanda que se cobra es la que quedó RESERVADA (saldo completo, CAS): sus totales ya no
  // pueden cambiar por una parte ni por una línea mientras dure la reserva. Se LEEN de la fila reservada,
  // no se recalculan (COR-A, ver cabecera).
  const fresh = await holdWhole(deps, id)
  const amount = round2(Number(fresh.subtotal || 0))   // neto; el folio le aplica el impuesto
  let res: { folioId: string }
  try {
    // M2 (QA): el folio no transfiere la propina; en vez de perderla en silencio, se rechaza. La propina
    // se cobra directo (efectivo/tarjeta), no se carga a la habitación.
    if (Number(fresh.tip || 0) > 0) throw new ValidationError('La comanda tiene propina: el cargo a habitación no la transfiere. Cobrá directo o quitá la propina.')
    if (amount <= 0) throw new ValidationError('La comanda no tiene consumos para cargar')

    // M1 (QA, RESUELTO — idempotencia-settlement-pos): el cargo al folio sigue ocurriendo ANTES del
    // update de la comanda ("el dinero primero"), pero ya no puede duplicarse: `orderId` viaja hasta
    // el conector, que arma `reference: 'pos:' + orderId` y el módulo folios lo reclama atómico contra
    // un UNIQUE index parcial (claim-first). Si el update de la comanda fallara tras un postCharge
    // exitoso, el reintento vuelve a pedir el MISMO postCharge y folios devuelve el cargo ya existente
    // en vez de duplicarlo.
    res = await deps.ports.chargeToFolio({
      hotelId: order.hotelId, reservationId, guestId, roomId,
      description: `Restaurante · comanda ${order.number ?? id}`, amount, quantity: 1, orderId: id,
    }, user)
  } catch (e) {
    await releaseWhole(deps, fresh)
    throw e
  }
  // Lo que la comanda traía ANTES del cargo, para el rastro de "se cargó a otra reserva" (más abajo).
  const previous = { reservationId: order.reservationId ?? null, roomId: order.roomId ?? null, guestId: order.guestId ?? null }

  const updated = (await deps.orders.update(id, {
    status: 'charged', settlement: 'folio', folioId: res.folioId, amountReserved: 0,
    reservationId, guestId, roomId, ...(await closingStamp(deps.hotels, order.hotelId)),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await freeTable(deps, order)
  await deps.sockets.onOrderCharged?.(updated)
  // #209 (+#207): recargar la comanda a OTRA reserva que la que traía deja rastro — la factura de un
  // huésped cambió de dueño y alguien tiene que poder ver quién, cuándo y de qué reserva a cuál.
  if (previous.reservationId && previous.reservationId !== reservationId) {
    await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
      hotelId: order.hotelId,
      userId: user.id,
      action: 'restaurant.order.reservation_changed',
      entity: 'restaurant_order',
      entityId: id,
      detail: JSON.stringify({
        orderId: id, orderNumber: order.number, amount,
        fromReservationId: previous.reservationId, toReservationId: reservationId,
        fromRoomId: previous.roomId, toRoomId: roomId ?? null,
        fromGuestId: previous.guestId, toGuestId: guestId ?? null,
        folioId: res.folioId,
      }),
    })
  }
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

  // Chequeo temprano sobre lo leído (evita abrir una reserva por nada); el monto que se cobra sale de la fila RESERVADA.
  if (round2(dueOf(order) + Number(order.tip || 0)) <= 0) throw new ValidationError('La comanda no tiene monto para cobrar')
  if (dto.method === 'card') {
    if (!deps.ports.chargeCardPayment) throw new ValidationError('Cobro con tarjeta no disponible (payments no conectado)')
    if (!dto.successUrl || !dto.cancelUrl) {
      throw new ValidationError('successUrl y cancelUrl son obligatorios para cobrar con tarjeta (retorno del Checkout de Stripe)')
    }
  } else if (!deps.ports.recordPayment) throw new ValidationError('Cobro directo no disponible (payments no conectado)')

  // M3 (QA): la moneda sale del hotel (no default USD). findOne (no findById): el hotelId ya está
  // validado por loadOrder; solo releo ESE hotel para su moneda. Si el hotel no la define, payments defaultea.
  const hotel = await deps.hotels.findOne({ id: order.hotelId })
  const currency = (hotel as any)?.currency || undefined
  const description = await orderLabel(deps, order)

  // #214: reserva del saldo COMPLETO (CAS) antes de mover plata: desde acá ninguna parte entra, y si una
  // parte entró antes, esto da 409. El monto se toma de la fila reservada (bruto: impuesto y propina).
  const fresh = await holdWhole(deps, id)
  const amount = round2(dueOf(fresh) + Number(fresh.tip || 0))
  if (amount <= 0) { await releaseWhole(deps, fresh); throw new ValidationError('La comanda no tiene monto para cobrar') }

  if (dto.method === 'card') {
    let res: { paymentId: string; checkoutUrl: string }
    try {
      res = await deps.ports.chargeCardPayment!({
        orderId: id, hotelId: order.hotelId, amount, currency, description,
        successUrl: dto.successUrl!, cancelUrl: dto.cancelUrl!,
      }, user)
    } catch (e) {
      await releaseWhole(deps, fresh)
      throw e
    }

    // NO se libera la mesa ni se marca settlement/closedAt todavía: el cobro no está confirmado.
    // `settlePaidOrder` (webhook completed) o `unsettleOrder` (webhook expired) deciden el desenlace.
    // `processing_payment` es el que frena partes/cancelación/líneas desde acá; la reserva vuelve a 0.
    const updated = (await deps.orders.update(id, {
      status: 'processing_payment', paymentId: res.paymentId, amountReserved: 0,
    } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
    return { ...updated, checkoutUrl: res.checkoutUrl }
  }

  // M1 (QA, RESUELTO — idempotencia-settlement-pos): el payment se sigue creando ANTES del update de
  // la comanda ("el dinero primero"), pero ya no puede duplicarse: `orderId` viaja hasta el conector,
  // que arma `reference: 'pos:' + orderId` y el módulo payments lo reclama atómico contra un UNIQUE
  // index parcial (claim-first). Un reintento tras un payment completed pero update fallido devuelve
  // el MISMO payment en vez de crear uno nuevo.
  let res: { paymentId: string }
  try {
    res = await deps.ports.recordPayment!({
      hotelId: order.hotelId, method: dto.method, amount, currency,
      description, orderId: id,
    }, user)
  } catch (e) {
    await releaseWhole(deps, fresh)
    throw e
  }

  const updated = (await deps.orders.update(id, {
    status: 'paid', settlement: 'payment', paymentId: res.paymentId, amountReserved: 0,
    ...(await closingStamp(deps.hotels, order.hotelId)),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await freeTable(deps, order)
  await deps.sockets.onOrderPaid?.(updated)
  return updated
}

/**
 * Reembolsa una comanda cobrada DIRECTO (settlement='payment'): tarjeta, efectivo o transferencia. Delega
 * la devolución del dinero en payments vía `ports.refundPayment`, que decide por método (#214 COR-5:
 * tarjeta → Stripe; efectivo/transferencia → asiento `refund` en payments y egreso en la caja del
 * restaurante por el conector payments→caja). Antes efectivo/transferencia daban 400 desde Stripe; ahora
 * se devuelven de verdad — por eso el MOTIVO es obligatorio (como anular una línea o descontar) y queda en
 * el audit log `restaurant.order.refunded` con el método: una devolución en mano sin motivo es
 * indistinguible de un faltante de caja. El cargo a folio (settlement='folio') no tiene reversión aquí
 * (se ajusta en el folio). El inventario y la contabilidad se reversan por sockets (conectores).
 * Idempotente por estado: una segunda llamada sobre la misma orden ya `refunded` devuelve sin repetir
 * el port ni el socket (guard anti-reentrada).
 */
export async function refundOrder(deps: SettlementDeps, id: string, dto: { reason?: string }, user: CurrentUser): Promise<OrderDTO> {
  const reasonText = String(dto?.reason ?? '').trim()
  if (!reasonText) throw new ValidationError('Indicá el motivo del reembolso')
  const order = await loadOrder(deps, id, user)
  // Idempotencia por estado: ya reembolsada → no-op (no duplica port ni socket).
  if (order.status === 'refunded') return order
  // #214: un cobro dividido se devuelve POR PARTE (refundOrderPayment): cada parte tiene su payment.
  if (hasPaidParts(order)) throw new ConflictError('La comanda se cobró por partes: reembolsá cada parte desde Pagos')
  // Solo se reembolsa un cobro DIRECTO. El cargo a habitación se ajusta en el folio (reversal = nota de crédito).
  if (order.status !== 'paid' || order.settlement !== 'payment') {
    throw new ConflictError('Solo se puede reembolsar una orden cobrada directo (efectivo, tarjeta o transferencia); el cargo a habitación se ajusta desde el folio')
  }
  if (!order.paymentId) throw new ValidationError('La comanda no tiene payment asociado')
  if (!deps.ports.refundPayment) throw new ValidationError('Reembolso no disponible (payments no conectado)')

  // M1 (QA, deuda documentada): el refund del payment se llama ANTES del update de la comanda
  // ("el dinero primero", misma convención que payOrder/chargeToRoom). Si el update fallara tras un
  // refund exitoso, un reintento encontraría la orden aún `paid` y repetiría el refund. Aceptado: el
  // refund de gateway es idempotente por paymentId (stripe); un fix robusto = idempotency key propia.
  await deps.ports.refundPayment({ paymentId: order.paymentId }, user)

  // #213 (auditoría): NO se pisa closedAt/businessDate — la venta sigue en el cierre del día en que se
  // cobró; el reembolso lo muestra el día en que se devolvió, leído de `payments` (type:'refund').
  const updated = (await deps.orders.update(id, {
    status: 'refunded',
    refundedAt: new Date().toISOString(),
  } as Partial<Omit<OrderDTO, 'id'>>)) as OrderDTO
  await deps.sockets.onOrderRefunded?.(updated)
  await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
    hotelId: order.hotelId,
    userId: user.id,
    action: 'restaurant.order.refunded',
    entity: 'restaurant_order',
    entityId: id,
    detail: JSON.stringify({ orderId: id, orderNumber: order.number, paymentId: order.paymentId, amount: round2(Number(order.total || 0)), reason: reasonText }),
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
    ...(await closingStamp(deps.hotels, order.hotelId)),
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
