// connectors/reservas-payment-requests.ts — `reservas` ↔ `payment-requests`.
//
// Dos cosas viven acá:
//   1. El auto-request del alta (automation_config.autoPaymentRequest): la fila la crea el
//      SERVICE del módulo dueño — con techo, lock y re-verificación post-commit (SEC3-4/COR-E) —
//      y no un orm.create directo que pasaba por arriba las tres garantías.
//   2. SEC3-2/SEC3-3: cuando el total cobrable de una reserva BAJA (PUT totalAmount/otherCharges,
//      baja de un extra) o la reserva se borra, los links de pago vivos se recortan/liberan desde
//      el lado del dueño del cobro. `reservas` no sabe de Stripe ni de `payment_requests`.
import type { ConnectorContext } from 'arckode-framework'
import { handleReservationCreated, handleReservationUpdated, handleReservationDeleted } from '../shared/usecases/auto-payment-request'

interface PaymentRequestsLike {
  create(dto: { hotelId?: string; reservationId: string; amount: number; currency?: string }, user: { id: string; role: string; hotelId?: string }): Promise<unknown>
  clampRequestsToCeiling(hotelId: string, reservationId: string, user: { id: string; role: string; hotelId?: string }): Promise<number>
  releaseRequestsOfReservation(hotelId: string, reservationId: string, user: { id: string; role: string; hotelId?: string }): Promise<number>
}

interface ReservasLike {
  setSockets: (s: any) => void
  setOrchestrationDeps: (deps: {
    paymentRequestsCeiling?: {
      clamp: (hotelId: string, reservationId: string) => Promise<void>
      releaseAll: (hotelId: string, reservationId: string) => Promise<void>
    },
  }) => void
}

/** Actor de sistema para las mutaciones que dispara el backend (no hay usuario en un socket). */
const SYSTEM_USER = { id: 'system', role: 'super_admin' }

export function reservasPaymentRequestsConnector(orm: any): (ctx: ConnectorContext) => void {
  return (ctx: ConnectorContext) => {
    const paymentRequests = ctx.resolveModule<PaymentRequestsLike>('payment-requests')
    const reservas = ctx.resolveModule<ReservasLike>('reservas')
    reservas.setSockets({
      onReservasCreated: (r: any) => handleReservationCreated(orm, r, paymentRequests),
      onReservasUpdated: (r: any) => handleReservationUpdated(orm, r),
      onReservasDeleted: (id: string) => handleReservationDeleted(orm, id),
    })
    reservas.setOrchestrationDeps({
      // Los recortes quedan rastreados en el audit log con actor `system` (los dispara un cambio
      // de la reserva, no una edición manual del cobro).
      paymentRequestsCeiling: {
        clamp: async (hotelId, reservationId) => { await paymentRequests.clampRequestsToCeiling(hotelId, reservationId, { ...SYSTEM_USER, hotelId }) },
        releaseAll: async (hotelId, reservationId) => { await paymentRequests.releaseRequestsOfReservation(hotelId, reservationId, { ...SYSTEM_USER, hotelId }) },
      },
    })
  }
}
