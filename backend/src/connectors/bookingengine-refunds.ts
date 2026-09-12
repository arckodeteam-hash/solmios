// connectors/bookingengine-refunds.ts — Wire: bookingengine (cancelación web) → payments + reservas (#272).
//
// `public-cancel` deja la reserva `cancelled` con `refundAmount` calculado por la política y emite
// `onBookingCancelled` UNA vez por grupo. Acá se ejecuta el reembolso REAL en Stripe
// (`payments.refundPayment`) y se persiste `refundStatus/refundedAt/refundPaymentId` en todas las
// filas del grupo. La lógica vive en `shared/usecases/web-booking-refund`; esto sólo cablea puertos.
//
// Los puertos se arman con MÓDULOS, no con el orm (mismo criterio que bookingengine-notificaciones):
//   · `reservas.getById/list` con actor de sistema scoped al hotel del evento.
//   · `reservas.setRefundState` escribe SOLO los campos del reembolso (sin pasar por la state machine
//     de `update`, que rechazaría tocar una reserva ya cancelada).
//   · `reservas.claimRefund` es el compare-and-swap que deja `pending` ANTES de llamar a Stripe: de
//     dos invocaciones concurrentes (evento duplicado + reintento) sólo una devuelve plata.
//   · `notificaciones/usuarios/roles` → campanita `system` al hotel cuando la pasarela no devolvió.
//
// Se registra ANTES de bookingengine-notificaciones y del correo (email-bootstrap, post-start):
// los sockets del motor se encadenan en orden de registro, así el aviso al hotel y el correo ya
// ven el `refundStatus` verdadero. Best-effort: un reembolso que falla NUNCA tumba la cancelación.
//
// Además le inyecta a `reservas` el puerto `retryWebRefund` (POST /api/reservas/:id/retry-refund):
// mismo usecase, disparado a mano por el hotel cuando quedó `failed`.

import type { ConnectorContext, Logger } from 'arckode-framework'
import type { BookingCancelledEvent } from '../modules/bookingengine/sockets'
import type { ReservasOrchestrationDeps } from '../modules/reservas/usecases/orchestration-deps'
import { notifySystemToViewers, type ReservationNotifyDeps } from '../shared/usecases/notify-reservation-received'
import { refundCancelledWebBooking, type WebRefundDeps, type WebRefundInput, type WebRefundOutcome, type WebRefundPaymentsPort } from '../shared/usecases/web-booking-refund'

interface SystemActor { id: string; role: string; hotelId?: string }

interface ReservasModule {
  getById(id: string, user: SystemActor): Promise<any>
  list(query: Record<string, unknown>, user: SystemActor): Promise<{ data: any[] }>
  setRefundState(id: string, patch: Record<string, unknown>): Promise<unknown>
  claimRefund(id: string): Promise<boolean>
  setOrchestrationDeps(deps: Pick<ReservasOrchestrationDeps, 'retryWebRefund'>): void
}

const SYSTEM: SystemActor = { id: 'system', role: 'super_admin' }

export function bookingengineRefundsConnector(logger: Logger): (ctx: ConnectorContext) => void {
  const log = logger.child('bookingengine-refunds')
  return (ctx: ConnectorContext) => {
    const bookingengine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')
    const reservas = ctx.resolveModule<ReservasModule>('reservas')

    /** Se resuelve EN CADA reembolso: si `payments` no está en este despliegue, falla ahí y se loguea. */
    const deps = (hotelId: string): WebRefundDeps => {
      const actor: SystemActor = { ...SYSTEM, hotelId }
      const viewers: Pick<ReservationNotifyDeps, 'notificaciones' | 'users' | 'roles' | 'logger'> = {
        notificaciones: ctx.resolveModule<ReservationNotifyDeps['notificaciones']>('notificaciones'),
        users: ctx.resolveModule<ReservationNotifyDeps['users']>('usuarios'),
        roles: ctx.resolveModule<ReservationNotifyDeps['roles']>('roles'),
        logger: log,
      }
      return {
        payments: ctx.resolveModule<WebRefundPaymentsPort>('payments'),
        reservations: {
          findById: (id) => reservas.getById(id, actor),
          findMany: async (where) => (await reservas.list({ ...where, limit: 100 }, actor)).data,
          update: (id, patch) => reservas.setRefundState(id, patch),
          claimRefund: (id) => reservas.claimRefund(id),
        },
        notifyHotel: async (hid, n) => { await notifySystemToViewers(viewers, hid, n) },
        logger: log,
      }
    }

    const refund = (input: WebRefundInput): Promise<WebRefundOutcome> => refundCancelledWebBooking(deps(input.hotelId), input)

    bookingengine.setSockets({
      onBookingCancelled: async (e: BookingCancelledEvent) => {
        try {
          await refund({ reservationId: e.reservationId, hotelId: e.hotelId, refundAmount: Number(e.refundAmount) || 0 })
        } catch (err) {
          log.warn('No se pudo ejecutar el reembolso de la cancelación web', {
            reservationId: e?.reservationId, hotelId: e?.hotelId, error: (err as Error).message,
          })
        }
      },
    })

    reservas.setOrchestrationDeps({
      retryWebRefund: async (input) => {
        const out = await refund(input)
        return { status: out.status, ...('refundPaymentId' in out ? { refundPaymentId: out.refundPaymentId } : {}), ...('error' in out ? { error: out.error } : {}) }
      },
    })
  }
}
