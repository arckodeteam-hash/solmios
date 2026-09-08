// canales/usecases/booking-sync.ts — Ingesta GLOBAL de bookings OTA (cron, issue #564)
//
// Resuelve el bug multi-tenancy: el feed `GET /booking_revisions/feed` de Channex es GLOBAL
// por cuenta de plataforma (prod: 8 propiedades). El path viejo (`channex.ingestBookings` por
// hotel) asignaba TODAS las revisiones a un solo `cfg.hotelId`. Este usecase trae el feed una
// sola vez y deriva cada revisión al hotel correcto vía `revision.propertyId → channel_config
// .channexPropertyId`.
//
// Diseño:
//  - 1 fetch del feed (no N por hotel).
//  - try/catch POR revisión: un fallo no corta el loop.
//  - propertyId sin mapeo → no se procesa NI se ackea (queda para cuando el hotel sincronice).
//  - dedupe (reserva ya existe) → se ackea igual (drena el feed, evita reprocesar).
//  - ack fallido → error contabilizado, pero no relanza (la revisión vuelve a aparecer).
//
// NO toca service/controller/composition-root/cron-factory: otro agente hace el wiring.

import type { ORM, Logger, RepositoryAdapter } from 'arckode-framework'
import type { ChannexUseCase } from './channex'
import type { CanalesQueries } from './canales-queries'
import type { BookingRevisionDTO } from '../types'
import { mapBookingRevision, applyBookingRevision, type ReservationCancelPort } from './booking-ingestion'

/** Resultado de una corrida del sync global de bookings. */
export interface BookingSyncResult {
  success: boolean
  /** Cantidad de revisiones traídas en el feed (hasta 50 por página de Channex). */
  feedSize: number
  /** Reservas nuevas creadas. */
  ingested: number
  /** Revisiones ackeadas en Channex (drenadas del feed). */
  acknowledged: number
  /** Revisiones que ya existían (dedupe por externalLocator) — se ackean igual. */
  skipped: number
  /** Revisiones cuyo propertyId no matchea ningún hotel sincronizado — NO se ackean. */
  unmapped: number
  /** Revisiones de un hotel con la suscripción suspendida — NO se ackean (#542). */
  suspended: number
  /** Mensajes de error por revisión (un fallo no corta el loop). */
  errors: string[]
}

export interface BookingSyncDeps {
  channex: ChannexUseCase
  queries: CanalesQueries
  orm: ORM
  logger: Logger
  /** Repo de sync_log (opcional — si no se inyecta, se omite la fila de auditoría). */
  syncLogRepo?: RepositoryAdapter<any>
}

/** Límite que devuelve el feed de Channex; si se alcanza, el feed sigue saturado. */
const FEED_PAGE_LIMIT = 50

/**
 * Ingesta el feed GLOBAL de bookings de Channex derivando cada revisión a su hotel.
 * Una corrida = 1 fetch + N resoluciones. Idempotente por `externalLocator` (dedupe dentro
 * de `applyBookingRevision`).
 */
export class BookingSyncUseCase {
  /** Cableado por `connectors/canales-subscriptions.ts` (#542) — ausente = no bloquea nada. */
  private subscriptionCheck?: (hotelId: string) => Promise<{ allowed: boolean }>

  /**
   * Cableado por `connectors/canales-reservas.ts`. Sin él, una cancelación que llega de una OTA
   * no se puede aplicar: se contabiliza como error y la revisión NO se ackea (vuelve en el
   * próximo tick). Es a propósito — antes se hacía `orm.update({status:'cancelled'})` acá mismo,
   * que dejaba el depósito retenido colgado para siempre.
   */
  private cancelPort?: ReservationCancelPort

  constructor(private readonly deps: BookingSyncDeps) {}

  setSubscriptionCheck(fn: (hotelId: string) => Promise<{ allowed: boolean }>): void {
    this.subscriptionCheck = fn
  }

  setCancelPort(fn: ReservationCancelPort): void {
    this.cancelPort = fn
  }

  /** Puerto de cancelación con fallo explícito si nadie lo cableó (nunca "cancela a medias"). */
  private cancelReservation: ReservationCancelPort = async (id, hotelId, reason) => {
    if (!this.cancelPort) return { ok: false, error: 'canales: cancelPort no cableado (connectors/canales-reservas.ts)' }
    return this.cancelPort(id, hotelId, reason)
  }

  async run(): Promise<BookingSyncResult> {
    const { channex, orm, logger } = this.deps
    const result: BookingSyncResult = {
      success: true, feedSize: 0, ingested: 0, acknowledged: 0,
      skipped: 0, unmapped: 0, suspended: 0, errors: [],
    }

    // 1. Mapa channexPropertyId → hotelId: una fila por hotel con sync habilitado.
    const propMap = await this.buildPropertyMap()

    // 2. Feed global una sola vez (key vacía → channexReq usa la credencial de plataforma).
    let feed: BookingRevisionDTO[]
    try {
      feed = await channex.fetchBookingFeed('')
    } catch (e: any) {
      result.success = false
      result.errors.push(`feed: ${e?.message || String(e)}`)
      await this.logSync(result)
      return result
    }
    result.feedSize = feed.length

    if (feed.length === 0) {
      await this.logSync(result)
      return result
    }

    // 3. Por cada revisión, try/catch aislado.
    for (const rev of feed) {
      try {
        await this.processRevision(rev, propMap, result)
      } catch (e: any) {
        result.errors.push(`${rev.uniqueId}: ${e?.message || String(e)}`)
      }
    }

    // 5. Feed saturado: avisa que quedan pendientes para el próximo tick.
    if (result.feedSize >= FEED_PAGE_LIMIT) {
      logger.info('booking-sync: feed saturado (50 revisiones) — quedan pendientes para el próximo tick')
    }

    result.success = result.errors.length === 0
    await this.logSync(result)
    return result
  }

