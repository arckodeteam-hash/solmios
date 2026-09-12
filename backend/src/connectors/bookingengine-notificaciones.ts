// connectors/bookingengine-notificaciones.ts — Wire: bookingengine → notificaciones (aviso al hotel).
//
// Una reserva del motor web (`onBookingCreated`), un pago confirmado por la pasarela
// (`onBookingPaid`) o una cancelación del huésped (`onBookingCancelled`, #272) tienen que enterarle
// al hotel: campanita a quien puede ver reservas, correo al buzón del hotel y push. Solo delega: la
// lógica vive en `shared/usecases/notify-reservation-received` y los deps los arma
// `reservation-notify-deps.ts` (compartido con el cron de recordatorio de aprobación, #271 MR-06)
// — con MÓDULOS, no con el orm, y resueltos EN CADA aviso.

import type { ConnectorContext, Logger } from 'arckode-framework'
import {
  notifyReservationCancelled,
  notifyReservationPaid,
  notifyReservationReceived,
  type ReservationNotifyDeps,
} from '../shared/usecases/notify-reservation-received'
import type { BookingCancelledEvent } from '../modules/bookingengine/sockets'
import { reservationNotifyDepsFactory } from './reservation-notify-deps'

/** Lo que trae el socket del motor: `id` ES el reservationId (ver bookingengine/service.ts). */
interface BookingEvent {
  id: string
  hotelId: string
  totalAmount?: number
  currency?: string
  provider?: string
  paymentRef?: string
}

export function bookingengineNotificacionesConnector(logger: Logger): (ctx: ConnectorContext) => void {
  const log = logger.child('bookingengine-notificaciones')
  return (ctx: ConnectorContext) => {
    const bookingengine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')
    const deps = reservationNotifyDepsFactory((n) => ctx.resolveModule(n), log)

    /**
     * El usecase ya no tira, pero armar los deps sí puede (un módulo núcleo ausente). Un fallo del
     * aviso NUNCA tumba la reserva ni el webhook: se loguea y se sigue. Un evento sin `id`/`hotelId`
     * lo resuelve el usecase como "reserva no encontrada" (warn, sin aviso).
     */
    const swallow = async (event: string, b: BookingEvent, run: (d: ReservationNotifyDeps) => Promise<unknown>): Promise<void> => {
      try {
        await run(await deps(b?.hotelId))
      } catch (e) {
        log.warn('No se pudo avisar la reserva al hotel', {
          event, reservationId: b?.id, hotelId: b?.hotelId, error: (e as Error).message,
        })
      }
    }

    bookingengine.setSockets({
      onBookingCreated: (b: BookingEvent) => swallow('created', b, (d) =>
        notifyReservationReceived(d, { id: b.id, hotelId: b.hotelId }, 'web')),
      onBookingPaid: (b: BookingEvent) => swallow('paid', b, (d) =>
        notifyReservationPaid(d, { id: b.id, hotelId: b.hotelId }, {
          totalAmount: Number(b.totalAmount) || 0,
          currency: b.currency,
          provider: b.provider,
          paymentRef: b.paymentRef,
        })),
      // #272 — el reembolso (bookingengine-refunds) se registra ANTES y los sockets se encadenan en
      // orden: al releer la reserva acá ya tiene el `refundStatus` verdadero (best-effort: sin fila → undefined).
      onBookingCancelled: (e: BookingCancelledEvent) => swallow('cancelled', { id: e.reservationId, hotelId: e.hotelId }, async (d) =>
        notifyReservationCancelled(d, { id: e.reservationId, hotelId: e.hotelId }, {
          refundAmount: Number(e.refundAmount) || 0,
          cancellationFee: Number(e.cancellationFee) || 0,
          refundStatus: (await d.reservations.findById(e.reservationId))?.refundStatus ?? undefined,
          roomsCount: Array.isArray(e.reservationIds) && e.reservationIds.length > 0 ? e.reservationIds.length : undefined,
        })),
    })
  }
}
