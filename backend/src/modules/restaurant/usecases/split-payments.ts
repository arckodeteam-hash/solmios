// restaurant/usecases/split-payments.ts — #214 (REST-12): dividir la cuenta / pagos parciales.
//
// Una comanda se puede saldar en N PARTES (`restaurant_order_payments`), cada una con su método
// (efectivo, transferencia, tarjeta por Stripe Checkout, o cargo a la habitación). El dinero sigue
// viviendo en `payments`/`folio_charges` (una fila por parte, referencia idempotente
// `pos:<orderId>:<n>`); acá solo se lleva la cuenta de cuánto falta y se cierra la comanda cuando el
// saldo llega a 0. Reglas que están acá y no hay que romper:
//   - El saldo es `subtotal + tax` (lo consumido). La propina va POR PARTE, encima del monto, y nunca
//     en una parte `room` (el folio no la transfiere; misma regla que chargeToRoom).
//   - Sobrepago → 400 (`amount > saldo disponible + BALANCE_EPSILON`, patrón de pay-invoice.ts). El
//     saldo disponible descuenta las partes `pending` (Checkout de tarjeta abierto).
//   - El saldo se RESERVA con un UPDATE condicional sobre la comanda (`amountReserved`, usecases/order-cas.ts,
//     mismo patrón `counterCas` del numerador #206) ANTES de crear la parte: dos partes de 100 sobre un
//     saldo de 100 entran una sola — la otra rebota con 400 aunque las dos hayan leído el mismo saldo. El
//     cobro ENTERO (settlement.ts) y cancelar (orders.ts) pasan por el MISMO CAS: una parte y un cobro
//     entero nunca entran los dos, y no se cancela con dinero adentro o en curso.
//   - `seq` se RECLAMA creando la fila `pending` (UNIQUE (orderId, seq)); recién con la fila creada se
//     mueve la plata. Dos cajeros a la vez no pueden usar el mismo `n` → nunca la misma referencia. El
//     `seq` es MONÓTONO: una parte `failed`/`expired` se queda con el suyo (su referencia ya pudo quedar
//     reclamada en payments) — nunca se borra una parte para reutilizar el número.
//   - Mientras una parte está `pending` (`amountReserved > 0`), la comanda NO se cobra entera, NO se
//     cancela y NO se tocan líneas (`order-totals.hasOpenPart`): Stripe puede confirmarla en cualquier
//     momento. Es el `processing_payment` de una parte. Y al revés (COR-A): mientras se editan líneas
//     (`linesLockedUntil`, order-cas.ts) no se reserva saldo, y una parte por líneas reverifica sus líneas
//     DENTRO del hold — una línea anulada en el medio → 409 antes de mover plata.
//   - Devolver una parte con la comanda ABIERTA (COR-C) la deja `reversed`: el saldo se reabre y sus líneas
//     quedan libres. Con la comanda liquidada, `refunded`: sigue pesando en el saldo (no se reabre).
//     Mientras la devolución está EN CURSO, su monto pasa de `amountPaid` a `amountReserved` con el mismo
//     CAS (holdReversal): la parte que cierra la cuenta compite por `amountPaid` y ya no la ve como cobrada,
//     y nadie reserva ese saldo hasta que el puerto responda (si falla, vuelve a cobrada por el mismo CAS).
//   - La comanda se cierra SOLO cuando `amountPaid` — el acumulado de la FILA, no la suma de las partes —
//     llega al saldo, en el MISMO UPDATE condicional que libera la reserva de la última parte: el que gana
//     ese CAS emite UN solo socket — inventario descuenta UNA vez, la mesa se libera UNA vez.
//   - Acá NO se recalculan totales (COR-A): `subtotal`/`tax` los escribe solo una edición de líneas bajo su
//     lock (order-lines.withLinesLock); el dinero los lee de la fila fresca y los condiciona en el CAS. Con alguna parte directa queda `paid` (+ `onOrderPaid` con la porción cobrada
//     directo, ver `directPortion`: la porción a habitación ya la devenga folios-accounting por su
//     folio_charge). Si TODA la cuenta fue a habitaciones queda exactamente como `chargeToRoom`:
//     `charged` + `folio` + `onOrderCharged` — una sola representación para "cargada a la habitación".
//   - Dividir por partes iguales: N montos que suman EXACTO el saldo; el centavo sobrante va a la última.
//   - Dividir por líneas: una línea no se paga dos veces; cuando la selección termina de cubrir todas las
//     líneas cobrables, la parte vale el saldo exacto (absorbe el redondeo del impuesto). El bruto de una
//     línea respeta los descuentos (#215): su neto descontado, prorrateado por el descuento de comanda.
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError, ConflictError } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, OrderPaymentDTO, OrderPaymentMethod, OrderBalance, CurrentUser, Settlement } from '../types'
import { round2, BALANCE_EPSILON } from '../../../shared/utils/money'
import { isUniqueViolation } from '../../../shared/utils/db-errors'
import { auditSafely } from '../../../shared/usecases/audit'
import { hotelToday } from '../../../shared/utils/hotel-schedule'
import { isLineActive, isTerminalOrder, computeOrderTotals } from './order-totals'
import { closingStamp } from './business-date'
import { loadOrder, orderLabel, freeTable, assertSettleable, type SettlementDeps } from './settlement'
import { assertReservationOfHotel, assertReservationChargeable } from './reservation-port'
import type { CounterCas } from './order-number'
import { freshForCas, casOrder, casUpdate, reserveBalance, releaseBalance, dueOf, ORDER_PAYMENTS_MODEL, CAS_ATTEMPTS, type OrderForCas } from './order-cas'

export interface SplitPaymentsDeps extends SettlementDeps {
  orderPayments: RepositoryAdapter<OrderPaymentDTO>
  /** UPDATE condicional sobre `RestaurantOrders` / `RestaurantOrderPayments` (el `orm` real en producción, ver index.ts). Obligatorio acá (falla cerrado en deps.ts). */
  cas: CounterCas
}

export interface AddOrderPaymentInput {
  method: OrderPaymentMethod
  amount?: number
  tip?: number
  reservationId?: string
  lineIds?: string[]
  successUrl?: string
  cancelUrl?: string
}

export interface AddOrderPaymentResult { part: OrderPaymentDTO; order: OrderDTO; balance: OrderBalance; checkoutUrl?: string }
// #279: SIN `data`/`total` en el primer nivel. `buildEnvelope` (arckode-framework kernel/http/server.ts) toma
// `{ data: [], total }` como lista paginada, manda `total` a `meta.pagination` y DESCARTA cualquier otra clave:
// `balance` no llegaba al frontend y "Dividir cuenta" quedaba en blanco. Con `parts` el envelope lo envuelve entero.
export interface OrderPaymentsList { parts: OrderPaymentDTO[]; balance: OrderBalance }
export interface SplitPreview { due: number; outstanding: number; parts: number[] }

