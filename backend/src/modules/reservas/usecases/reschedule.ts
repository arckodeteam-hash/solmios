// reservas/usecases/reschedule.ts
// Mover (cambiar habitación/fechas) o extender (cambiar salida) una reserva desde el planning.
// - quoteReschedule: dry-run, NO escribe. Devuelve disponibilidad + diferencia de precio para el modal.
// - commitReschedule: aplica el cambio (reusa updateReservation → revalida solape) y cobra la diferencia.
// El cobro NO se orquesta acá: se delega a un puerto inyectado por el connector (folio/efectivo/tarjeta).
//
// ─── Dos precios, el usuario elige (fix "siempre se queda con el mismo precio") ───────────────
// El quote devuelve SIEMPRE los dos totales; `input.pricingMode` decide cuál se aplica al commit:
//   keep    (default, comportamiento histórico) → `keepTotal`     = previousTotal + noches agregadas × basePrice
//   reprice                                     → `repricedTotal` = suma noche a noche a tarifa vigente del destino
// El bug: con `keep`, mover una reserva a otra habitación SIN cambiar las noches da diferencia 0
// aunque el cuarto destino valga el doble, y nunca pasa por temporadas. `reprice` lo arregla
// reusando la MISMA cadena de precio que el motor público (`shared/utils/rate-resolution.ts`).
// `repricedDifference` puede ser NEGATIVO = saldo a favor del huésped: se informa (`creditAmount`
// en el commit), NO se devuelve plata automáticamente.

import { NotFoundError, AuthError, ConflictError } from 'arckode-framework'
import { assertRoomAvailable } from './availability'
import { updateReservation } from './crud'
import { repriceStay, guestsOfReservation, type RepriceRepos } from './reprice'
import { syncReservationPending, type AddonSource } from '../../../shared/usecases/sync-reservation-pending'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import { round2 } from '../../../shared/utils/money'

const MS_PER_DAY = 86_400_000
const nightsBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY))

export type RescheduleChargeMethod = 'folio' | 'cash' | 'card'

export interface RescheduleChargeParams {
  reservationId: string
  hotelId: string
  guestId: string | null
  roomId: string | null
  currency: string
  amount: number
  method: RescheduleChargeMethod
  reason?: string
  successUrl?: string
  cancelUrl?: string
}

export interface RescheduleChargeResult {
  method: RescheduleChargeMethod
  applied: boolean
  target: string
  folioId?: string
  chargeId?: string
  paymentId?: string
  checkoutUrl?: string
  message?: string
}

export type RescheduleChargePort = (params: RescheduleChargeParams, user: any) => Promise<RescheduleChargeResult>

/**
 * Qué precio queda tras mover la reserva. El quote SIEMPRE devuelve los dos totales para que el
 * frontend haga elegir; `pricingMode` es lo que se APLICA en el commit.
 *  - `keep`    (default, comportamiento histórico): se respeta el precio pactado y solo se cobran
 *              las NOCHES AGREGADAS a la tarifa base del destino. Mover sin cambiar noches = $0.
 *  - `reprice`: se reprecia TODA la estadía nueva noche a noche con la tarifa vigente del cuarto
 *              destino y esas fechas (temporadas incluidas). Puede DAR MENOS que el total previo.
 */
export type ReschedulePricingMode = 'keep' | 'reprice'

export interface RescheduleInput {
  roomId?: string
  checkIn?: string
  checkOut?: string
  pricingMode?: ReschedulePricingMode
  charge?: { method: RescheduleChargeMethod; amount?: number; reason?: string }
  successUrl?: string
  cancelUrl?: string
}

