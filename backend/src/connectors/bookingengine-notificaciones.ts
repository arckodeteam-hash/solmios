// connectors/bookingengine-notificaciones.ts — Wire: bookingengine → notificaciones (aviso al hotel).
//
// Una reserva del motor web (`onBookingCreated`), un pago confirmado por la pasarela
// (`onBookingPaid`) o una cancelación del huésped (`onBookingCancelled`, #272) tienen que enterarle
// al hotel: campanita a quien puede ver reservas, correo al buzón del hotel y push. Solo delega: la
// lógica vive en `shared/usecases/notify-reservation-received`.
//
// Todo se resuelve EN CADA aviso, no al cablear (mismo criterio que canales-notificaciones): si un
// módulo opcional no está, el aviso sale igual con lo que haya. Y los deps se arman con MÓDULOS, no
// con el orm — un connector no lee tablas ajenas (ver reservas-money.ts).
//
// El correo no se resuelve acá: el EmailService nace DESPUÉS de `system.start()` y lo inyecta
// `email-bootstrap` en `notificaciones.setHotelEmailDeps` (post-init). Hasta entonces,
// `hotelEmailDeps()` es null y el aviso va sin correo.

import type { ConnectorContext, Logger } from 'arckode-framework'
import {
  notifyReservationCancelled,
  notifyReservationPaid,
  notifyReservationReceived,
  type ReservationEmailSender,
  type ReservationNotifyDeps,
} from '../shared/usecases/notify-reservation-received'
import type { BookingCancelledEvent } from '../modules/bookingengine/sockets'
import type { NotificacionesPort, PushPort, RoomsPort } from '../shared/usecases/notify-task-assigned'
import { DEFAULT_PLATFORM_IDENTITY, type PlatformIdentity } from '../shared/utils/platform-identity'

interface SystemActor { id: string; role: string; hotelId?: string }

interface NotificacionesModule extends NotificacionesPort {
  hotelEmailDeps?: () => { emailSender: ReservationEmailSender; platformIdentity: () => Promise<PlatformIdentity> } | null
}

/** Lo que trae el socket del motor: `id` ES el reservationId (ver bookingengine/service.ts). */
interface BookingEvent {
  id: string
  hotelId: string
  totalAmount?: number
  currency?: string
  provider?: string
  paymentRef?: string
}

const SYSTEM: SystemActor = { id: 'system', role: 'super_admin' }

export function bookingengineNotificacionesConnector(logger: Logger): (ctx: ConnectorContext) => void {
  const log = logger.child('bookingengine-notificaciones')
  return (ctx: ConnectorContext) => {
    const bookingengine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')

    /**
     * Lo que puede faltar sin frenar el aviso: un módulo opcional no registrado en este despliegue
     * (habitaciones, pushtokens, huespedes) o un `getById` que tira NotFound/Auth — para el aviso
     * eso es "no hay dato", no un error.
     */
    const quiet = async <T>(run: () => T | Promise<T>): Promise<T | null> => {
      try { return await run() } catch { return null }
    }

    const deps = async (hotelId: string): Promise<ReservationNotifyDeps> => {
      const actor: SystemActor = { ...SYSTEM, hotelId }
      const notificaciones = ctx.resolveModule<NotificacionesModule>('notificaciones')
      const reservas = ctx.resolveModule<{
        getById(id: string, user: SystemActor): Promise<any>
        list(query: Record<string, unknown>, user: SystemActor): Promise<{ data: any[] }>
      }>('reservas')
      const hoteles = ctx.resolveModule<{ getById(id: string, user: SystemActor): Promise<any> }>('hoteles')
      const huespedes = await quiet(() => ctx.resolveModule<{ getById(id: string, user: SystemActor): Promise<any> }>('huespedes'))
      const email = typeof notificaciones.hotelEmailDeps === 'function' ? notificaciones.hotelEmailDeps() : null

      return {
        notificaciones,
        users: ctx.resolveModule<{ list(hotelId?: string): Promise<any[]> }>('usuarios'),
        roles: ctx.resolveModule<ReservationNotifyDeps['roles']>('roles'),
        reservations: {
          findById: (id) => quiet(() => reservas.getById(id, actor)),
          findMany: async (where) => (await reservas.list({ ...where, limit: 100 }, actor)).data,
        },
        hotels: { findById: (id) => quiet(() => hoteles.getById(id, actor)) },
        guests: huespedes ? { findById: (id) => quiet(() => huespedes.getById(id, actor)) } : null,
        rooms: await quiet(() => ctx.resolveModule<RoomsPort>('habitaciones')),
        push: await quiet(() => ctx.resolveModule<PushPort>('pushtokens')),
        emailSender: email?.emailSender ?? null,
        platformIdentity: email?.platformIdentity ?? (async () => ({ ...DEFAULT_PLATFORM_IDENTITY })),
        logger: log,
      }
    }

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