export const MAX_SPLIT_PARTS = 50
const silentLogger = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as unknown as Logger
type NewOrderPayment = Omit<OrderPaymentDTO, 'id' | 'seq' | 'createdAt' | 'updatedAt'>

// ─── Puro ─────────────────────────────────────────────────────────────────────

/** N montos que suman EXACTO `total` (en centavos enteros); el resto de la división va a la última parte. */
export function splitEqual(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1 || parts > MAX_SPLIT_PARTS) throw new ValidationError(`Las partes deben ser un entero entre 1 y ${MAX_SPLIT_PARTS}`)
  const cents = Math.round(round2(total) * 100)
  const base = Math.floor(cents / parts)
  const out = Array.from({ length: parts }, () => base / 100)
  out[parts - 1] = (cents - base * (parts - 1)) / 100
  return out
}

/** Una parte cobrada pesa en el saldo aunque después se devuelva (o esté devolviéndose): la devolución no reabre la cuenta. */
const isPaidPart = (p: OrderPaymentDTO): boolean => p.status === 'completed' || p.status === 'refunding' || p.status === 'refunded'
/** Una parte que no pesa en el saldo ni retiene líneas: vencida (Checkout expirado), fallida (el puerto no cobró) o
 *  devuelta con la comanda abierta (`reversed`, COR-C: la plata volvió y el saldo se reabrió). Su `seq` queda quemado. */
const isDeadPart = (p: OrderPaymentDTO): boolean => p.status === 'expired' || p.status === 'failed' || p.status === 'reversed'
const isDirect = (p: OrderPaymentDTO): boolean => p.method !== 'room'
/** Una parte `pending` RESERVA saldo: Checkout de tarjeta abierto, o una parte que quedó a medias (ver claimPart). */
const isOpenPart = (p: OrderPaymentDTO): boolean => p.status === 'pending'
// Una parte cash/transfer/room `pending` es una que quedó a medias (el dinero entró y no se pudo marcar):
// su reintento la retoma con la MISMA referencia (ver claimPart). Una `card` pending es un Checkout vivo.
const isStuck = (p: OrderPaymentDTO): boolean => p.status === 'pending' && p.method !== 'card'
const sumAmount = (parts: OrderPaymentDTO[]): number => round2(parts.reduce((s, p) => s + Number(p.amount || 0), 0))

/** Saldo de la comanda a partir de sus partes. `outstanding` = lo que falta cobrar; `pending` lo reservan las partes en curso. */
export function balanceOf(order: Pick<OrderDTO, 'subtotal' | 'tax'>, parts: OrderPaymentDTO[]): OrderBalance {
  const due = round2(Number(order.subtotal || 0) + Number(order.tax || 0))
  const paid = sumAmount(parts.filter(isPaidPart))
  const pending = sumAmount(parts.filter(isOpenPart))
  const tips = round2(parts.filter(isPaidPart).reduce((s, p) => s + Number(p.tip || 0), 0))
  return { due, paid, pending, outstanding: round2(Math.max(0, due - paid)), tips }
}

/** Líneas que se pueden asignar a una parte: vivas y con precio propio (los componentes de un combo van con su cabecera). */
export const isChargeableLine = (l: Pick<OrderItemDTO, 'status' | 'kind'>): boolean => isLineActive(l) && l.kind !== 'combo_component'

/**
 * Bruto de una línea (lo que paga quien se lleva ESA línea), SIN redondear: el redondeo lo absorbe la última
 * parte. #215: su neto ya descontado (`lineTotal − descuento de línea`), prorrateado por el descuento de
 * comanda (`factor`, el mismo con el que `computeOrderTotals` calcula el impuesto), más su impuesto congelado.
 */
const lineGross = (l: OrderItemDTO, factor: number): number => {
  const net = Number(l.lineTotal || 0) - Number(l.discountAmount || 0)
  return Math.max(0, net) * factor * (1 + Number(l.taxRate || 0) / 100)
}

/** Factor del descuento de comanda sobre el neto de cada línea (1 = sin descuento). Mismo cálculo que order-totals. */
function orderDiscountFactor(order: Pick<OrderDTO, 'tip' | 'discountType' | 'discountValue'>, active: OrderItemDTO[]): number {
  const t = computeOrderTotals(active, order)
  const base = round2(t.subtotal + t.discountAmount)
  return base > 0 ? (base - t.discountAmount) / base : 1
}

/**
 * Monto de una parte "por líneas". Cada línea pedida existe, es cobrable y no está en otra parte viva.
 * Si con esta selección quedan cubiertas TODAS las líneas cobrables, la parte vale el saldo exacto.
 */
export function amountForLines(order: Pick<OrderDTO, 'tip' | 'discountType' | 'discountValue'>, lines: OrderItemDTO[], parts: OrderPaymentDTO[], lineIds: string[], outstanding: number): number {
  const ids = [...new Set(lineIds.map(String))]
  if (ids.length === 0) throw new ValidationError('Elegí al menos una línea')
  const factor = orderDiscountFactor(order, lines.filter(isLineActive))
  const chargeable = lines.filter(isChargeableLine)
  const taken = new Set(parts.filter((p) => !isDeadPart(p)).flatMap((p) => p.lineIds ?? []))
  const chosen: OrderItemDTO[] = []
  for (const id of ids) {
    const line = chargeable.find((l) => l.id === id)
    if (!line) {
      // COR-A: una línea anulada/cancelada es un conflicto con el estado de la comanda (409), no un pedido mal armado.
      const gone = lines.find((l) => l.id === id)
      if (gone && !isLineActive(gone)) throw new ConflictError(`La línea "${gone.name}" fue anulada; no se puede cobrar`)
      throw new ValidationError(`La línea ${id} no existe o no se puede cobrar`)
    }
    if (taken.has(id)) throw new ConflictError(`La línea "${line.name}" ya está en otra parte`)
    chosen.push(line)
  }
  const coversAll = chargeable.every((l) => taken.has(l.id) || ids.includes(l.id))
  if (coversAll) return outstanding
  return round2(chosen.reduce((s, l) => s + lineGross(l, factor), 0))
}

