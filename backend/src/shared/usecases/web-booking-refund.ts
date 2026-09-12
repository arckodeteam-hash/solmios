// shared/usecases/web-booking-refund.ts — #272: el huésped canceló desde la web y le corresponde plata.
//
// `public-cancel` calcula `refundAmount` con la política del hotel y deja la reserva `cancelled`;
// acá se ejecuta el reembolso REAL en la pasarela y se persiste el resultado en la reserva
// (`refundStatus` / `refundedAt` / `refundPaymentId`, ver reservas/model.ts) para que el hotel y el
// huésped vean el estado verdadero y no una promesa.
//
// Grupo (N habitaciones con el mismo `groupId` y token compartido): el cobro está a nombre de la
// LÍDER (la que tiene `priceBreakdown`), aunque la cancelación pueda entrar por cualquier hermana.
// Se busca el cobro en todas las filas del grupo y el estado se escribe en TODAS, así cualquier
// fila que se abra en el panel cuenta lo mismo.
//
// Idempotente, en TRES capas (un refund parcial repetido Stripe NO lo rechaza: cobro 200, dos
// refunds de 100 salen los dos):
//   1. `refundStatus === 'done'` en la reserva → `skipped already_done`, sin leer nada más.
//   2. El asiento de `payments`: si ya existe una fila `refund` con `metadata.refundOf` apuntando
//      al cobro elegido (la crea `payments/usecases/refund.ts`), la plata YA salió aunque la
//      reserva no lo diga (el `updateAll` de abajo traga errores fila por fila). Se repara el estado
//      y se responde `done` con esa fila, sin tocar la pasarela. Cubre el reintento tras una
//      escritura fallida.
//   3. `reservations.claimRefund` (opcional): compare-and-swap que deja la reserva en `pending`
//      ANTES de llamar a Stripe; el segundo de dos invocaciones concurrentes (evento duplicado +
//      reintento a mano) ve `false` y se va con `skipped in_progress` sin escribir nada.
// Si la pasarela falla (o no hay cobro Stripe que devolver) queda `failed` y se le avisa al hotel
// con una campanita `system` para que reintente desde la reserva. Nunca tira: el reembolso que no
// sale no puede deshacer una cancelación que ya está guardada.
//
// Sin imports de módulos: sólo puertos, para que el connector lo cablee y el test lo arme a mano.

import { reservationPanelLink } from './notify-reservation-received'

export interface WebRefundPaymentsPort {
  /** Filas `payments` asentadas a nombre de la reserva (`payments.paymentsLinkedTo`). */
  paymentsLinkedTo(
    hotelId: string,
    ref: { reservationId: string },
  ): Promise<Array<{
    id: string
    type?: string
    status?: string
    amount?: number
    stripeSessionId?: string
    stripePaymentId?: string
    method?: string
    /** En las filas `refund`, `refundOf` apunta al cobro devuelto (`payments/usecases/refund.ts`). */
    metadata?: Record<string, unknown>
    createdAt?: string
  }>>
  /** `payments.refundPayment`: devuelve en Stripe y asienta la fila `refund`. */
  refundPayment(
    paymentId: string,
    amount?: number,
    user?: { id?: string; role?: string },
    reason?: string,
  ): Promise<{ id: string }>
}

export interface WebRefundDeps {
  payments: WebRefundPaymentsPort
  reservations: {
    findById(id: string): Promise<any | null>
    findMany(where: Record<string, unknown>): Promise<any[]>
    update(id: string, patch: Record<string, unknown>): Promise<unknown>
    /**
     * Reclamo atómico del reembolso (compare-and-swap → `refundStatus: 'pending'`). `false` = otra
     * invocación ya lo tiene (o la reserva ya está `done`): NO se llama a la pasarela. Opcional:
     * sin él, la única barrera contra dos llamadas simultáneas es la capa 2 (asiento de payments).
     */
    claimRefund?(id: string): Promise<boolean>
  }
  /** Aviso `system` al hotel cuando el reembolso no salió. Opcional. */
  notifyHotel?: (
    hotelId: string,
    n: { title: string; message: string; metadata?: Record<string, unknown> },
  ) => Promise<void>
  logger: { info(m: string, meta?: any): void; warn(m: string, meta?: any): void }
}

export interface WebRefundInput {
  reservationId: string
  hotelId: string
  /** Lo que calculó la política al cancelar (`reservations.refundAmount`). */
  refundAmount: number
}

