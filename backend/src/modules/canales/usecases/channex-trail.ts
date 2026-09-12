// canales/usecases/channex-trail.ts — Todo lo que pasa con Channex queda escrito en `sync_log` (#347).
//
// Hasta acá el Historial solo tenía lo que SALIÓ BIEN (cada push con sus task ids) y lo que
// entró por Open Channel. Lo que no se veía era justo lo que hace falta cuando algo no cierra:
// que un push quedó esperando por el rate limit, que Channex devolvió 429 o 5xx, que se reintentó
// o se agotaron los reintentos, que el webhook llegó y qué se hizo con él. Todo eso vivía en el
// journal del server, que se rota y que nadie mira desde el panel.
//
// Archivo PURO: recibe el repo y la resolución property → hotel por parámetro. Las filas van al
// hotel dueño de la property cuando se puede saber (los ARI updates llevan `property_id` en el
// body) y a `platform` cuando no (un 401 del webhook, un error de red antes de saber nada).

import type { ChannexHttpEvent } from './channex-http'

/** Fila de cuenta, igual que las del cron de reservas (`booking-sync.ts`). */
export const PLATFORM_HOTEL_ID = 'platform'

export interface ChannexTrailRepo {
  create(row: Record<string, unknown>): Promise<unknown>
}

export interface ChannexTrailDeps {
  syncLogRepo: ChannexTrailRepo
  /** `property_id` de Channex → `hotelId` del PMS, o null si nadie la tiene. */
  resolveHotel: (propertyId: string) => Promise<string | null>
  logger?: { warn: (m: string, c?: any) => void }
  now?: () => string
}

export interface ChannexTrailRow {
  hotelId: string
  action: string
  status: 'success' | 'warning' | 'error'
  details: Record<string, unknown>
}

const ENDPOINT_LABEL: Record<string, string> = { availability: 'disponibilidad', restrictions: 'tarifas/restricciones' }

/** Path sin host ni query, para el detalle: `/api/v1/availability`. */
const pathOf = (url: string): string => {
  try { return new URL(url).pathname } catch { return String(url).split('?')[0] ?? url }
}

/** El "por qué" de una espera, en palabras del operador. */
const THROTTLE_REASON: Record<'global' | 'property' | 'paused', string> = {
  global: 'ventana global llena (todas las properties)',
  property: 'ventana de esta property llena (10/min por endpoint en Channex)',
  paused: 'property en pausa de 60 s por un 429 anterior',
}

/**
 * Traduce un evento del transporte a la fila que se guarda. Es lo único que decide QUÉ se
 * registra: las respuestas OK no pasan por acá porque cada push ya escribe la suya con task ids.
 */
export function describeHttpEvent(event: ChannexHttpEvent): Omit<ChannexTrailRow, 'hotelId'> {
  const endpoint = event.endpoint ? ENDPOINT_LABEL[event.endpoint] ?? event.endpoint : null
  const base = { endpoint, path: pathOf(event.url), propertyIds: event.propertyIds }
  switch (event.type) {
    case 'throttled':
      return {
        action: 'channex_throttled',
        status: 'warning',
        details: { ...base, waitMs: event.waitMs, waitSec: Math.round(event.waitMs / 100) / 10, reason: THROTTLE_REASON[event.reason] },
      }
    case 'rate_limited':
      return {
        action: event.willRetry ? 'channex_rate_limited' : 'channex_retry_exhausted',
        status: event.willRetry ? 'warning' : 'error',
        details: { ...base, httpStatus: 429, attempt: event.attempt + 1, retryAfter: event.retryAfter, backoffMs: event.backoffMs, willRetry: event.willRetry, propertyPausedSec: event.endpoint ? 60 : null },
      }
    case 'server_error':
      return {
        action: event.willRetry ? 'channex_server_error' : 'channex_retry_exhausted',
        status: event.willRetry ? 'warning' : 'error',
        details: { ...base, httpStatus: event.status, attempt: event.attempt + 1, backoffMs: event.backoffMs, willRetry: event.willRetry },
      }
    case 'network_error':
      return {
        action: event.willRetry ? 'channex_network_error' : 'channex_retry_exhausted',
        status: event.willRetry ? 'warning' : 'error',
        details: { ...base, attempt: event.attempt + 1, backoffMs: event.backoffMs, willRetry: event.willRetry, error: event.error },
      }
    case 'client_error':
      return {
        action: 'channex_rejected',
        status: 'error',
        details: { ...base, httpStatus: event.status, error: resumirBody(event.body) },
      }
  }
}