/** Porción cobrada DIRECTO (no a habitación) con la forma de una comanda, para el asiento de contabilidad. */
export function directPortion(order: OrderDTO, parts: OrderPaymentDTO[]): Pick<OrderDTO, 'subtotal' | 'tax' | 'tip' | 'total'> {
  const direct = parts.filter((p) => isPaidPart(p) && isDirect(p))
  const gross = sumAmount(direct)
  const tip = round2(direct.reduce((s, p) => s + Number(p.tip || 0), 0))
  const due = Number(order.subtotal || 0) + Number(order.tax || 0)
  // Impuesto proporcional a la tasa efectiva de la comanda (tax/subtotal). Con todo directo, es el de la comanda.
  const tax = due > 0 ? round2(Number(order.tax || 0) * (gross / due)) : 0
  return { subtotal: round2(gross - tax), tax, tip, total: round2(gross + tip) }
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

async function partsOf(deps: SplitPaymentsDeps, orderId: string): Promise<OrderPaymentDTO[]> {
  const rows = await deps.orderPayments.findMany({ orderId })
  return rows.sort((a, b) => Number(a.seq) - Number(b.seq))
}

export async function listOrderPayments(deps: SplitPaymentsDeps, orderId: string, user: CurrentUser): Promise<OrderPaymentsList> {
  const order = await loadOrder(deps, orderId, user)
  const parts = await partsOf(deps, orderId)
  return { parts, balance: balanceOf(order, parts) }
}

/** `GET /orders/:id/split?parts=N` — cómo quedaría el saldo dividido en N partes iguales. No escribe nada. */
export async function splitPreview(deps: SplitPaymentsDeps, orderId: string, parts: number, user: CurrentUser): Promise<SplitPreview> {
  const order = await loadOrder(deps, orderId, user)
  const balance = balanceOf(order, await partsOf(deps, orderId))
  return { due: balance.due, outstanding: balance.outstanding, parts: splitEqual(balance.outstanding, parts) }
}

// ─── Reserva del saldo (UPDATE condicional sobre la comanda: usecases/order-cas.ts) ───────────
// El mismo CAS que usan el cobro ENTERO (settlement.ts) y cancelar (orders.ts): una parte y un cobro entero
// nunca entran los dos sobre el mismo saldo, cualquiera sea el orden en que lleguen.

/**
 * Reserva `amount` del saldo. Dos partes de 100 sobre 100: la segunda relee 100 reservados y rebota con 400.
 * COR-A: una parte POR LÍNEAS verifica sus líneas DENTRO del hold — con el saldo ya reservado se releen las
 * líneas y las partes: si alguna elegida se anuló o la tomó otra parte en el medio (o el monto ya no es el
 * mismo), se suelta la reserva y 409. Una anulación que no mueve el total (línea de $0) no cambia
 * `subtotal`/`tax` y el CAS solo no la ve: esta relectura es la barrera.
 */
async function reserve(deps: SplitPaymentsDeps, orderId: string, amount: number, lineIds?: string[] | null): Promise<void> {
  const { fresh } = await reserveBalance(deps, orderId, () => amount, (o) => {
    assertPartAllowed(o)
    const available = round2(dueOf(o) - o.amountPaid - o.amountReserved)
    if (amount > available + BALANCE_EPSILON) throw new ValidationError(`El pago ($${amount}) supera el saldo pendiente ($${Math.max(0, available)})`)
  })
  if (!lineIds?.length) return
  try {
    const [lines, parts] = await Promise.all([deps.lines.findMany({ orderId }), partsOf(deps, orderId)])
    const now = amountForLines(fresh, lines as OrderItemDTO[], parts, lineIds, round2(Math.max(0, dueOf(fresh) - fresh.amountPaid)))
    if (Math.abs(now - amount) > BALANCE_EPSILON) throw new ConflictError(`Las líneas elegidas cambiaron mientras se cobraban (ahora suman $${now}); revisá la comanda y reintentá`)
  } catch (e) {
    await unreserve(deps, orderId, amount)
    throw e
  }
}

const unreserve = (deps: SplitPaymentsDeps, orderId: string, amount: number): Promise<void> => releaseBalance({ ...deps, logger: deps.logger ?? silentLogger }, orderId, amount)

/** UPDATE condicional sobre UNA PARTE: `status` pasa de `from` a `changes.status` solo si sigue en `from`. 0 filas = otro la movió. */
async function casPart(deps: SplitPaymentsDeps, partId: string, from: OrderPaymentDTO['status'], changes: Record<string, unknown>): Promise<boolean> {
  const affected = await deps.cas.updateMany(ORDER_PAYMENTS_MODEL, { id: partId, status: from }, changes)
  return Number(affected) > 0
}

// ─── Cobrar una parte ─────────────────────────────────────────────────────────

const METHODS: OrderPaymentMethod[] = ['cash', 'card', 'transfer', 'room']

/** Una comanda admite partes mientras no esté liquidada/cancelada/esperando un cobro ENTERO con tarjeta. */
function assertPartAllowed(order: OrderDTO): void {
  if (order.status === 'open') throw new ConflictError('La comanda todavía no se envió a cocina')
  // Mismos guards que el cobro entero (cancelada / liquidada / Checkout ENTERO abierto), menos los de
  // "ya tiene partes" (cobradas o en curso): acá es justamente lo esperado.
  assertSettleable({ ...order, amountPaid: 0, amountReserved: 0 })
}

const sameRequest = (p: OrderPaymentDTO, d: Pick<OrderPaymentDTO, 'method' | 'amount' | 'tip' | 'lineIds'>): boolean =>
  p.method === d.method && round2(Number(p.amount)) === round2(Number(d.amount)) && round2(Number(p.tip || 0)) === round2(Number(d.tip || 0))
  && JSON.stringify(p.lineIds ?? null) === JSON.stringify(d.lineIds ?? null)

/**
 * Reserva el saldo y reclama el siguiente `seq` creando la fila `pending`. El UNIQUE (orderId, seq)
 * decide la carrera por el número; el perdedor reintenta con el siguiente. El `seq` es MONÓTONO por
 * comanda: las partes `expired`/`failed` se quedan con el suyo (su referencia `pos:<orderId>:<n>` ya
 * existe en payments, aunque sea de un cobro que no prosperó) y la siguiente parte toma n+1 — nunca
 * hereda un payment ajeno. Una parte cash/transfer/room que quedó `pending` sin cerrar (el puerto de
 * dinero respondió y la fila no se pudo marcar) se RETOMA si el pedido es el mismo — su saldo ya está
 * reservado: así el reintento pide la MISMA referencia y payments devuelve el cobro ya hecho en vez de
 * crear otro. Si el pedido es distinto, se frena: no se puede saber desde acá si esa plata entró.
 */
async function claimPart(deps: SplitPaymentsDeps, order: OrderDTO, data: NewOrderPayment): Promise<OrderPaymentDTO> {
  const stuck = (await partsOf(deps, order.id)).find(isStuck)
  if (stuck) {
    if (sameRequest(stuck, data)) return stuck
    throw new ConflictError(`La parte ${stuck.seq} (${stuck.method} $${stuck.amount}) quedó sin confirmar: reintentala con el mismo monto y método antes de agregar otra`)
  }
  await reserve(deps, order.id, data.amount, data.lineIds)
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const seq = (await partsOf(deps, order.id)).reduce((m, p) => Math.max(m, Number(p.seq) || 0), 0) + 1
      try {
        return await deps.orderPayments.create({ ...data, seq } as Omit<OrderPaymentDTO, 'id'>)
      } catch (e) {
        if (!isUniqueViolation(e)) throw e
      }
    }
    throw new ConflictError('No se pudo reservar el número de la parte; reintentá')
  } catch (e) {
    await unreserve(deps, order.id, data.amount)
    throw e
  }
}