export type WebRefundOutcome =
  | { status: 'done'; refundPaymentId: string; amount: number }
  | { status: 'none' }
  | { status: 'failed'; error: string }
  | { status: 'skipped'; reason: 'already_done' | 'not_found' | 'in_progress' }

/** Actor con el que se asienta el refund: no lo pidió nadie del hotel, lo disparó la cancelación web. */
export const SYSTEM_REFUND_ACTOR = { id: 'system', role: 'super_admin' }

export const WEB_REFUND_REASON = 'guest_cancellation'

type ChargeRow = Awaited<ReturnType<WebRefundPaymentsPort['paymentsLinkedTo']>>[number]

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Cobro Stripe devolvible: `charge` (o sin tipo, filas viejas) completado con referencia en la pasarela. */
function isRefundableCharge(p: ChargeRow): boolean {
  if (!p?.id) return false
  if (p.type && p.type !== 'charge') return false
  if (p.status !== 'completed') return false
  return Boolean(p.stripeSessionId || p.stripePaymentId)
}

/** Filas del grupo (o sólo la reserva). La líder (`priceBreakdown`) va primera: es la que lleva el cobro. */
async function loadGroupRows(deps: WebRefundDeps, reservation: any, hotelId: string): Promise<any[]> {
  let rows: any[] = [reservation]
  if (reservation.groupId) {
    try {
      const found = await deps.reservations.findMany({ hotelId, groupId: reservation.groupId })
      if (Array.isArray(found) && found.length > 0) rows = found
    } catch (e) {
      deps.logger.warn('web-refund: no se pudieron cargar las reservas del grupo; se sigue con esta', {
        reservationId: reservation.id, groupId: reservation.groupId, error: (e as Error).message,
      })
    }
  }
  const leaders = rows.filter((r) => Boolean(r?.priceBreakdown))
  const rest = rows.filter((r) => !r?.priceBreakdown)
  return [...leaders, ...rest]
}

/** Fila `refund` ya asentada contra ESTE cobro por una cancelación web anterior (capa 2 de idempotencia). */
function existingRefundOf(linked: ChargeRow[], charge: ChargeRow): ChargeRow | null {
  return linked.find((p) => p?.id && p.type === 'refund' && p.metadata?.refundOf === charge.id
    && (p.metadata?.reason == null || p.metadata.reason === WEB_REFUND_REASON)) ?? null
}

/** El cobro devolvible y las filas `payments` de la MISMA reserva donde se encontró (para el dedupe). */
async function findCharge(deps: WebRefundDeps, rows: any[], hotelId: string): Promise<{ charge: ChargeRow; linked: ChargeRow[] } | null> {
  for (const row of rows) {
    if (!row?.id) continue
    let linked: ChargeRow[] = []
    try {
      linked = await deps.payments.paymentsLinkedTo(hotelId, { reservationId: String(row.id) })
    } catch (e) {
      deps.logger.warn('web-refund: no se pudieron leer los cobros de la reserva', {
        reservationId: row.id, error: (e as Error).message,
      })
      continue
    }
    const charge = (linked ?? []).find(isRefundableCharge)
    if (charge) return { charge, linked: linked ?? [] }
  }
  return null
}

/** Mismo patch en todas las filas del grupo; si una falla, las demás siguen. */
async function updateAll(deps: WebRefundDeps, rows: any[], patch: Record<string, unknown>): Promise<void> {
  for (const row of rows) {
    if (!row?.id) continue
    try {
      await deps.reservations.update(String(row.id), patch)
    } catch (e) {
      deps.logger.warn('web-refund: no se pudo actualizar el estado del reembolso', {
        reservationId: row.id, patch, error: (e as Error).message,
      })
    }
  }
}

async function warnHotel(
  deps: WebRefundDeps,
  hotelId: string,
  reservation: any,
  amount: number,
  currency: string,
  error: string,
): Promise<void> {
  if (!deps.notifyHotel) return
  const money = `${amount.toFixed(2)} ${currency}`
  try {
    await deps.notifyHotel(hotelId, {
      title: `Reembolso de ${money} pendiente — reintentar desde la reserva`,
      message: `La cancelación web de la reserva ${reservation.id} corresponde devolver ${money}, `
        + `pero el reembolso en la pasarela no salió (${error}). Abrí la reserva y reintentá.`,
      metadata: {
        reservationId: reservation.id,
        refundAmount: amount,
        link: reservationPanelLink(String(reservation.id)),
      },
    })
  } catch (e) {
    deps.logger.warn('web-refund: no se pudo avisar al hotel del reembolso fallido', {
      reservationId: reservation.id, error: (e as Error).message,
    })
  }
}

