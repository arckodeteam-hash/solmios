// ari-outbox/usecases/outbox-admin.ts — Operación de la cola de Channex desde el Super Admin:
// contadores por estado, reintento manual de una fila y la config (reintentos y peticiones por
// minuto) persistida en `Configuration`.
//
// Todo lo de acá es puro o habla por un puerto chico: nada de HTTP. El service arma los puertos
// sobre el store y estas funciones solo deciden. Así el contrato se prueba con arrays en memoria
// (tests/outbox-admin.test.ts) sin levantar base ni servidor.

import type { AriOutboxRow, AriOutboxStatus } from '../types'

/** Fila de `Configuration` donde vive la config de la cola, a nivel plataforma (hotelId 'platform'). */
export const QUEUE_CONFIG_KEY = 'channex_queue_config'
const CONFIG_MODEL = 'Configuration'
const CONFIG_SCOPE = 'platform'

/**
 * Los valores que hoy están hardcodeados en el código: `maxAttempts: 3` al encolar una ráfaga
 * (outbox-queue.ts › enqueue) y `maxPerMinute: 18` del rate limit contra Channex
 * (canales/usecases/channex-http.ts › createChannexHttp). Son los defaults justamente para que
 * guardar config sea opcional: sin fila en la tabla, la cola se comporta igual que antes.
 */
export const QUEUE_CONFIG_DEFAULTS = { maxAttempts: 3, maxPerMinute: 18 } as const

export interface QueueConfig {
  /** Cuántos intentos tiene una fila antes de quedar `failed`. Entre 1 y 10. */
  maxAttempts: number
  /** Techo de peticiones por minuto contra Channex. Entre 1 y 60. */
  maxPerMinute: number
}

/**
 * Cómo se compone el total, que es lo que más se lee mal:
 *
 *   total = pending + retrying + processing + sent + failed
 *
 * `retrying` NO es un estado de la tabla: es una fila `pending` que YA falló alguna vez
 * (`attempts > 0`) y está esperando su próximo turno. Por eso `pending` acá cuenta solo las que
 * nunca fallaron (`attempts === 0`): las dos juntas son el total de filas `pending` de la base.
 */
export interface OutboxCounts {
  pending: number
  processing: number
  sent: number
  failed: number
  retrying: number
  total: number
}

/** Filtros opcionales de la vista: se mezclan en TODAS las consultas para que los counts cierren. */
export interface OutboxCountFilters {
  hotelId?: string
  kind?: string
}

/** Lo mínimo que necesita `contarPorEstado`: contar por status y leer las pending para partirlas. */
export interface OutboxCountPort {
  count(filters: Record<string, unknown>): Promise<number>
  findMany(filters: Record<string, unknown>): Promise<AriOutboxRow[]>
}

/** Lo mínimo que necesita `reintentar`: buscar la fila por id y escribirle el reseteo. */
export interface OutboxRetryPort {
  findMany(filters: Record<string, unknown>): Promise<AriOutboxRow[]>
  update(id: string, patch: Partial<AriOutboxRow>): Promise<AriOutboxRow | null>
}

/** Los filtros de la vista + el status pedido, en un solo objeto para el ORM. */
function conFiltros(status: AriOutboxStatus, filtros?: OutboxCountFilters): Record<string, unknown> {
  const where: Record<string, unknown> = { status }
  if (filtros?.hotelId) where.hotelId = filtros.hotelId
  if (filtros?.kind) where.kind = filtros.kind
  return where
}

/**
 * Contadores del monitor. Los tres estados cerrados se cuentan con `count` (una consulta cada uno),
 * y las `pending` se traen enteras porque hay que partirlas en memoria: los filtros del ORM son de
 * igualdad pura, no existe `attempts > 0`, así que "en reintento" no se puede pedir por SQL.
 *
 * Las cuatro consultas salen en un solo `Promise.all` a propósito: un `await` adentro de un `for`
 * es lo que el linter (`arckode analyze`) marca como N_PLUS_ONE_RISK, y además serializa cuatro
 * viajes a la base para nada.
 */
export async function contarPorEstado(
  port: OutboxCountPort,
  filtros?: OutboxCountFilters,
): Promise<OutboxCounts> {
  const [processing, sent, failed, pendientes] = await Promise.all([
    port.count(conFiltros('processing', filtros)),
    port.count(conFiltros('sent', filtros)),
    port.count(conFiltros('failed', filtros)),
    port.findMany(conFiltros('pending', filtros)),
  ])
  const retrying = pendientes.filter((row) => (row.attempts ?? 0) > 0).length
  const pending = pendientes.length - retrying
  return {
    pending,
    processing,
    sent,
    failed,
    retrying,
    total: pendientes.length + processing + sent + failed,
  }
}