/** Qué se hace con la parte cuando el puerto de dinero falla y no se pudo conciliar nada. */
type OnPortFailure = 'fail' | 'keep'

/**
 * Mueve la plata por el puerto. Si el puerto FALLA, la parte NUNCA se borra ni su `seq` se reutiliza
 * (charge-card.ts reclama la referencia en `payments` ANTES de hablar con Stripe: borrar la fila hacía
 * que la siguiente parte, con el mismo n, heredara ese payment `pending` de tarjeta y la comanda quedara
 * `paid` sin efectivo real). Antes de dar el fallo por "sin efecto" se pregunta a payments por la
 * referencia (`reconcile`): si el cobro existe, se concilia con él como si el puerto hubiera respondido.
 * Si no hay nada: `fail` → la parte queda `failed` con el error y libera su reserva (el cajero vuelve a
 * intentar con la siguiente parte); `keep` → queda `pending` y el reintento del MISMO pedido la retoma
 * (no hay forma de verificar si la plata entró: se prefiere frenar a duplicar).
 */
async function moveMoney<T>(deps: SplitPaymentsDeps, part: OrderPaymentDTO, fn: () => Promise<T>, opts: { reconcile?: () => Promise<T | null>; onFailure: OnPortFailure }): Promise<T> {
  const log = deps.logger ?? silentLogger
  try {
    return await fn()
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (opts.reconcile) {
      let found: T | null = null
      try { found = await opts.reconcile() } catch (re) { log.error('restaurant.split: no se pudo consultar payments tras el fallo del puerto', { partId: part.id, error: re instanceof Error ? re.message : String(re) }) }
      if (found) {
        log.warn('restaurant.split: el puerto de dinero falló pero el cobro de la parte YA existe en payments; se concilia con él', { orderId: part.orderId, partId: part.id, seq: part.seq, error })
        return found
      }
    }
    if (opts.onFailure === 'keep') {
      log.error('restaurant.split: el puerto de dinero falló y no se puede verificar si la plata entró: la parte queda pending y se retoma con el mismo pedido', { orderId: part.orderId, partId: part.id, seq: part.seq, error })
      throw e
    }
    let failed = false
    try {
      failed = !!(await deps.orderPayments.update(part.id, { status: 'failed', failedAt: new Date().toISOString(), failReason: error.slice(0, 500) }))
    } catch (ue) {
      log.error('restaurant.split: el puerto falló y la parte no se pudo marcar failed: queda pending', { partId: part.id, error: ue instanceof Error ? ue.message : String(ue) })
    }
    if (failed) await unreserve(deps, part.orderId, Number(part.amount))
    throw e
  }
}

/** Consulta payments por la referencia de la parte; `completed` = el dinero entró aunque el puerto haya fallado. */
function reconcileByReference(deps: SplitPaymentsDeps, hotelId: string, reference: string): (() => Promise<{ paymentId: string } | null>) | undefined {
  const find = deps.ports.findPaymentByReference
  if (!find) return undefined
  return async () => {
    const found = await find({ hotelId, reference })
    return found && found.status === 'completed' ? { paymentId: found.paymentId } : null
  }
}

/**
 * Una parte terminó de cobrarse: su reserva pasa a cobrado y, si el saldo llegó a 0, la comanda se
 * cierra. TODO en un UPDATE condicional: el que gana el CAS que fija `status='paid'` es el ÚNICO que
 * libera la mesa y emite el socket (inventario descuenta una vez). Si otra parte cerró la comanda en
 * el medio (o ya estaba cerrada por otro camino), acá solo se libera la reserva.
 *
 * El cierre se decide sobre `amountPaid` de la FILA (+ esta parte), no sobre la suma de las partes: es la
 * columna que el CAS protege. Una devolución en curso (COR-C) ya le restó su monto con ese mismo CAS, así
 * que una parte `refunding` nunca "completa" la cuenta desde acá. `reserved`: la parte tenía saldo
 * reservado (lo normal); `false` cuando se vuelve a asentar una parte cuya devolución falló (su monto está
 * en la reserva de la devolución, que se libera en el mismo UPDATE).
 */
async function completePart(deps: SplitPaymentsDeps, part: OrderPaymentDTO, user: CurrentUser): Promise<{ order: OrderDTO; balance: OrderBalance }> {
  const amount = round2(Number(part.amount))
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const fresh = await freshForCas(deps, part.orderId)
    const parts = await partsOf(deps, part.orderId)
    const paid = parts.filter(isPaidPart)
    const alreadyClosed = isTerminalOrder(fresh)
    const due = dueOf(fresh)
    const newPaid = round2(fresh.amountPaid + amount)
    const settledNow = !alreadyClosed && amount > 0 && newPaid >= due - BALANCE_EPSILON
    const tips = round2(paid.reduce((s, p) => s + Number(p.tip || 0), 0))
    const patch: Record<string, unknown> = {
      amountPaid: newPaid,
      amountReserved: round2(Math.max(0, fresh.amountReserved - amount)),
      ...(alreadyClosed ? {} : { tip: tips, total: round2(due + tips) }),
    }
    if (settledNow) {
      const hasDirect = paid.some(isDirect), hasRoom = paid.some((p) => !isDirect(p))
      const settlement: Settlement = hasDirect && hasRoom ? 'split' : hasRoom ? 'folio' : 'payment'
      const folioId = paid.find((p) => !isDirect(p))?.folioId
      // Todo a habitaciones = lo mismo que chargeToRoom (`charged`/`folio`); con algo directo, `paid`.
      // #213: sello de cierre (closedAt + businessDate en la zona del hotel), como el cobro entero.
      Object.assign(patch, { status: hasDirect ? 'paid' : 'charged', settlement, ...(await closingStamp(deps.hotels, fresh.hotelId)), ...(folioId ? { folioId } : {}) })
    }
    if (!(await casOrder(deps, fresh, patch))) continue
    const updated = { ...fresh, ...patch } as OrderDTO
    const balance = balanceOf(updated, parts)
    if (!settledNow) return { order: updated, balance }
    await freeTable(deps, fresh)
    // UN solo socket: inventario descuenta una vez. Con partes directas viaja la porción directa (contabilidad);
    // si todo fue a habitaciones, `onOrderCharged` (folios-accounting ya devengó cada cargo).
    if (paid.some(isDirect)) await deps.sockets.onOrderPaid?.({ ...updated, ...directPortion(updated, parts) })
    else await deps.sockets.onOrderCharged?.(updated)
    await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
      hotelId: fresh.hotelId, userId: user.id, action: 'restaurant.order.split_settled', entity: 'restaurant_order', entityId: fresh.id,
      detail: JSON.stringify({ orderId: fresh.id, orderNumber: fresh.number, parts: paid.map((p) => ({ seq: p.seq, method: p.method, amount: p.amount, tip: p.tip })), settlement: patch.settlement }),
    })
    return { order: updated, balance }
  }
  throw new ConflictError('No se pudo asentar la parte en la comanda (otra parte en curso); recargá y revisá los pagos')
}