/**
 * Ejecuta el reembolso de una cancelación web y deja el estado en la(s) reserva(s).
 *
 * Nunca tira: devuelve el `WebRefundOutcome` para que el llamador lo registre.
 */
export async function refundCancelledWebBooking(
  deps: WebRefundDeps,
  input: WebRefundInput,
): Promise<WebRefundOutcome> {
  const hotelId = String(input.hotelId)
  const reservation = await deps.reservations.findById(String(input.reservationId)).catch(() => null)
  if (!reservation || (reservation.hotelId && String(reservation.hotelId) !== hotelId)) {
    deps.logger.warn('web-refund: reserva no encontrada o de otro hotel', {
      reservationId: input.reservationId, hotelId,
    })
    return { status: 'skipped', reason: 'not_found' }
  }

  if (reservation.refundStatus === 'done') {
    deps.logger.info('web-refund: la reserva ya fue reembolsada; no se repite', {
      reservationId: reservation.id, refundPaymentId: reservation.refundPaymentId,
    })
    return { status: 'skipped', reason: 'already_done' }
  }

  const rows = await loadGroupRows(deps, reservation, hotelId)
  const currency = String(reservation.currency || 'USD')
  const requested = Number(input.refundAmount)

  if (!Number.isFinite(requested) || requested <= 0) {
    await updateAll(deps, rows, { refundStatus: 'none' })
    return { status: 'none' }
  }

  const found = await findCharge(deps, rows, hotelId)
  if (!found) {
    const error = 'no_stripe_payment'
    await updateAll(deps, rows, { refundStatus: 'failed' })
    await warnHotel(deps, hotelId, reservation, round2(requested), currency, error)
    deps.logger.warn('web-refund: sin cobro Stripe que devolver', {
      reservationId: reservation.id, groupId: reservation.groupId, refundAmount: requested,
    })
    return { status: 'failed', error }
  }

  const { charge, linked } = found
  const charged = Number(charge.amount)
  const amount = round2(Math.min(requested, Number.isFinite(charged) && charged > 0 ? charged : requested))

  // Capa 2: la plata ya salió (hay asiento `refund` contra este cobro) pero la reserva no lo dice.
  // Se repara el estado y se responde `done` — es lo que el reintento necesita ver — sin Stripe.
  const prior = existingRefundOf(linked, charge)
  if (prior) {
    await updateAll(deps, rows, {
      refundStatus: 'done',
      refundedAt: prior.createdAt ?? new Date().toISOString(),
      refundPaymentId: prior.id,
    })
    deps.logger.info('web-refund: el cobro ya tenía un reembolso asentado; se repara el estado sin repetirlo', {
      reservationId: reservation.id, paymentId: charge.id, refundPaymentId: prior.id,
    })
    return { status: 'done', refundPaymentId: prior.id, amount: round2(Number(prior.amount) || amount) }
  }

  // Capa 3: reclamo atómico. El que pierde la carrera no escribe ni llama a nada.
  if (deps.reservations.claimRefund && !(await deps.reservations.claimRefund(String(reservation.id)))) {
    deps.logger.info('web-refund: otra invocación tiene el reembolso en curso; no se repite', {
      reservationId: reservation.id, paymentId: charge.id,
    })
    return { status: 'skipped', reason: 'in_progress' }
  }

  await updateAll(deps, rows, { refundStatus: 'pending' })
  try {
    const refund = await deps.payments.refundPayment(charge.id, amount, SYSTEM_REFUND_ACTOR, WEB_REFUND_REASON)
    await updateAll(deps, rows, {
      refundStatus: 'done',
      refundedAt: new Date().toISOString(),
      refundPaymentId: refund.id,
    })
    deps.logger.info('web-refund: reembolso hecho', {
      reservationId: reservation.id, paymentId: charge.id, refundPaymentId: refund.id, amount, currency,
    })
    return { status: 'done', refundPaymentId: refund.id, amount }
  } catch (e) {
    const error = (e as Error)?.message || String(e)
    await updateAll(deps, rows, { refundStatus: 'failed' })
    await warnHotel(deps, hotelId, reservation, amount, currency, error)
    deps.logger.warn('web-refund: la pasarela no devolvió', {
      reservationId: reservation.id, paymentId: charge.id, amount, error,
    })
    return { status: 'failed', error }
  }
}