export interface RescheduleQuote {
  reservationId: string
  roomId: string
  checkIn: string
  checkOut: string
  basePrice: number
  oldNights: number
  newNights: number
  previousTotal: number
  /** Total del modo APLICADO (`pricingMode`). Con el default `keep` vale lo mismo que siempre. */
  quotedNewPrice: number
  /** `quotedNewPrice - previousTotal`. En modo `reprice` puede ser NEGATIVO (saldo a favor). */
  difference: number
  /** Modo aplicado — eco del input, para que el frontend sepa qué está mirando. */
  pricingMode: ReschedulePricingMode
  /** Opción 1: mantener el precio pactado (solo cobra noches agregadas a tarifa base). */
  keepTotal: number
  keepDifference: number
  /** Opción 2: repreciar toda la estadía nueva a tarifa vigente (temporadas incluidas). */
  repricedTotal: number
  /** `repricedTotal - previousTotal`. NEGATIVO = saldo a favor del huésped (no se devuelve solo). */
  repricedDifference: number
  /** `false` = el reprice degradó a `rooms.basePrice` (sin repos de temporadas/tarifas). */
  repricedFromRates: boolean
  roomChanged: boolean
  datesChanged: boolean
  currency: string
}

export interface RescheduleDeps extends RepriceRepos {
  repo: any
  roomRepo: any
  /**
   * Extras de la reserva. OBLIGATORIO (STR-2): el commit escribe un `totalAmount` nuevo, y
   * `reservations.pendingAmount` —la columna PERSISTIDA que lee el listado y el planning— quedaba
   * con el saldo del precio viejo tras un reagendado con reprice. Si fuera opcional, un caller que
   * lo omita reintroduce la divergencia en silencio.
   */
  addonsOf: AddonSource
  /** Lo cobrado real (`payments`) para el saldo persistido — ver `crud.updateReservationWithBalance`. */
  paidOf: PaidSource
  /**
   * SEC3-2 — recorte de links de pago vivos cuando el reagendado BAJA el total cobrable. El commit
   * escribe `totalAmount:newTotal` vía `updateReservation`, así que dispara `afterCeilingDrop`
   * (crud.ts:286); sin este guard el callback queda `undefined` y una reprogramación que abarata
   * (modo `reprice`, `creditAmount>0`) deja Checkout Sessions abiertas por el saldo VIEJO. Lo
   * inyecta el service desde `orchestrationDeps.paymentRequestsCeiling` (connector
   * `reservas-payment-requests`). Opcional: sin `payment_requests` configurados es no-op.
   */
  ceilingGuard?: (hotelId: string, reservationId: string) => Promise<void>
  logger?: any
  cache?: any
  sockets?: any
  chargePort?: RescheduleChargePort
  audit?: (entry: Record<string, unknown>) => void
  // `seasonAssignmentRepo` / `roomRateRepo` llegan de RepriceRepos: OPCIONALES y al final de las
  // deps a propósito. Sin ellos el modo `reprice` cae a `rooms.basePrice × noches` y lo declara
  // en `repricedFromRates: false` — degradación explícita, no silenciosa.
}

function assertOwnership(existing: any, user: { role: string; hotelId?: string }): void {
  if (!existing) throw new NotFoundError('Reserva no encontrada')
  if (user.role !== 'super_admin' && existing.hotelId !== user.hotelId) throw new AuthError('No autorizado')
}

/**
 * Qué se le puede reprogramar a una reserva según en qué punto de su vida está.
 *
 * No había NINGUNA comprobación de estado: se le podía correr la fecha de entrada a un huésped
 * que ya había hecho check-in —o a una estadía ya cerrada— y el sistema lo aceptaba. La entrada
 * de alguien que ya llegó es un hecho ocurrido, no una fecha editable; lo que sí sigue siendo
 * legítimo con el huésped adentro es trasladarlo de habitación y extenderle la salida.
 *
 * Vive en el quote (y no solo en la UI) porque el panel no es el único que llega hasta acá.
 */
function assertReschedulableStatus(existing: any, checkIn: string): void {
  const status = String(existing?.status || '').toLowerCase()
  const entradaOriginal = String(existing?.checkIn || '').slice(0, 10)
  if (status === 'checked_out') {
    throw new ConflictError('La estadía ya está cerrada: no se puede reprogramar. Editá la reserva si hay que corregirla.')
  }
  if (status === 'checked_in' && checkIn.slice(0, 10) !== entradaOriginal) {
    throw new ConflictError('El huésped ya hizo check-in: no se puede cambiar la fecha de entrada. Se puede cambiar de habitación o extender la salida.')
  }
}