export async function addOrderPayment(deps: SplitPaymentsDeps, orderId: string, dto: AddOrderPaymentInput, user: CurrentUser): Promise<AddOrderPaymentResult> {
  const order0 = await loadOrder(deps, orderId, user)
  if (!METHODS.includes(dto.method)) throw new ValidationError('Método de cobro inválido')
  const tip = round2(Number(dto.tip ?? 0))
  if (!Number.isFinite(tip) || tip < 0) throw new ValidationError('La propina debe ser ≥ 0')
  // Comanda CANCELADA con una parte cash/transfer/room a medias (el dinero entró, la fila no se pudo
  // marcar): el reintento del MISMO pedido no cobra — resuelve la parte y, como la venta está anulada,
  // la devuelve (refundAfterCancel). Cualquier otro pedido sobre una cancelada da 409 (assertPartAllowed).
  if (order0.status === 'cancelled') {
    const stuck = (await partsOf(deps, orderId)).find(isStuck)
    if (stuck && stuck.method === dto.method && sameRequest(stuck, { method: dto.method, amount: dto.amount === undefined ? stuck.amount : round2(Number(dto.amount)), tip, lineIds: dto.lineIds?.length ? [...new Set(dto.lineIds.map(String))] : null })) {
      return resumeStuckOnCancelled(deps, order0, stuck, user)
    }
  }
  assertPartAllowed(order0)
  if (dto.method === 'room' && tip > 0) throw new ValidationError('El cargo a habitación no transfiere la propina. Cobrala directo o quitala.')

  // COR-A: los totales se LEEN (los escribe solo una edición de líneas bajo su lock); el CAS de la reserva
  // los condiciona, así que un cambio de líneas entre esta lectura y la reserva deja el UPDATE en 0 filas.
  const order = order0
  const allParts = await partsOf(deps, orderId)
  const lines = dto.lineIds?.length ? await deps.lines.findMany({ orderId }) : []
  const lineIds = dto.lineIds?.length ? [...new Set(dto.lineIds.map(String))] : undefined
  // Reintento de una parte a medias (claimPart la retoma): su saldo ya está reservado y sus líneas ya
  // son suyas — para calcular el monto y el disponible no cuenta como "otra parte", o el reintento del
  // saldo completo rebotaría con "supera el saldo ($0)".
  const stuck = allParts.find(isStuck)
  const retrying = !!stuck && stuck.method === dto.method && round2(Number(stuck.tip || 0)) === tip
    && (lineIds ? JSON.stringify(stuck.lineIds ?? null) === JSON.stringify(lineIds) : round2(Number(stuck.amount)) === round2(Number(dto.amount)))
  const parts = retrying ? allParts.filter((p) => p.id !== stuck!.id) : allParts
  const balance = balanceOf(order, parts)
  const amount = lineIds ? amountForLines(order, lines, parts, lineIds, balance.outstanding) : round2(Number(dto.amount))
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('El monto debe ser mayor a 0')
  if (lineIds && dto.amount !== undefined && Math.abs(round2(Number(dto.amount)) - amount) > BALANCE_EPSILON) {
    throw new ValidationError(`Las líneas elegidas suman $${amount}, no $${round2(Number(dto.amount))}`)
  }
  // El chequeo que vale es el de `reserve` (atómico); este solo evita tocar reserva/folio por un pedido que ya se ve inválido.
  const available = round2(balance.outstanding - balance.pending)
  if (amount > available + BALANCE_EPSILON) throw new ValidationError(`El pago ($${amount}) supera el saldo pendiente ($${available})`)

  const hotel = await deps.hotels.findOne({ id: order.hotelId })
  const currency: string | undefined = hotel?.currency || undefined
  const label = await orderLabel(deps, order)
  const reference = (seq: number) => `pos:${orderId}:${seq}`
  const base: NewOrderPayment = { hotelId: order.hotelId, orderId, method: dto.method, amount, tip, status: 'pending', lineIds: lineIds ?? null, createdBy: user.id }

  // ── Cargo a habitación: neto proporcional (el folio aplica su impuesto), reserva validada como en chargeToRoom.
  if (dto.method === 'room') {
    const reservationId = dto.reservationId || order.reservationId
    if (!reservationId) throw new ValidationError('Elegí la reserva a la que se carga esta parte')
    const chargeToFolio = deps.ports.chargeToFolio
    if (!chargeToFolio) throw new ValidationError('Cargo a habitación no disponible (folios no conectado)')
    const reservation = await assertReservationOfHotel(deps.reservations, reservationId, order.hotelId, user)
    assertReservationChargeable(reservation, hotelToday(hotel))
    const due = Number(order.subtotal || 0) + Number(order.tax || 0)
    const net = round2(amount * (Number(order.subtotal || 0) / due))
    if (net <= 0) throw new ValidationError('La comanda no tiene consumos para cargar')
    const part = await claimPart(deps, order, { ...base, reservationId })
    // Sin forma de preguntarle al folio si el cargo entró: si el puerto falla, la parte queda `pending` y
    // el reintento del mismo pedido pide la MISMA referencia (folios la reclama idempotente).
    const { folioId } = await moveMoney(deps, part, () => chargeToFolio({
      hotelId: order.hotelId, reservationId, guestId: reservation.guestId ?? undefined, roomId: reservation.roomId ?? undefined,
      description: `Restaurante · comanda ${order.number ?? orderId} (parte ${part.seq})`, amount: net, quantity: 1,
      orderId, reference: reference(part.seq),
    }, user), { onFailure: 'keep' })
    return finishPart(deps, part, { folioId }, user)
  }

  // ── Tarjeta: Checkout de Stripe por el monto de la parte (+ propina). Queda `pending` hasta el webhook.
  if (dto.method === 'card') {
    const chargeCardPayment = deps.ports.chargeCardPayment
    if (!chargeCardPayment) throw new ValidationError('Cobro con tarjeta no disponible (payments no conectado)')
    if (!dto.successUrl || !dto.cancelUrl) throw new ValidationError('successUrl y cancelUrl son obligatorios para cobrar con tarjeta (retorno del Checkout de Stripe)')
    const part = await claimPart(deps, order, base)
    // Si el puerto falla nadie recibió una URL de Checkout: la parte queda `failed` (su `seq` se quema:
    // charge-card.ts ya pudo haber creado el payment `pending` con esta referencia) y libera el saldo.
    const res = await moveMoney(deps, part, () => chargeCardPayment({
      orderId, hotelId: order.hotelId, amount: round2(amount + tip), currency, description: `${label} · parte ${part.seq}`,
      successUrl: dto.successUrl!, cancelUrl: dto.cancelUrl!,
      reference: reference(part.seq), metadata: { source: 'restaurant', orderId, orderPaymentId: part.id },
    }, user), { onFailure: 'fail' })
    // La sesión de Stripe YA existe: pase lo que pase con esta fila, la parte NO se suelta (el webhook la
    // confirma o la vence por `metadata.orderPaymentId`). Si no se pudo anotar el paymentId, se loguea y
    // el cobro sigue: `settleOrderPayment` lo anota al confirmar.
    let pending = part
    try {
      pending = (await deps.orderPayments.update(part.id, { paymentId: res.paymentId })) ?? part
    } catch (e) {
      ;(deps.logger ?? silentLogger).error('restaurant.split: Checkout abierto pero no se pudo anotar el paymentId en la parte', { orderId, partId: part.id, paymentId: res.paymentId, error: e instanceof Error ? e.message : String(e) })
    }
    // Nada cambia en la comanda hasta que Stripe confirme; el saldo ya descuenta esta parte como `pending`.
    return { part: pending, order, balance: balanceOf(order, await partsOf(deps, orderId)), checkoutUrl: res.checkoutUrl }
  }

  // ── Efectivo / transferencia: payment `completed` por amount + tip, referencia por parte.
  const recordPayment = deps.ports.recordPayment
  if (!recordPayment) throw new ValidationError('Cobro directo no disponible (payments no conectado)')
  const part = await claimPart(deps, order, base)
  // Si el puerto falla: con `findPaymentByReference` cableado se pregunta si el cobro igual entró (se
  // concilia) y si no, la parte queda `failed`; sin él no hay forma de saberlo → queda `pending` y se retoma.
  const reconcile = reconcileByReference(deps, order.hotelId, reference(part.seq))
  const { paymentId } = await moveMoney(deps, part, () => recordPayment({
    hotelId: order.hotelId, method: dto.method, amount: round2(amount + tip), currency, description: `${label} · parte ${part.seq}`,
    orderId, reference: reference(part.seq), metadata: { source: 'restaurant', orderId, orderPaymentId: part.id },
  }, user), { reconcile, onFailure: reconcile ? 'fail' : 'keep' })
  return finishPart(deps, part, { paymentId }, user)
}

