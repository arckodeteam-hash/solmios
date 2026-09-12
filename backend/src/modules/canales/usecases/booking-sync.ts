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
import { mapBookingRevision, applyBookingRevision, type ReservationCancelPort, type BookingIngestDeps } from './booking-ingestion'

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

/** Límite que devuelve el feed de Channex; si se alcanza, quedan revisiones esperando. */
const FEED_PAGE_LIMIT = 50

/**
 * Tope de vueltas al feed por corrida: 20 × 50 = 1000 revisiones. Existe para que una corrida no
 * se quede girando indefinidamente y monopolice el proceso — lo que sobre lo levanta el tick
 * siguiente, que con el cron de 1 minuto llega mucho antes de los 30 de la ventana.
 */
const MAX_FEED_ROUNDS = 20

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

  /**
   * #246 — Cableado por el service (`CanalesService`) sobre su socket `onOtaBookingIngested`. Sin
   * él, la ingesta sigue igual: el aviso al hotel es best-effort.
   */
  private ingestedPort?: BookingIngestDeps['onIngested']

  constructor(private readonly deps: BookingSyncDeps) {}

  setSubscriptionCheck(fn: (hotelId: string) => Promise<{ allowed: boolean }>): void {
    this.subscriptionCheck = fn
  }

  setCancelPort(fn: ReservationCancelPort): void {
    this.cancelPort = fn
  }

  setIngestedPort(fn: NonNullable<BookingIngestDeps['onIngested']>): void {
    this.ingestedPort = fn
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

    // 2. Feed global, DRENADO HASTA VACIARLO (key vacía → channexReq usa la credencial de
    //    plataforma). El feed no es una cola durable: devuelve lo no ackeado dentro de una ventana
    //    de 30 minutos y después la revisión desaparece para siempre. Devuelve hasta
    //    FEED_PAGE_LIMIT por llamada, así que quedarse con una página y esperar al próximo tick
    //    ponía un techo de 50 reservas por corrida: una tanda grande (un canal reconectando y
    //    volcando su backlog) empujaba las últimas contra el corte de los 30 minutos.
    //    No se pagina por offset: al ackear, esas revisiones salen del feed y la llamada
    //    siguiente trae las que siguen.
    for (let vuelta = 0; vuelta < MAX_FEED_ROUNDS; vuelta++) {
      let feed: BookingRevisionDTO[]
      try {
        feed = await channex.fetchBookingFeed('')
      } catch (e: any) {
        result.success = false
        result.errors.push(`feed: ${e?.message || String(e)}`)
        await this.logSync(result)
        return result
      }
      if (feed.length === 0) break
      result.feedSize += feed.length

      // 3. Por cada revisión, try/catch aislado.
      const ackeadasAntes = result.acknowledged
      for (const rev of feed) {
        try {
          await this.processRevision(rev, propMap, result)
        } catch (e: any) {
          result.errors.push(`${rev.uniqueId}: ${e?.message || String(e)}`)
        }
      }

      if (feed.length < FEED_PAGE_LIMIT) break // el feed se vació

      // Freno de seguridad: una página llena en la que no se ackeó NADA devuelve exactamente las
      // mismas revisiones en la vuelta siguiente (pasa cuando todas son de una property sin
      // mapeo, que a propósito no se ackea). Sin esto el drenado giraría para siempre.
      if (result.acknowledged === ackeadasAntes) {
        logger.warn('booking-sync: el feed no avanza — página llena sin ninguna revisión ackeada', {
          feedSize: result.feedSize, unmapped: result.unmapped, suspended: result.suspended,
        })
        break
      }

      if (vuelta === MAX_FEED_ROUNDS - 1) {
        logger.warn('booking-sync: tope de vueltas alcanzado, quedan revisiones para el próximo tick', {
          procesadas: result.feedSize,
        })
      }
    }

    if (result.feedSize === 0) {
      await this.logSync(result)
      return result
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
      await this.logSync(result, 'ingest_booking_webhook', { revisionId })
      return result
    }

    result.feedSize = 1
    try {
      await this.processRevision(rev, propMap, result)
    } catch (e: any) {
      result.errors.push(`${rev.uniqueId}: ${e?.message || String(e)}`)
    }

    result.success = result.errors.length === 0
    // Deja fila: el webhook es el camino PRINCIPAL de las reservas desde que se registró el
    // callback, y una reserva que entra (o falla) por acá no puede ser invisible en el panel.
    await this.logSync(result, 'ingest_booking_webhook', { revisionId })
    return result
  }

  /**
   * Recupera las reservas que el feed ya no puede entregar, a partir de `sinceIso`.
   *
   * Cuándo se usa: DESPUÉS de una caída de más de 30 minutos (deploy largo, server abajo, poller
   * trabado). Pasado ese rato la revisión desaparece del feed y no vuelve nunca — el huésped
   * tiene su confirmación de la OTA y en el PMS no hay nada. `GET /bookings` no caduca, así que
   * es la única red que queda.
   *
   * Es MANUAL y acotada por fecha a propósito: como cron periódico re-traería los mismos bookings
   * indefinidamente, caro de los dos lados y sin ningún beneficio mientras el poller está sano.
   * Se apoya en el mismo `processRevision` que el cron y el webhook, así que hereda el dedupe por
   * `externalLocator`: pedir un rango de más no duplica nada.
   */
  async recoverSince(sinceIso: string): Promise<BookingSyncResult> {
    const { channex, logger } = this.deps
    const result: BookingSyncResult = {
      success: true, feedSize: 0, ingested: 0, acknowledged: 0,
      skipped: 0, unmapped: 0, suspended: 0, errors: [],
    }

    const propMap = await this.buildPropertyMap()

    let bookings: BookingRevisionDTO[]
    try {
      bookings = await channex.fetchBookingsSince('', sinceIso)
    } catch (e: any) {
      result.success = false
      result.errors.push(`bookings desde ${sinceIso}: ${e?.message || String(e)}`)
      await this.logSync(result, 'recover_bookings', { desde: sinceIso })
      return result
    }
    result.feedSize = bookings.length

    for (const rev of bookings) {
      try {
        await this.processRevision(rev, propMap, result, { ack: false })
      } catch (e: any) {
        result.errors.push(`${rev.uniqueId}: ${e?.message || String(e)}`)
      }
    }

    result.success = result.errors.length === 0
    logger.info('booking-sync: recuperación manual completada', {
      desde: sinceIso, encontradas: result.feedSize, creadas: result.ingested,
      yaExistian: result.skipped, sinMapeo: result.unmapped, errores: result.errors.length,
    })
    // La fila con el `desde` es lo único que después permite reconstruir qué ventana se rescató.
    await this.logSync(result, 'recover_bookings', { desde: sinceIso })
    return result
  }

  /**
   * Procesa UNA revisión: resuelve el hotel, chequea la suscripción, aplica y recién ahí ackea.
   * Compartido por el cron (`run`) y por el webhook (`runOne`) — que sea el mismo cuerpo es lo
   * que garantiza que ambos caminos produzcan exactamente la misma reserva.
   * No atrapa nada: el try/catch por revisión vive en el caller.
   */
  private async processRevision(
    rev: BookingRevisionDTO,
    propMap: Map<string, string>,
    result: BookingSyncResult,
    opciones: { ack?: boolean } = {},
  ): Promise<void> {
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
    const applied = await applyBookingRevision({
      orm, channex, hotelId, apiKey: '', cancelReservation: this.cancelReservation, logger, onIngested: this.ingestedPort,
    }, dto)
    if (applied.created) result.ingested++
    else result.skipped++

    // Ack siempre (incluso dedupe): drena el feed para que no vuelva a aparecer. La recuperación
    // (`recoverSince`) lo apaga: sus bookings NO salen del feed —su revisión ya expiró, que es
    // justo el motivo por el que hubo que recuperarlos— así que el ack sólo sumaría un fallo.
    if (opciones.ack === false) return
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

  /**
   * Fila agregada en sync_log (guard `if syncLogRepo`). Molde: service.ingestBookings:137-144.
   *
   * `action` distingue la VÍA (cron, webhook, rescate) porque las tres terminan en la misma tabla
   * y es lo que se ve en el Historial de Sincronización del panel. Cuando algo sale mal, saber por
   * dónde entró —o por dónde NO entró— es la mitad del diagnóstico; el resto está en `journalctl`,
   * que se rota y que nadie mira.
   */
  private async logSync(result: BookingSyncResult, action = 'ingest_bookings_cron', extra: Record<string, unknown> = {}): Promise<void> {
    if (!this.deps.syncLogRepo) return
    try {
      await this.deps.syncLogRepo.create({
        id: crypto.randomUUID(),
        hotelId: 'platform',   // feed y bookings son de CUENTA: una corrida abarca varios hoteles
        channel: 'channex',
        action,
        status: result.success ? 'success' : 'error',
        details: {
          feedSize: result.feedSize,
          ingested: result.ingested,
          acknowledged: result.acknowledged,
          skipped: result.skipped,
          unmapped: result.unmapped,
          suspended: result.suspended,
          errors: result.errors,
          ...extra,
        },
        createdAt: new Date().toISOString(),
      })
    } catch { /* el log de auditoría no debe romper el cron */ }
  }
}
