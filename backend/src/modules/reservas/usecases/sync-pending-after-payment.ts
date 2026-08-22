// reservas/usecases/sync-pending-after-payment.ts — Resincroniza `reservations.pendingAmount`
// después de un MOVIMIENTO DE DINERO.
//
// Hallazgo COR-1 (2026-08-19, 2ª vuelta): `shared/usecases/sync-reservation-pending.ts` cubría las
// mutaciones DE RESERVA (alta/baja de un extra, `otherCharges`, `totalAmount`, reschedule) y dejaba
// afuera las mutaciones DE DINERO, que son justo el caso para el que se escribió GH-0.2:
// `folios.applyPayment` (folios/usecases/folio-entries.ts), `facturas.pay`
// (facturas/usecases/pay-invoice.ts) y el settlement del checkout
// (shared/usecases/settle-folio-at-checkout.ts) escriben en `payments` sin tocar la columna. El
// listado (`GET /api/reservas`, service.ts) servía la columna vieja mientras `/detail` recalculaba:
// mismo campo, dos números.
//
// El choke point es `payments`: TODA plata que entra al sistema nace de `payments.createPayment`
// (folios-payments, facturas-payments, payment-requests-payments, restaurante-payments) y toda
// devolución también (refund.ts asienta su fila por el mismo camino). Por eso el connector
// `payments-reservas` escucha ahí y no en cada módulo de origen.
//
// `payments` se llega a la reserva por TRES vínculos: `folioId` y `invoiceId` (los mismos dos que
// `shared/usecases/reservation-paid`) y `reservationId` directo — la columna que agregó
// BUG-ceiling-bypass para el cobro de una reprogramación en efectivo/tarjeta, que no cuelga ni de
// folio ni de factura (COR-A: el guard viejo ignoraba este tercer vínculo y dejaba la columna
// `pendingAmount` inflada justo tras ese cobro). Un pago sin ninguno de los tres (restaurante,
// caja) no pertenece a una reserva y se ignora.

import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { syncReservationPending, type AddonSource } from '../../../shared/usecases/sync-reservation-pending'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import type { ReservationChangedNotifier } from './reservation-changed'

/** Fila de `payments` en lo que le importa a esta resincronización. */
export interface MoneyRowRef {
  hotelId?: string | null
  folioId?: string | null
  invoiceId?: string | null
  /**
   * TERCER vínculo con la reserva, directo. Lo escribe `shared/usecases/charge-reschedule-diff.ts`
   * (BUG-ceiling-bypass): el cobro de una reprogramación en efectivo/tarjeta no cuelga de folio ni
   * de factura, así que sin esta columna la resincronización del saldo nunca lo veía.
   */
  reservationId?: string | null
}

/** Resuelve la reserva dueña de un folio/factura. Devuelve null si el movimiento no cuelga de una. */
export type ReservationOfMoneyRow = (hotelId: string, ref: MoneyRowRef) => Promise<string | null>

export interface SyncPendingAfterPaymentDeps {
  repo: RepositoryAdapter<any>
  addonsOf: AddonSource
  paidOf: PaidSource
  reservationOf: ReservationOfMoneyRow
  /** Socket + invalidación de la caché del listado: sin esto el saldo nuevo tarda hasta 300s. */
  notifyChanged: ReservationChangedNotifier
  logger: Logger
  /**
   * RTC-7.3 — recorta los links de pago vivos al saldo NUEVO. Lo implementa el módulo dueño del
   * cobro (`payment-requests`, connector `reservas-payment-requests`); sin cobros `pending` es no-op.
   *
   * Por qué acá: hasta este change `clampRequestsToCeiling` NO tenía un solo caller fuera de
   * `reservas` — se disparaba cuando alguien EDITABA la reserva, nunca cuando entraba plata. Cobrar
   * el saldo en caja, por folio o por factura asienta en `payments`, deja el saldo cobrable en 0 y
   * dejaba el link de Stripe pagable: es el flujo normal de cobro del hotel, no un caso de borde.
   * Medido por `payment-requests/tests/ceiling-property.test.ts` (`requerir-pago → cobro-en-caja`,
   * $400 cobrables sobre un saldo de $0).
   *
   * Es el mismo choke point que ya usa esta resincronización (`payments.createPayment` →
   * `onPaymentCreated`), así que cubre a TODOS los escritores del libro del dinero de una sola vez:
   * folios-payments, facturas-payments, restaurante-payments, payment-requests-payments,
   * charge-reschedule-diff y el settlement del checkout.
   */
  ceilingGuard?: (hotelId: string, reservationId: string) => Promise<void>
}