  /**
   * Ingesta UNA revisión puntual, disparada por el webhook de Channex (CH-07).
   *
   * Corre el MISMO `processRevision` que el cron: por eso la reserva que entra por webhook es
   * idéntica a la que habría entrado por el feed, hereda el dedupe por `externalLocator` y
   * respeta el mismo orden apply → ack (nunca se ackea algo que no se pudo aplicar).
   *
   * Si el GET falla o la revisión no existe, NO se ackea nada: la revisión sigue en el feed y
   * el cron de 15 minutos la recupera. El webhook es un atajo de latencia, no la única vía.
   */
  async runOne(revisionId: string): Promise<BookingSyncResult> {
    const { channex, logger } = this.deps
    const result: BookingSyncResult = {
      success: true, feedSize: 0, ingested: 0, acknowledged: 0,
      skipped: 0, unmapped: 0, suspended: 0, errors: [],
    }

    const propMap = await this.buildPropertyMap()

    // GET puntual (key vacía → credencial de plataforma, igual que el feed del cron).
    // Un fallo acá corta la corrida SIN ackear: la revisión sigue en el feed para el cron.
    let rev: BookingRevisionDTO | null = null
    let error = 'no encontrada'
    try {
      rev = await channex.fetchBookingRevision('', revisionId)
    } catch (e: any) {
      error = e?.message || String(e)
    }
    if (!rev) {
      logger.error('booking-sync: no se pudo traer la revisión del webhook', { revisionId, error })
      result.success = false
      result.errors.push(`revision ${revisionId}: ${error}`)
      return result
    }

    result.feedSize = 1
    try {
      await this.processRevision(rev, propMap, result)
    } catch (e: any) {
      result.errors.push(`${rev.uniqueId}: ${e?.message || String(e)}`)
    }

    result.success = result.errors.length === 0
    // Sin `logSync`: `sync_log` audita corridas del cron, no callbacks sueltos del webhook.
    return result
  }

  /**
   * Procesa UNA revisión: resuelve el hotel, chequea la suscripción, aplica y recién ahí ackea.
   * Compartido por el cron (`run`) y por el webhook (`runOne`) — que sea el mismo cuerpo es lo
   * que garantiza que ambos caminos produzcan exactamente la misma reserva.
   * No atrapa nada: el try/catch por revisión vive en el caller.
   */
  private async processRevision(rev: BookingRevisionDTO, propMap: Map<string, string>, result: BookingSyncResult): Promise<void> {
    const { channex, orm, logger } = this.deps

    const hotelId = propMap.get(rev.propertyId)
    if (!hotelId) {
      // Sin mapeo: no se procesa NI se ackea — la revisión queda para cuando el hotel sincronice.
      result.unmapped++
      logger.warn('booking-sync: propertyId sin hotel mapeado', { propertyId: rev.propertyId, revisionId: rev.id })
      return
    }

    // #542: hotel con la suscripción suspendida → no debe seguir recibiendo reservas
    // nuevas por Channel Manager. NO se ackea: la revisión queda en el feed y se reintenta
    // en el próximo tick (si el hotel se reactiva, se ingesta normalmente).
    if (this.subscriptionCheck) {
      const access = await this.subscriptionCheck(hotelId)
      if (!access.allowed) {
        result.suspended++
        logger.warn('booking-sync: hotel con suscripción suspendida, revisión no ingresada', { hotelId, revisionId: rev.id })
        return
      }
    }

    const dto = mapBookingRevision(rev, hotelId)
    const applied = await applyBookingRevision({ orm, channex, hotelId, apiKey: '', cancelReservation: this.cancelReservation, logger }, dto)
    if (applied.created) result.ingested++
    else result.skipped++

    // Ack siempre (incluso dedupe): drena el feed para que no vuelva a aparecer.
    const acked = await channex.ackBooking('', rev.id)
    if (acked) result.acknowledged++
    else result.errors.push(`No se pudo ack booking ${rev.uniqueId}`)
  }

  /** Construye el mapa channexPropertyId → hotelId desde las configs con sync habilitado. */
  private async buildPropertyMap(): Promise<Map<string, string>> {
    const { orm } = this.deps
    const configs = (await orm.findMany('Canales', { syncEnabled: 1 })) as any[]
    const map = new Map<string, string>()
    for (const c of configs || []) {
      if (c.channexPropertyId) map.set(c.channexPropertyId, c.hotelId)
    }
    return map
  }

  /** Fila agregada en sync_log (guard `if syncLogRepo`). Molde: service.ingestBookings:137-144. */
  private async logSync(result: BookingSyncResult): Promise<void> {
    if (!this.deps.syncLogRepo) return
    try {
      await this.deps.syncLogRepo.create({
        id: crypto.randomUUID(),
        hotelId: 'platform',   // cron global: abarca múltiples hoteles
        channel: 'channex',
        action: 'ingest_bookings_cron',
        status: result.success ? 'success' : 'error',
        details: {
          feedSize: result.feedSize,
          ingested: result.ingested,
          acknowledged: result.acknowledged,
          skipped: result.skipped,
          unmapped: result.unmapped,
          suspended: result.suspended,
          errors: result.errors,
        },
        createdAt: new Date().toISOString(),
      })
    } catch { /* el log de auditoría no debe romper el cron */ }
  }
}
