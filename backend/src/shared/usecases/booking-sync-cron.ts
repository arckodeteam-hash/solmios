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
 * Cuánto puede pasar sin contacto con el feed antes de gritar. Por debajo de los 30 minutos de la
 * ventana a propósito: la alerta tiene que llegar mientras las reservas TODAVÍA se pueden ackear,
 * no cuando ya se cayeron del feed. Con el tick de 1 minuto son ~25 fallos seguidos, así que un
 * hipo de red no la dispara.
 */
export const STALL_ALERT_MS = 25 * 60_000

/**
 * Crea el cron de sync global de bookings OTA.
 * `_orm` se mantiene en la firma por simetría con night-audit-cron (el usecase ya recibe el orm
 * del service; acá no se necesita). Retorna siempre un BookingSyncResult (nunca throws).
 */
export function createBookingSyncCron(
  _orm: any,
  resolveModule: (name: string) => any,
  logger: Logger,
  opts: { now?: () => number } = {},
): () => Promise<BookingSyncResult> {
  const now = opts.now ?? Date.now
  // Última vez que se pudo HABLAR con el feed. Arranca en el boot: si el cron nunca llega a
  // conectar, la alerta salta igual a los 25 minutos de haber levantado.
  let ultimoContacto = now()
  let yaAvisado = false

  /**
   * Hubo contacto si el feed se pudo leer — aunque después alguna revisión fallara al aplicarse.
   * Esa distinción importa: una revisión rota es un problema puntual y las demás sí se ackearon,
   * mientras que "no pude leer el feed" es el que hace desaparecer reservas en silencio. Mezclarlos
   * llenaría el log de alertas y enseñaría a ignorar la única que importa.
   */
  const huboContacto = (r: BookingSyncResult): boolean => r.success || r.feedSize > 0

  return async (): Promise<BookingSyncResult> => {
    try {
      const canales = resolveModule('canales')
      if (!canales || !canales.syncAllBookingRevisions) {
        logger.warn('booking-sync-cron: módulo canales no disponible')
        return avisarSiEstancado({ ...ZERO_RESULT })
      }
      const result = await canales.syncAllBookingRevisions()
      logger.info('booking-sync-cron completado', result)
      return avisarSiEstancado(result)
    } catch (e: any) {
      logger.warn('booking-sync-cron falló', { error: e?.message || String(e) })
      return avisarSiEstancado({ ...ZERO_RESULT })
    }
  }

  function avisarSiEstancado(result: BookingSyncResult): BookingSyncResult {
    if (huboContacto(result)) {
      ultimoContacto = now()
      yaAvisado = false
      return result
    }
    const sinContactoMs = now() - ultimoContacto
    // Una sola alerta por episodio: repetirla cada minuto la vuelve ruido y esconde el resto del log.
    if (sinContactoMs < STALL_ALERT_MS || yaAvisado) return result
    yaAvisado = true
    logger.error(
      'booking-sync-cron: sin contacto con el feed de Channex — hay reservas en riesgo de perderse',
      {
        minutosSinContacto: Math.round(sinContactoMs / 60_000),
        // El feed sólo re-sirve 30 minutos: pasado eso, la recuperación es por `/bookings`.
        recuperarDesde: new Date(ultimoContacto).toISOString(),
        comoRecuperar: 'POST /api/admin/channex/recover-bookings {"since":"<recuperarDesde>"}',
        ultimoError: result.errors[0],
      },
    )
    return result
  }
}
