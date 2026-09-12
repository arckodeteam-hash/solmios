// connectors/bookingengine-notificaciones.ts — Wire: bookingengine → notificaciones (aviso al hotel).
//
// Una reserva del motor web (`onBookingCreated`) o un pago confirmado por la pasarela
// (`onBookingPaid`) tienen que enterarle al hotel: campanita a quien puede ver reservas, correo al
// buzón del hotel y push. Solo delega: la lógica vive en `shared/usecases/notify-reservation-received`.
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
  notifyReservationPaid,
  notifyReservationReceived,
  type ReservationEmailSender,
  type ReservationNotifyDeps,
} from '../shared/usecases/notify-reservation-received'
import type { NotificacionesPort, PushPort, RoomsPort } from '../shared/usecases/notify-task-assigned'
import { DEFAULT_PLATFORM_IDENTITY, type PlatformIdentity } from '../shared/utils/platform-identity'

interface SystemActor { id: string; role: string; hotelId?: string }

interface NotificacionesModule extends NotificacionesPort {
  hotelEmailDeps?: () => { emailSender: ReservationEmailSender; platformIdentity: () => Promise<PlatformIdentity> } | null
}

/**
 * Lo que trae el socket del motor: `id` ES el reservationId (ver bookingengine/service.ts).
 * `paid`/`hasCheckout` los manda el controller del motor (#267): la fila no cuenta si el hotel
 * tenía pasarela, y eso cambia el texto del estado de pago que le llega al hotel.
 */
interface BookingEvent {
  id: string
  hotelId: string
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  totalAmount?: number
  currency?: string
  provider?: string
  paymentRef?: string
  paid?: boolean
  hasCheckout?: boolean
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
      // `hasCheckout` va tal cual (undefined incluido): sin el dato el usecase avisa "Pendiente de pago".
      onBookingCreated: (b: BookingEvent) => swallow('created', b, (d) =>
        notifyReservationReceived(d, { id: b.id, hotelId: b.hotelId }, 'web', { paid: !!b.paid, hasCheckout: b.hasCheckout })),
      onBookingPaid: (b: BookingEvent) => swallow('paid', b, (d) =>
        notifyReservationPaid(d, { id: b.id, hotelId: b.hotelId }, {
          totalAmount: Number(b.totalAmount) || 0,
          currency: b.currency,
          provider: b.provider,
          paymentRef: b.paymentRef,
        })),
    })
  }
}
