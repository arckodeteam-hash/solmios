import type { ConnectorContext } from 'arckode-framework'
import { chargeRescheduleDiff } from '../shared/usecases/charge-reschedule-diff'
import { settleRescheduleCredit } from '../shared/usecases/settle-reschedule-credit'
import type { RescheduleChargeParams } from '../modules/reservas/usecases/reschedule'
import type { RescheduleCreditParams } from '../shared/usecases/settle-reschedule-credit'

// Cablea las dos mitades de la plata cuando se reprograma o extiende una reserva:
//
//   · Cobrar la diferencia → folios (cargo a la cuenta), payments (efectivo→caja) o Stripe (tarjeta).
//   · Resolver lo que el huésped pagó de MÁS → dejarlo a favor, o devolverlo por donde entró.
//
// La segunda no existía: el excedente se calculaba, se avisaba en un toast y se perdía.
export function reservasRescheduleChargeConnector(ctx: ConnectorContext): void {
  const folios = ctx.resolveModule<any>('folios')
  const payments = ctx.resolveModule<any>('payments')
  const reservas = ctx.resolveModule<any>('reservas')

  reservas.setOrchestrationDeps({
    chargeReschedule: (params: RescheduleChargeParams, user: any) => chargeRescheduleDiff(folios, payments, params, user),

    creditReschedule: (params: RescheduleCreditParams, user: any) => settleRescheduleCredit({
      // Los tres vínculos de una reserva con su dinero los resuelve reservas (tiene los repos).
      paymentsOf: (hotelId, reservationId) => reservas.paymentsOfReservation(hotelId, reservationId),
      refundCard: (paymentId, amount) => payments.refundPayment(paymentId, amount, user),
      // Devolución por caja: un `payment` de tipo `refund`, que los reportes y el arqueo restan.
      // `reservationId` va como COLUMNA (no sólo metadata) por la misma razón que en el cobro:
      // si no, la devolución es invisible para el techo de payment-requests.
      createCashRefund: (dto) => payments.createPayment({
        hotelId: dto.hotelId, type: 'refund', method: 'cash', amount: dto.amount,
        currency: dto.currency, description: dto.description,
        guestId: dto.guestId || undefined, reservationId: dto.reservationId,
        status: 'completed',
        metadata: { reservationId: dto.reservationId, source: 'reschedule-credit' },
      }),
      hasInvoice: (hotelId, reservationId) => reservas.hasInvoiceForReservation(hotelId, reservationId),
    }, params),
  })
}