/**
 * Reintento manual: devuelve la fila a la cola desde cero, igual que hace
 * `POST /api/email-queue/:id/requeue` (email-queue/service.ts) — status `pending`, contador de
 * intentos en 0, sin último error y sin dueño, agendada para AHORA.
 *
 * No se valida el status de origen: además de una `failed`, el caso real es una fila que quedó
 * colgada en `processing` porque el proceso que la tenía se murió, y esa también hay que poder
 * destrabarla a mano. Limpiar `claimedBy` es lo que la libera para el próximo drain.
 */
export async function reintentar(
  port: OutboxRetryPort,
  id: string,
  ahoraIso: string,
): Promise<AriOutboxRow | null> {
  const fila = (await port.findMany({ id }))[0]
  if (!fila) return null
  return port.update(id, {
    status: 'pending',
    attempts: 0,
    lastError: null,
    scheduledAt: ahoraIso,
    claimedBy: null,
  })
}

/**
 * Normaliza un campo numérico a entero dentro de rango. Lo fuera de rango cae al DEFAULT y no al
 * borde: un 500 en "peticiones por minuto" es casi siempre un error de tipeo o un cliente roto, y
 * recortarlo a 60 dejaría corriendo un valor que nadie eligió; volver al default es explícito y el
 * usuario ve en la respuesta que su valor no se tomó.
 */
function aEntero(bruto: unknown, min: number, max: number, porDefecto: number): number {
  if (typeof bruto !== 'number' && typeof bruto !== 'string') return porDefecto
  const n = Number(bruto)
  if (!Number.isFinite(n)) return porDefecto
  const entero = Math.trunc(n)
  if (entero < min || entero > max) return porDefecto
  return entero
}

/** Config confiable a partir de cualquier cosa (body del PUT, JSON de la tabla, null). */
export function sanearConfig(bruto: unknown): QueueConfig {
  const obj = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  return {
    maxAttempts: aEntero(obj.maxAttempts, 1, 10, QUEUE_CONFIG_DEFAULTS.maxAttempts),
    maxPerMinute: aEntero(obj.maxPerMinute, 1, 60, QUEUE_CONFIG_DEFAULTS.maxPerMinute),
  }
}

export interface QueueConfigStore {
  leer(): Promise<QueueConfig>
  guardar(patch: Partial<QueueConfig>): Promise<QueueConfig>
}

/** Fila de `Configuration` tal como vuelve del ORM (el `value` es texto, ver shared/models.ts). */
interface ConfigurationRow {
  id: string
  value?: string | null
}

/**
 * La config persistida, con el mismo patrón key/value que hoteles/usecases/config-kv.ts:
 * `hotelId = 'platform'` porque la cola de Channex es una sola para toda la instalación.
 *
 * `orm` va como `any` igual que en outbox-store.ts: el ORM crudo del framework no está tipado.
 */
export function createQueueConfigStore(orm: any): QueueConfigStore {
  async function filaActual(): Promise<ConfigurationRow | undefined> {
    const filas = (await orm.findMany(CONFIG_MODEL, { hotelId: CONFIG_SCOPE, key: QUEUE_CONFIG_KEY })) as ConfigurationRow[]
    return filas?.[0]
  }

  async function leer(): Promise<QueueConfig> {
    const fila = await filaActual()
    return sanearConfig(parsear(fila?.value))
  }

  return {
    leer,
    async guardar(patch: Partial<QueueConfig>): Promise<QueueConfig> {
      // Se mezcla sobre lo YA guardado para que un PUT parcial (solo maxPerMinute, por ejemplo)
      // no le pise el otro campo con el default.
      const [actual, fila] = await Promise.all([leer(), filaActual()])
      const final = sanearConfig({ ...actual, ...patch })
      const value = JSON.stringify(final)
      if (fila) await orm.update(CONFIG_MODEL, fila.id, { value })
      else await orm.create(CONFIG_MODEL, { id: crypto.randomUUID(), hotelId: CONFIG_SCOPE, key: QUEUE_CONFIG_KEY, value })
      return final
    },
  }
}

/**
 * El `value` guardado, parseado. Un JSON corrupto NO puede tirar el endpoint: se devuelve `null` y
 * `sanearConfig` responde los defaults, que es exactamente lo mismo que pasa cuando no hay fila.
 */
function parsear(value: string | null | undefined): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
