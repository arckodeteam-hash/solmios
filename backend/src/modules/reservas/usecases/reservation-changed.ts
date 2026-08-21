// reservas/usecases/reservation-changed.ts — Efectos de un cambio de reserva hecho FUERA del CRUD.
//
// Hallazgo COR-1 (2026-08-19): alta/baja de un extra recalculaban y persistían
// `reservations.pendingAmount` (`syncReservationPending`) pero no tocaban la caché del listado
// (`usecases/cache.ts`, TTL 300s) ni emitían `onReservasUpdated`. Resultado: cargabas un extra y
// `GET /api/reservas` seguía devolviendo el saldo viejo hasta CINCO MINUTOS — exactamente la
// divergencia listado-vs-detalle que `shared/usecases/sync-reservation-pending.ts` dice cerrar.
//
// El CRUD ya lo hace dentro de `updateReservation` (socket + invalidación). Todo camino de escritura
// que NO pase por ahí (extras, y cualquiera que se sume) tiene que llamar a este notificador.
// Vive en su propio archivo, y no inline en el service, para que el test lo ejerza TAL CUAL corre en
// producción: la invalidación real sobre una caché real, no un doble.

import type { CacheAdapter, Logger } from 'arckode-framework'
import type { ReservasSockets } from '../sockets'
import { safeEmit } from './safe-emit'
import { invalidateReservasCaches } from './cache'

export interface ReservationChangedDeps {
  logger: Logger
  cache: CacheAdapter
  sockets: ReservasSockets
}

/** Notifica un cambio de reserva: emite el socket y bumpea la versión de la caché del listado. */
export type ReservationChangedNotifier = (reservation: Record<string, any> | null | undefined) => Promise<void>

export function reservationChangedNotifier(deps: ReservationChangedDeps): ReservationChangedNotifier {
  return async (reservation) => {
    if (!reservation) return
    await safeEmit(deps.logger, 'onReservasUpdated', deps.sockets.onReservasUpdated, reservation)
    await invalidateReservasCaches(deps.cache, reservation.hotelId)
  }
}