/**
 * Recalcula y persiste el saldo de la reserva dueña del movimiento. Best-effort: un fallo acá NO
 * puede tumbar el cobro, que ya ocurrió (la plata entró). Devuelve el saldo nuevo, o null si el
 * movimiento no correspondía a ninguna reserva.
 */
export async function syncPendingAfterPayment(
  deps: SyncPendingAfterPaymentDeps,
  row: MoneyRowRef,
): Promise<number | null> {
  const hotelId = String(row?.hotelId ?? '')
  // Sin hotel no se puede consultar nada sin cruzar tenants: se corta acá, no se adivina.
  if (!hotelId) return null
  // COR-A: los TRES vínculos cuentan. El guard viejo (`!folioId && !invoiceId`) descartaba la fila
  // del cobro de una reprogramación (sólo `reservationId`, ver `MoneyRowRef`) ANTES de consultar a
  // `reservationOf`: ese cobro entraba a `payments`, el techo lo descontaba, y la columna
  // `pendingAmount` que sirven el listado y el planning quedaba inflada — sin socket ni
  // invalidación. La plomería del vínculo directo (`money-port.ts:reservationIdOf` lo prioriza)
  // era código muerto en esta ruta.
  if (!row?.folioId && !row?.invoiceId && !row?.reservationId) return null

  try {
    const reservationId = await deps.reservationOf(hotelId, row)
    if (!reservationId) return null

    const reservation = await deps.repo.findById(reservationId) as any
    // Multi-tenancy: el folio/factura ya se leyó filtrado por hotel, pero la reserva se revalida.
    if (!reservation || String(reservation.hotelId ?? '') !== hotelId) return null

    const before = Number(reservation.pendingAmount ?? NaN)
    const pendingAmount = await syncReservationPending(deps.repo, deps.addonsOf, reservationId, deps.paidOf, reservation)
    if (pendingAmount !== before) await deps.notifyChanged({ ...reservation, pendingAmount })
    // RTC-7.3: la plata que acaba de entrar baja el techo del cobro → los links vivos lo siguen.
    // Va DESPUÉS de persistir el saldo (el clamp relee la reserva) y SIEMPRE, no sólo si el número
    // cambió: `pendingAmount` es la columna espejo, el techo se recalcula contra `payments`.
    if (deps.ceilingGuard) await deps.ceilingGuard(hotelId, reservationId)
    return pendingAmount
  } catch (e) {
    deps.logger.error('No se pudo resincronizar el saldo de la reserva tras un pago', {
      hotelId, folioId: row?.folioId ?? null, invoiceId: row?.invoiceId ?? null,
      reservationId: row?.reservationId ?? null, error: String(e),
    })
    return null
  }
}

/**
 * Arma los deps desde las piezas del service. Vive acá (y no inline en `service.ts`) por la regla
 * GOD_SERVICE del analyzer: el service wirea, el usecase decide.
 */
export function pendingAfterPaymentDeps(
  repo: RepositoryAdapter<any>,
  queries: {
    getReservationAddons: (reservationId: string, hotelId: string) => Promise<readonly any[]>
    reservationIdOfMoneyRow: (hotelId: string, ref: MoneyRowRef) => Promise<string | null>
  },
  paidOf: PaidSource,
  notifyChanged: ReservationChangedNotifier,
  logger: Logger,
  /** RTC-7.3 — ver `SyncPendingAfterPaymentDeps.ceilingGuard`. */
  ceilingGuard?: (hotelId: string, reservationId: string) => Promise<void>,
): SyncPendingAfterPaymentDeps {
  return {
    repo,
    addonsOf: (reservationId, hotelId) => queries.getReservationAddons(reservationId, hotelId),
    paidOf,
    reservationOf: (hotelId, ref) => queries.reservationIdOfMoneyRow(hotelId, ref),
    notifyChanged,
    logger,
    ceilingGuard,
  }
}
