// shared/usecases/booking-sync-cron.ts — Cron de ingesta GLOBAL de bookings OTA (issue #564).
//
// Mismo molde que night-audit-cron: factory + resolveModule + catch externo que NO propaga
// (un cron no debe tirar el server). El feed de Channex es por cuenta de plataforma (no por
// hotel); el usecase del módulo canales deriva cada revisión a su hotel vía propertyId.
//
// Sin creds de Channex → fetchBookingFeed falla → el usecase retorna errors + success=false,
// pero NO rompe: el cron loguea y sigue. En el próximo tick, si ya hay creds, reintenta.

import type { Logger } from 'arckode-framework'
import type { BookingSyncResult } from '../../modules/canales/usecases/booking-sync'

/**
 * Tick por defecto: 60 s. Configurable vía env BOOKING_SYNC_INTERVAL_MS.
 *
 * Por qué 1 min y no 15: el feed `GET /booking_revisions/feed` de Channex es una ventana de
 * 30 minutos, no una cola durable — una revisión que no se ackea dentro de esos 30 min se cae
 * del feed para siempre. Hoy la ingesta es feed-only (todavía no hay webhook), así que con
 * 15 min quedaban apenas 2 ciclos de margen: un deploy o un reinicio podía perder una reserva
 * sin dejar rastro.
 *
 * Los 15 min son el valor correcto SÓLO con el webhook como camino principal y el feed como
 * red de contención: al cerrar #50 esto se revierte a `60_000 * 15`.
 *
 * Costo nulo: el feed no cuenta contra el rate limit de ARI (~20/min, que aplica a
 * POST /availability y /restrictions) y es 1 request por tick, no 1 por hotel.
 */
export const DEFAULT_BOOKING_SYNC_TICK_MS = 60_000

const ZERO_RESULT: BookingSyncResult = {
  success: false, feedSize: 0, ingested: 0, acknowledged: 0,
  skipped: 0, unmapped: 0, suspended: 0, errors: [],
}

/**
 * Crea el cron de sync global de bookings OTA.
 * `_orm` se mantiene en la firma por simetría con night-audit-cron (el usecase ya recibe el orm
 * del service; acá no se necesita). Retorna siempre un BookingSyncResult (nunca throws).
 */
export function createBookingSyncCron(
  _orm: any,
  resolveModule: (name: string) => any,
  logger: Logger,
): () => Promise<BookingSyncResult> {
  return async (): Promise<BookingSyncResult> => {
    try {
      const canales = resolveModule('canales')
      if (!canales || !canales.syncAllBookingRevisions) {
        logger.warn('booking-sync-cron: módulo canales no disponible')
        return { ...ZERO_RESULT }
      }
      const result = await canales.syncAllBookingRevisions()
      logger.info('booking-sync-cron completado', result)
      return result
    } catch (e: any) {
      logger.warn('booking-sync-cron falló', { error: e?.message || String(e) })
      return { ...ZERO_RESULT }
    }
  }
}
