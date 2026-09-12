// connectors/reservation-notify-deps.ts — Arma los `ReservationNotifyDeps` del aviso al hotel a
// partir de MÓDULOS (no del orm): un connector no lee tablas ajenas (ver reservas-money.ts).
//
// Antes esta closure vivía dentro de bookingengine-notificaciones.ts; #271 MR-06 la comparte con el
// cron de recordatorio de aprobación (composition-root → shared/usecases/approval-reminder), que
// avisa por las mismas tres vías (campanita, correo al buzón del hotel, push). Comportamiento
// idéntico al original: todo se resuelve EN CADA aviso, no al cablear (mismo criterio que
// canales-notificaciones): si un módulo opcional no está, el aviso sale igual con lo que haya.
//
// El correo no se resuelve acá: el EmailService nace DESPUÉS de `system.start()` y lo inyecta
// `email-bootstrap` en `notificaciones.setHotelEmailDeps` (post-init). Hasta entonces,
// `hotelEmailDeps()` es null y el aviso va sin correo.

import type { Logger } from 'arckode-framework'
import type { ReservationEmailSender, ReservationNotifyDeps } from '../shared/usecases/notify-reservation-received'
import type { NotificacionesPort, PushPort, RoomsPort } from '../shared/usecases/notify-task-assigned'
import { DEFAULT_PLATFORM_IDENTITY, type PlatformIdentity } from '../shared/utils/platform-identity'

interface SystemActor { id: string; role: string; hotelId?: string }

interface NotificacionesModule extends NotificacionesPort {
  hotelEmailDeps?: () => { emailSender: ReservationEmailSender; platformIdentity: () => Promise<PlatformIdentity> } | null
}

/** Misma forma que `ConnectorContext.resolveModule` y `System.resolveModule`. */
export type ResolveModule = <T>(name: string) => T

const SYSTEM: SystemActor = { id: 'system', role: 'super_admin' }

/**
 * Lo que puede faltar sin frenar el aviso: un módulo opcional no registrado en este despliegue
 * (habitaciones, pushtokens, huespedes) o un `getById` que tira NotFound/Auth — para el aviso
 * eso es "no hay dato", no un error.
 */
const quiet = async <T>(run: () => T | Promise<T>): Promise<T | null> => {
  try { return await run() } catch { return null }
}

/**
 * Devuelve `deps(hotelId)`: arma los puertos del aviso con el actor de sistema scoped al hotel.
 * Armar los deps SÍ puede tirar (un módulo núcleo ausente): el llamador lo absorbe.
 */
export function reservationNotifyDepsFactory(
  resolveModule: ResolveModule,
  log: Logger,
): (hotelId: string) => Promise<ReservationNotifyDeps> {
  return async (hotelId: string): Promise<ReservationNotifyDeps> => {
    const actor: SystemActor = { ...SYSTEM, hotelId }
    const notificaciones = resolveModule<NotificacionesModule>('notificaciones')
    const reservas = resolveModule<{
      getById(id: string, user: SystemActor): Promise<any>
      list(query: Record<string, unknown>, user: SystemActor): Promise<{ data: any[] }>
    }>('reservas')
    const hoteles = resolveModule<{ getById(id: string, user: SystemActor): Promise<any> }>('hoteles')
    const huespedes = await quiet(() => resolveModule<{ getById(id: string, user: SystemActor): Promise<any> }>('huespedes'))
    const email = typeof notificaciones.hotelEmailDeps === 'function' ? notificaciones.hotelEmailDeps() : null

    return {
      notificaciones,
      users: resolveModule<{ list(hotelId?: string): Promise<any[]> }>('usuarios'),
      roles: resolveModule<ReservationNotifyDeps['roles']>('roles'),
      reservations: {
        findById: (id) => quiet(() => reservas.getById(id, actor)),
        findMany: async (where) => (await reservas.list({ ...where, limit: 100 }, actor)).data,
      },
      hotels: { findById: (id) => quiet(() => hoteles.getById(id, actor)) },
      guests: huespedes ? { findById: (id) => quiet(() => huespedes.getById(id, actor)) } : null,
      rooms: await quiet(() => resolveModule<RoomsPort>('habitaciones')),
      push: await quiet(() => resolveModule<PushPort>('pushtokens')),
      emailSender: email?.emailSender ?? null,
      platformIdentity: email?.platformIdentity ?? (async () => ({ ...DEFAULT_PLATFORM_IDENTITY })),
      logger: log,
    }
  }
}