/** Retoma una parte a medias de una comanda CANCELADA: pide el cobro con la MISMA referencia (payments/folios lo devuelven, no lo duplican) y lo deja en manos de finishPart, que lo devuelve. */
async function resumeStuckOnCancelled(deps: SplitPaymentsDeps, order: OrderDTO, stuck: OrderPaymentDTO, user: CurrentUser): Promise<AddOrderPaymentResult> {
  const reference = `pos:${order.id}:${stuck.seq}`
  if (stuck.method === 'room') {
    if (!deps.ports.chargeToFolio || !stuck.reservationId) throw new ValidationError('Cargo a habitación no disponible (folios no conectado)')
    const reservation = await assertReservationOfHotel(deps.reservations, stuck.reservationId, order.hotelId, user)
    const due = Number(order.subtotal || 0) + Number(order.tax || 0)
    const net = due > 0 ? round2(Number(stuck.amount) * (Number(order.subtotal || 0) / due)) : 0
    const { folioId } = await deps.ports.chargeToFolio({
      hotelId: order.hotelId, reservationId: stuck.reservationId, guestId: reservation.guestId ?? undefined, roomId: reservation.roomId ?? undefined,
      description: `Restaurante · comanda ${order.number ?? order.id} (parte ${stuck.seq})`, amount: net, quantity: 1, orderId: order.id, reference,
    }, user)
    return finishPart(deps, stuck, { folioId }, user)
  }
  if (!deps.ports.recordPayment) throw new ValidationError('Cobro directo no disponible (payments no conectado)')
  const hotel = await deps.hotels.findOne({ id: order.hotelId })
  const { paymentId } = await deps.ports.recordPayment({
    hotelId: order.hotelId, method: stuck.method, amount: round2(Number(stuck.amount) + Number(stuck.tip || 0)), currency: hotel?.currency || undefined,
    description: `${await orderLabel(deps, order)} · parte ${stuck.seq}`, orderId: order.id, reference, metadata: { source: 'restaurant', orderId: order.id, orderPaymentId: stuck.id },
  }, user)
  return finishPart(deps, stuck, { paymentId }, user)
}

/**
 * La plata ya entró: marca la parte `completed` y la asienta en la comanda (cierre incluido si era la
 * última). Si en el medio la comanda quedó `cancelled` (con el CAS de cancelar no debería: cancelar exige
 * reserva 0; queda para filas tocadas a mano o un reintento de una parte que quedó a medias), el dinero
 * es de una venta anulada y se devuelve solo — efectivo/transferencia incluidos, no solo tarjeta.
 */
async function finishPart(deps: SplitPaymentsDeps, part: OrderPaymentDTO, link: Pick<OrderPaymentDTO, 'paymentId' | 'folioId'>, user: CurrentUser): Promise<AddOrderPaymentResult> {
  const done = (await deps.orderPayments.update(part.id, { ...link, status: 'completed', completedAt: new Date().toISOString() })) ?? { ...part, ...link, status: 'completed' as const }
  const order = await deps.orders.findById(part.orderId)
  if (order?.status === 'cancelled') {
    await unreserve(deps, order.id, Number(part.amount))
    const refunded = await refundAfterCancel(deps, order, done, user)
    return { part: refunded, order, balance: balanceOf(order, await partsOf(deps, order.id)) }
  }
  const closed = await completePart(deps, done, user)
  return { part: done, ...closed }
}

// ─── Webhook de Stripe (vía conector restaurante-payments) ────────────────────