async function buildQuote(deps: RescheduleDeps, existing: any, input: RescheduleInput): Promise<RescheduleQuote> {
  const roomRepo = deps.roomRepo
  const roomId = input.roomId || existing.roomId
  const checkIn = input.checkIn || existing.checkIn
  const checkOut = input.checkOut || existing.checkOut
  if (checkIn >= checkOut) throw new ConflictError('checkIn debe ser anterior a checkOut')
  assertReschedulableStatus(existing, checkIn)
  const room = await roomRepo.findById(roomId)
  // IDOR #668: si se pide mover a otra habitación (input.roomId explícito), debe pertenecer al
  // MISMO hotel que la reserva — si no, no hay que exponer basePrice ni disponibilidad de un
  // cuarto ajeno vía el quote (GET dry-run) ni permitir el commit (reusa updateReservation, que
  // ahora también lo verifica, pero cortar acá evita el leak de información en el quote).
  if (input.roomId && (!room || room.hotelId !== existing.hotelId)) {
    throw new ConflictError('La habitación no pertenece a este hotel')
  }
  const basePrice = Number(room?.basePrice) || 0
  const newNights = nightsBetween(checkIn, checkOut)
  const oldNights = nightsBetween(existing.checkIn, existing.checkOut)
  const previousTotal = Number(existing.totalAmount) || 0

  // Opción 1 — MANTENER el precio pactado: solo cobra las NOCHES AGREGADAS a tarifa base del
  // destino, sin repreciar la estadía (el total original pudo salir de otra tarifa/temporada).
  // OJO: mover de habitación sin cambiar noches da 0 acá aunque el cuarto nuevo valga el doble.
  // Eso es correcto para esta opción (se respeta lo pactado), NO es la única opción del quote.
  const keepDifference = round2(basePrice * (newNights - oldNights))
  const keepTotal = round2(previousTotal + keepDifference)

  // Opción 2 — REPRECIAR toda la estadía nueva a tarifa vigente (season_assignments → room_rates
  // → fallback rooms.basePrice), noche a noche. Es la que sí ve el cambio de habitación.
  const reprice = await repriceStay(deps, {
    hotelId: existing.hotelId,
    roomType: String(room?.type ?? ''),
    checkIn, checkOut,
    guests: guestsOfReservation(existing),
    fallbackPrice: basePrice,
  })
  const repricedTotal = round2(reprice.total)
  // Puede ser NEGATIVO (menos noches, o habitación más barata) = saldo a favor del huésped.
  // El quote lo expone; NO se cobra ni se devuelve plata automáticamente — lo decide el usuario.
  const repricedDifference = round2(repricedTotal - previousTotal)

  const pricingMode: ReschedulePricingMode = input.pricingMode === 'reprice' ? 'reprice' : 'keep'
  const applied = pricingMode === 'reprice'
    ? { quotedNewPrice: repricedTotal, difference: repricedDifference }
    : { quotedNewPrice: keepTotal, difference: keepDifference }

  return {
    reservationId: existing.id,
    roomId, checkIn, checkOut, basePrice, oldNights, newNights, previousTotal,
    ...applied,
    pricingMode,
    keepTotal, keepDifference,
    repricedTotal, repricedDifference, repricedFromRates: reprice.fromRates,
    roomChanged: String(roomId) !== String(existing.roomId),
    datesChanged: checkIn !== existing.checkIn || checkOut !== existing.checkOut,
    currency: existing.currency || 'USD',
  }
}

/** Dry-run: valida disponibilidad y calcula la diferencia. NO escribe nada. */
export async function quoteReschedule(deps: RescheduleDeps, id: string, input: RescheduleInput, user: { id: string; role: string; hotelId?: string }): Promise<RescheduleQuote & { available: boolean; reason: string }> {
  const existing = await deps.repo.findById(id)
  assertOwnership(existing, user)
  const quote = await buildQuote(deps, existing, input)
  let available = true
  let reason = ''
  try {
    await assertRoomAvailable(deps.repo, quote.roomId, quote.checkIn, quote.checkOut, id)
  } catch (e: any) {
    available = false
    reason = e.message
  }
  return { ...quote, available, reason }
}

