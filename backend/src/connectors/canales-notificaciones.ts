// connectors/canales-notificaciones.ts — Wire: canales → notificaciones
//
// Cablea DOS avisos que salen de `canales`:
//  1. Un pedido de conexión de OTA tiene que aparecer en la campanita del super-admin
//     (`setChannelRequestNotifyPorts`; la lógica vive en `shared/usecases/notify-channel-request`).
//  2. Una reserva OTA recién ingresada (#246, socket `onOtaBookingIngested`) tiene que enterarle al
//     hotel: campanita a quien puede ver reservas, correo al buzón del hotel y push (la lógica vive
//     en `shared/usecases/notify-reservation-received`, origen 'ota').
//
// `canales` no puede importar `notificaciones` (regla: un módulo no importa a otro), así que los
// puertos se inyectan desde acá. `resolveModule` se llama en cada aviso y no una sola vez al
// cablear: si un módulo no está disponible en ese momento, el pedido/la reserva igual se registra
// (el aviso es best-effort por diseño).

import type { ConnectorContext, Logger } from 'arckode-framework'
import type { ChannelRequestNotificationPort } from '../shared/usecases/notify-channel-request'
import {
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

/** Lo que trae el socket `onOtaBookingIngested` (ver canales/sockets.ts). */
interface OtaBookingIngested { hotelId: string; reservationId: string; ota: string }

interface CanalesModule {
  setChannelRequestNotifyPorts: (p: { notificaciones?: ChannelRequestNotificationPort }) => void
  setSockets: (s: { onOtaBookingIngested?: (d: OtaBookingIngested) => Promise<void> }) => void
}

const SYSTEM: SystemActor = { id: 'system', role: 'super_admin' }

type NotifyLogger = Pick<Logger, 'warn'>

/** Firma histórica (`system.addConnector('canales-notificaciones', canalesNotificacionesConnector)`): sin logger. */
export function canalesNotificacionesConnector(ctx: ConnectorContext): void {
  wireCanalesNotificaciones(ctx)
}

/** El mismo cableado con logger propio para dejar rastro de los avisos que no salen. */
export function canalesNotificacionesConnectorWithLogger(logger: Logger): (ctx: ConnectorContext) => void {
  const log = logger.child('canales-notificaciones')
  return (ctx: ConnectorContext) => wireCanalesNotificaciones(ctx, log)
}

function wireCanalesNotificaciones(ctx: ConnectorContext, log?: NotifyLogger): void {
  const canales = ctx.resolveModule<CanalesModule>('canales')

  canales.setChannelRequestNotifyPorts({
    notificaciones: {
      create: (dto, user) => ctx.resolveModule<ChannelRequestNotificationPort>('notificaciones').create(dto, user),
    },
  })

  // ── #246: reserva OTA ingresada → aviso al hotel ──────────────────────────────────────────
  // Espejo de bookingengine-notificaciones.ts (mismo armado de deps por MÓDULOS, no por orm: un
  // connector no lee tablas ajenas). El correo lo inyecta `email-bootstrap` post-init en
  // `notificaciones.setHotelEmailDeps`; hasta entonces `hotelEmailDeps()` es null y va sin correo.

  /** Un módulo opcional ausente o un `getById` que tira: para el aviso es "no hay dato". */
  const quiet = <T>(run: () => T | Promise<T>): Promise<T | null> =>
    (async () => run())().then((v) => v, () => null)

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
      // Puede no haber logger (firma histórica): el usecase resuelve igual sin él.
      logger: log,
    }
  }

  canales.setSockets({
    /**
     * El usecase no tira, pero armar los deps sí puede (un módulo núcleo ausente). Un fallo del
     * aviso NUNCA frena la ingesta ni el ack de la revisión: se traga acá.
     */
    onOtaBookingIngested: async (d: OtaBookingIngested) => {
      try {
        await notifyReservationReceived(await deps(d?.hotelId), { id: d.reservationId, hotelId: d.hotelId, ota: d.ota }, 'ota')
      } catch (e) {
        log?.warn('No se pudo avisar la reserva OTA al hotel', {
          reservationId: d?.reservationId, hotelId: d?.hotelId, ota: d?.ota, error: (e as Error).message,
        })
      }
    },
  })
}