/**
 * El Checkout de una parte se completó: la parte pasa a `completed` y, si era la última, la comanda se
 * cierra. Idempotente. Con los guards de `hasOpenPart` la comanda no puede cancelarse ni cobrarse entera
 * mientras la parte está `pending`; si igual llega cerrada (fila anterior a esos guards, cambio a mano):
 *   - `cancelled`: el cliente pagó una venta anulada → se DEVUELVE automáticamente por el puerto de
 *     payments (parte `refunded`) y se audita `restaurant.order.part_refunded_after_cancel`. Si no hay
 *     puerto o el refund falla, la parte queda `completed` sin comanda que la respalde: se loguea con
 *     error y se audita `restaurant.order.orphan_payment` para que alguien lo devuelva a mano.
 *   - liquidada por otro camino (`paid`/`charged`/`refunded`/`partially_refunded`): la parte se anota
 *     `completed` y se libera su reserva, pero NO se vuelve a liberar la mesa ni a emitir `onOrderPaid`.
 */
export async function settleOrderPayment(deps: SplitPaymentsDeps, partId: string, paymentId: string, user: CurrentUser): Promise<OrderPaymentDTO> {
  const part = await deps.orderPayments.findById(partId)
  if (!part) throw new NotFoundError('Parte del cobro no encontrada')
  if (part.status !== 'pending') return part
  const order = await loadOrder(deps, part.orderId, user)
  // pending → completed con UPDATE condicional: dos entregas del mismo webhook (o confirmar y vencer a la
  // vez) no asientan la parte dos veces; el que pierde el CAS devuelve la fila como quedó.
  const link = { status: 'completed', paymentId, completedAt: new Date().toISOString() }
  if (!(await casPart(deps, partId, 'pending', link))) return (await deps.orderPayments.findById(partId)) ?? part
  const done = { ...part, ...link, status: 'completed' as const }
  if (order.status === 'cancelled') {
    await unreserve(deps, order.id, Number(part.amount))
    return refundAfterCancel(deps, order, done, user)
  }
  await completePart(deps, done, user)
  return done
}

async function refundAfterCancel(deps: SplitPaymentsDeps, order: OrderDTO, part: OrderPaymentDTO, user: CurrentUser): Promise<OrderPaymentDTO> {
  const log = deps.logger ?? silentLogger
  const detail = { orderId: order.id, orderNumber: order.number, partId: part.id, seq: part.seq, paymentId: part.paymentId, amount: round2(Number(part.amount) + Number(part.tip || 0)) }
  try {
    if (!deps.ports.refundPayment || !part.paymentId) throw new ValidationError('Reembolso no disponible (payments no conectado)')
    await deps.ports.refundPayment({ paymentId: part.paymentId }, user)
  } catch (e) {
    log.error('restaurant.split: Stripe confirmó una parte de una comanda CANCELADA y no se pudo devolver — cobro sin venta, devolver a mano', { ...detail, error: e instanceof Error ? e.message : String(e) })
    await auditSafely(deps.audit ?? null, log, { hotelId: order.hotelId, userId: user.id, action: 'restaurant.order.orphan_payment', entity: 'restaurant_order', entityId: order.id, detail: JSON.stringify(detail) })
    return part
  }
  const refunded = (await deps.orderPayments.update(part.id, { status: 'refunded', refundedAt: new Date().toISOString() })) ?? { ...part, status: 'refunded' as const }
  log.warn('restaurant.split: Stripe confirmó una parte de una comanda CANCELADA; se devolvió automáticamente', detail)
  await auditSafely(deps.audit ?? null, log, { hotelId: order.hotelId, userId: user.id, action: 'restaurant.order.part_refunded_after_cancel', entity: 'restaurant_order', entityId: order.id, detail: JSON.stringify(detail) })
  return refunded
}

/** El Checkout expiró sin pagar: la parte queda `expired` y libera su reserva (su `seq` no se reutiliza: la referencia ya existe en payments). Idempotente. */
export async function expireOrderPayment(deps: SplitPaymentsDeps, partId: string, user: CurrentUser): Promise<OrderPaymentDTO> {
  const part = await deps.orderPayments.findById(partId)
  if (!part) throw new NotFoundError('Parte del cobro no encontrada')
  if (part.status !== 'pending') return part
  await loadOrder(deps, part.orderId, user)
  if (!(await casPart(deps, partId, 'pending', { status: 'expired' }))) return (await deps.orderPayments.findById(partId)) ?? part
  await unreserve(deps, part.orderId, Number(part.amount))
  return { ...part, status: 'expired' as const }
}

// ─── Reembolso de una parte ───────────────────────────────────────────────────

/**
 * Devuelve UNA parte (su payment completo: monto + propina). El cargo a habitación no se devuelve desde
 * acá (se ajusta en el folio), igual que en refundOrder. Motivo obligatorio (como refundOrder/voidLine):
 * efectivo y transferencia también se devuelven de verdad (COR-5) y sin motivo son un faltante de caja.
 * Dos casos:
 *   - Comanda LIQUIDADA (`paid`/`partially_refunded`): las demás partes siguen cobradas y la parte devuelta
 *     sigue pesando en el saldo (la devolución no reabre una cuenta cerrada). La comanda queda
 *     `partially_refunded`; cuando no queda ninguna parte cobrada, `refunded` — y recién ahí se emite
 *     `onOrderRefunded` (el inventario se repone solo cuando se devolvió la venta entera). COR-E: la
 *     transición se decide sobre la fila fresca con UPDATE condicional (`casOrder` + status): dos
 *     devoluciones a la vez emiten el socket UNA vez, y ninguna deja `partially_refunded` con todo devuelto.
 *   - Comanda ABIERTA (COR-C: una parte cobrada por error): la parte queda `reversed`, el saldo se reabre
 *     (`amountPaid` baja con el mismo CAS que lo subió), sus líneas quedan libres y la comanda sigue viva
 *     — se puede volver a cobrar, cobrar entera o cancelar. Sin socket: la venta nunca se cerró.
 *     La devolución compite con la parte que cierra la cuenta por el MISMO `amountPaid`: ANTES de tocar el
 *     puerto, `holdReversal` mueve el monto de `amountPaid` a `amountReserved` con el CAS (si la comanda
 *     ya se cerró en el medio → 409 y la parte sigue cobrada: se devuelve desde la comanda liquidada).
 *     Con eso, el cierre concurrente relee `amountPaid` sin esta parte y no cierra, y nadie reserva ese
 *     saldo mientras el puerto responde. Sin esto la comanda quedaba `paid` con `amountPaid` 40 sobre 100.
 */