/** Aplica el cambio de habitación/fechas y cobra la diferencia según el método elegido. */
export async function commitReschedule(deps: RescheduleDeps, id: string, input: RescheduleInput, user: { id: string; role: string; hotelId?: string }): Promise<{ reservation: any; quote: RescheduleQuote & { chargeAmount: number; newTotal: number; creditAmount: number }; charge: RescheduleChargeResult | null }> {
  const existing = await deps.repo.findById(id)
  assertOwnership(existing, user)
  const quote = await buildQuote(deps, existing, input)

  const charge = input.charge
  const overridden = charge && typeof charge.amount === 'number'
  const chargeAmount = charge ? (overridden ? round2(charge.amount as number) : Math.max(0, quote.difference)) : 0
  // Si el recepcionista fija un monto a mano, el total es lo previo + lo cobrado; si no, el precio de rack.
  const newTotal = overridden ? round2(quote.previousTotal + chargeAmount) : quote.quotedNewPrice
  // Saldo a favor cuando el reprice da MENOS que lo pactado. Se deja el total correcto y el dato,
  // pero NO se devuelve plata: cómo se le reintegra al huésped (nota de crédito, crédito en folio,
  // reembolso) lo decide el usuario en otro flujo.
  const creditAmount = Math.max(0, round2(quote.previousTotal - newTotal))

  // Reusa updateReservation: revalida solape (assertRoomAvailable) y emite el socket + invalida caché.
  // El `afterPersist` recalcula el saldo persistido DENTRO de esa ventana: el socket sale con el
  // pendiente del precio NUEVO y la caché del listado se invalida después de escribirlo (STR-2).
  // SEC3-2: el dto lleva `totalAmount`, así que crud dispara `afterCeilingDrop` — hay que pasarle el
  // clamp. Sin él, un reagendado que BAJA el total (reprice con `creditAmount>0`) deja links pending
  // vivos por el saldo viejo: el huésped puede pagar un importe mayor que el nuevo.
  const reservation = await updateReservation(
    deps.repo, deps.logger, deps.cache, deps.sockets, id,
    { roomId: quote.roomId, checkIn: quote.checkIn, checkOut: quote.checkOut, totalAmount: newTotal } as any,
    user,
    deps.roomRepo, undefined, undefined, undefined,
    {
      afterPersist: async (item) => ({ pendingAmount: await syncReservationPending(deps.repo, deps.addonsOf, id, deps.paidOf, item) }),
      afterCeilingDrop: deps.ceilingGuard
        ? async (item) => { await deps.ceilingGuard!(String(item.hotelId), String(item.id)) }
        : undefined,
    },
  )

  deps.audit?.({
    reservationId: id, hotelId: existing.hotelId, userId: user.id,
    from: { roomId: existing.roomId, checkIn: existing.checkIn, checkOut: existing.checkOut, total: quote.previousTotal },
    to: { roomId: quote.roomId, checkIn: quote.checkIn, checkOut: quote.checkOut, total: newTotal },
    chargeAmount, creditAmount, pricingMode: quote.pricingMode, method: charge?.method || null,
  })

  let chargeResult: RescheduleChargeResult | null = null
  if (charge && chargeAmount > 0 && deps.chargePort) {
    chargeResult = await deps.chargePort({
      reservationId: id, hotelId: existing.hotelId, guestId: existing.guestId || null, roomId: quote.roomId,
      currency: quote.currency, amount: chargeAmount, method: charge.method, reason: charge.reason,
      successUrl: input.successUrl, cancelUrl: input.cancelUrl,
    }, user)
  }

  return { reservation, quote: { ...quote, chargeAmount, newTotal, creditAmount }, charge: chargeResult }
}