/** El cuerpo de un 4xx de Channex, acotado: `errors.details` si viene, si no el JSON recortado. */
function resumirBody(body: unknown): string {
  if (body === null || body === undefined) return ''
  if (typeof body === 'string') return body.slice(0, 300)
  const errors = (body as any)?.errors
  const details = errors?.details ?? errors?.title ?? errors
  const txt = typeof details === 'string' ? details : JSON.stringify(details ?? body)
  return String(txt).slice(0, 300)
}

/**
 * El escucha que se cablea al transporte. Resuelve el hotel por la PRIMERA property del body
 * (un push nuestro siempre es de un solo hotel) y nunca lanza: registrar no puede frenar un push.
 */
export function createChannexTrail(deps: ChannexTrailDeps) {
  const now = deps.now ?? (() => new Date().toISOString())

  async function write(row: ChannexTrailRow): Promise<void> {
    try {
      await deps.syncLogRepo.create({
        id: crypto.randomUUID(),
        hotelId: row.hotelId,
        channel: 'channex',
        action: row.action,
        status: row.status,
        details: row.details,
        createdAt: now(),
      })
    } catch (e: any) {
      deps.logger?.warn('channex-trail: no se pudo escribir en sync_log', { action: row.action, error: e?.message || String(e) })
    }
  }

  async function hotelDe(propertyIds: string[]): Promise<string> {
    const pid = propertyIds[0]
    if (!pid) return PLATFORM_HOTEL_ID
    try { return (await deps.resolveHotel(pid)) || PLATFORM_HOTEL_ID } catch { return PLATFORM_HOTEL_ID }
  }

  /** Para `setChannexHttpEventSink`: síncrono hacia afuera, la escritura sigue sola. */
  function onHttpEvent(event: ChannexHttpEvent): void {
    const desc = describeHttpEvent(event)
    void hotelDe(event.propertyIds).then((hotelId) => write({ hotelId, ...desc }))
  }

  /** Lo que hizo el receptor del webhook con cada callback (#342 hizo ver que no quedaba rastro). */
  async function logWebhook(input: {
    outcome: 'ingested' | 'ingest_failed' | 'feed_fallback' | 'rejected' | 'no_payload' | 'own_event'
    propertyId?: string | null
    revisionId?: string | null
    event?: string | null
    detail?: Record<string, unknown>
  }): Promise<void> {
    const hotelId = input.propertyId ? await hotelDe([input.propertyId]) : PLATFORM_HOTEL_ID
    const status: ChannexTrailRow['status'] =
      input.outcome === 'ingested' || input.outcome === 'own_event' ? 'success'
      : input.outcome === 'feed_fallback' ? 'warning'
      : 'error'
    await write({
      hotelId,
      action: `webhook_${input.outcome}`,
      status,
      details: { event: input.event ?? null, revisionId: input.revisionId ?? null, propertyId: input.propertyId ?? null, ...(input.detail ?? {}) },
    })
  }

  return { onHttpEvent, logWebhook, write }
}

/**
 * Resolución property → hotel con caché corta. `Canales` es la config por hotel
 * (`channexPropertyId`); la consulta es por igualdad, que es lo único que el ORM sabe hacer.
 */
export function createPropertyResolver(
  findMany: (model: string, q: Record<string, unknown>) => Promise<any[]>,
  ttlMs = 5 * 60_000,
  now: () => number = Date.now,
): (propertyId: string) => Promise<string | null> {
  const cache = new Map<string, { hotelId: string | null; at: number }>()
  return async (propertyId: string) => {
    const hit = cache.get(propertyId)
    if (hit && now() - hit.at < ttlMs) return hit.hotelId
    const rows = await findMany('Canales', { channexPropertyId: propertyId })
    const hotelId = rows?.[0]?.hotelId ? String(rows[0].hotelId) : null
    cache.set(propertyId, { hotelId, at: now() })
    return hotelId
  }
}