export async function refundOrderPayment(deps: SplitPaymentsDeps, orderId: string, partId: string, dto: { reason?: string }, user: CurrentUser): Promise<OrderPaymentDTO> {
  const reasonText = String(dto?.reason ?? '').trim()
  if (!reasonText) throw new ValidationError('Indicá el motivo del reembolso')
  const order = await loadOrder(deps, orderId, user)
  const part = await deps.orderPayments.findById(partId)
  if (!part || part.orderId !== orderId) throw new NotFoundError('Parte del cobro no encontrada')
  if (part.status === 'refunded') return part
  if (part.status === 'reversed') throw new ConflictError('Esta parte ya fue devuelta y el saldo se reabrió')
  if (part.status === 'refunding') throw new ConflictError('La devolución de esta parte ya está en curso')
  if (part.status !== 'completed') throw new ConflictError('Solo se puede reembolsar una parte cobrada')
  if (part.method === 'room') throw new ConflictError('El cargo a habitación se devuelve desde el folio, no desde acá')
  if (!part.paymentId) throw new ValidationError('La parte no tiene payment asociado')
  if (!deps.ports.refundPayment) throw new ValidationError('Reembolso no disponible (payments no conectado)')
  const settled = order.status === 'paid' || order.status === 'partially_refunded'
  if (!settled && isTerminalOrder(order)) throw new ConflictError(`La comanda está ${order.status}; esta parte no se devuelve desde acá`)
  if (!settled && order.status === 'processing_payment') throw new ConflictError('La comanda está esperando la confirmación de un cobro con tarjeta')

  // completed → refunding con UPDATE condicional ANTES de tocar el puerto: dos clicks de "devolver" a la
  // vez piden UN solo reembolso a payments. El que pierde el CAS ve la parte `refunding`/`refunded`.
  if (!(await casPart(deps, partId, 'completed', { status: 'refunding' }))) {
    const now = (await deps.orderPayments.findById(partId)) ?? part
    if (now.status === 'refunded') return now
    throw new ConflictError('La devolución de esta parte ya está en curso')
  }
  // Comanda abierta: la parte deja de contar como cobrada YA (CAS), antes de que salga la plata.
  let reopened = false
  if (!settled) {
    try {
      await holdReversal(deps, orderId, part)
    } catch (e) {
      await casPart(deps, partId, 'refunding', { status: 'completed' })
      throw e
    }
    reopened = true
  }
  try {
    // El puerto devuelve por método: tarjeta vía Stripe, efectivo/transferencia con un asiento `refund`
    // en payments (connectors/restaurante-payments.ts). El cargo a habitación no pasa por acá.
    await deps.ports.refundPayment({ paymentId: part.paymentId }, user)
  } catch (e) {
    // No salió plata: la parte sigue cobrada. Con la comanda abierta, su monto vuelve de la reserva a
    // cobrado por el MISMO camino que la asentó (cierra la cuenta si con eso el saldo llega a 0).
    await casPart(deps, partId, 'refunding', { status: 'completed' })
    if (reopened) await completePart(deps, { ...part, status: 'completed' }, user)
    throw e
  }
  const finalStatus = reopened ? 'reversed' : 'refunded'
  const refunded = (await deps.orderPayments.update(partId, { status: finalStatus, refundedAt: new Date().toISOString(), refundReason: reasonText })) ?? { ...part, status: finalStatus as OrderPaymentDTO['status'] }
  const updated = reopened ? await releaseReversal(deps, orderId, part) : await settleRefundedOrder(deps, orderId)
  await auditSafely(deps.audit ?? null, deps.logger ?? silentLogger, {
    hotelId: order.hotelId, userId: user.id, action: 'restaurant.order.part_refunded', entity: 'restaurant_order', entityId: orderId,
    detail: JSON.stringify({ orderId, orderNumber: order.number, partId, seq: part.seq, method: part.method, paymentId: part.paymentId, amount: round2(Number(part.amount) + Number(part.tip || 0)), reason: reasonText, orderStatus: updated.status, reopened }),
  })
  return refunded
}

/**
 * COR-C — Mueve el monto de la parte de `amountPaid` a `amountReserved` (mismo CAS del dinero, con
 * `status`): desde acá la parte no cuenta como cobrada para el cierre y su saldo no se puede volver a
 * reservar hasta que el puerto responda. Si la comanda se cerró en el medio (otra parte llegó al saldo
 * antes que este CAS), 409: la parte sigue cobrada y se devuelve desde la comanda liquidada.
 */
async function holdReversal(deps: SplitPaymentsDeps, orderId: string, part: OrderPaymentDTO): Promise<void> {
  const amount = round2(Number(part.amount))
  await casUpdate(deps, orderId, (fresh) => {
    if (isTerminalOrder(fresh)) throw new ConflictError(`La comanda quedó ${fresh.status} mientras se devolvía la parte; devolvela desde la comanda liquidada`)
    if (fresh.status === 'processing_payment') throw new ConflictError('La comanda está esperando la confirmación de un cobro con tarjeta')
  }, (fresh) => ({ amountPaid: round2(Math.max(0, fresh.amountPaid - amount)), amountReserved: round2(fresh.amountReserved + amount) }), true)
}

/** COR-C — La plata ya volvió: se libera la reserva de la devolución y la propina/total se recalculan de las partes vivas, con el CAS del saldo. */
async function releaseReversal(deps: SplitPaymentsDeps, orderId: string, part: OrderPaymentDTO): Promise<OrderDTO> {
  const amount = round2(Number(part.amount))
  const parts = await partsOf(deps, orderId)
  const tips = round2(parts.filter(isPaidPart).reduce((s, p) => s + Number(p.tip || 0), 0))
  return casUpdate(deps, orderId, () => {}, (fresh) => ({ amountReserved: round2(Math.max(0, fresh.amountReserved - amount)), tip: tips, total: round2(dueOf(fresh) + tips) }))
}

/** COR-E: `partially_refunded` / `refunded` sobre la fila fresca, con CAS; `onOrderRefunded` lo emite SOLO quien gana la transición a `refunded`. #213: `refundedAt` al quedar toda devuelta (closedAt/businessDate no se tocan). */
async function settleRefundedOrder(deps: SplitPaymentsDeps, orderId: string): Promise<OrderDTO> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const fresh = await freshForCas(deps, orderId)
    const parts = await partsOf(deps, orderId)
    const allBack = parts.filter(isPaidPart).every((p) => p.status === 'refunded')
    const target: OrderDTO['status'] = allBack ? 'refunded' : 'partially_refunded'
    if (fresh.status === target || fresh.status === 'refunded') return fresh
    const patch = allBack ? { status: target, refundedAt: new Date().toISOString() } : { status: target }
    if (!(await casOrder(deps, fresh, patch, true))) continue
    const updated: OrderDTO = { ...fresh, ...patch }
    if (allBack) await deps.sockets.onOrderRefunded?.(updated)
    return updated
  }
  throw new ConflictError('No se pudo actualizar el estado de la comanda tras la devolución; recargá y revisá los pagos')
}
