// canales/usecases/ari-tasks.ts — Rastro de los ARI updates que salen hacia Channex.
//
// Channex encola cada `POST /availability` y `POST /restrictions` y responde con las TAREAS que
// creó: `{"data":[{"id":"<uuid>","type":"task"}],"meta":{"message":"Success"}}`. Ese id es el
// único identificador con el que se puede rastrear un push del lado de Channex — soporte lo pide
// cuando una tarifa no aparece en la OTA, y la certificación PMS exige entregar el task id de
// cada uno de los tests 1 a 10.
//
// Hasta ahora la respuesta se descartaba (`await this.channexReq(...)` sin leer el body): un push
// que salía bien no dejaba ningún rastro consultable y uno que Channex rechazaba con 422 pasaba
// como exitoso. Acá vive la parte pura — extraer los ids y armar la fila de `sync_log` —, sin DB
// ni HTTP, para que sea testeable sin red.

/** Acciones ARI que se registran en `sync_log`. Los labels legibles están en `sync-log.ts`. */
export type AriAction = 'push_availability' | 'push_rates' | 'push_rate_overrides'

/**
 * Los task ids de una respuesta ARI de Channex. Tolera las tres formas que devuelve la API
 * (lista de tareas, tarea suelta, o un body sin `data`) porque un cambio de forma no puede
 * romper el push: el rastro es observabilidad, no el resultado.
 */
export function extractTaskIds(data: unknown): string[] {
  const body = data as { data?: unknown } | null | undefined
  const rows = Array.isArray(body?.data) ? body!.data : body?.data ? [body.data] : []
  const ids: string[] = []
  for (const row of rows as Array<{ id?: unknown; type?: unknown }>) {
    const id = row?.id
    if (typeof id === 'string' && id) ids.push(id)
  }
  return ids
}

/** Lo que el service sabe del push y quiere dejar asentado. */
export interface AriPushOutcome {
  taskIds?: string[]
  /** Entries enviados en la llamada (rangos de availability o filas de restrictions). */
  values?: number
  /** Llamadas HTTP que consumió (siempre 0 o 1 salvo el full sync, que son 2). */
  calls?: number
  /** Mensaje de error si el push falló. Su presencia marca la fila como `error`. */
  error?: string
}

/** Fila de `sync_log` — misma forma que escriben el sync de propiedad y la ingesta de reservas. */
export interface AriTrailRow {
  id: string
  hotelId: string
  channel: 'channex'
  action: AriAction
  status: 'success' | 'error'
  details: Record<string, unknown>
  createdAt: string
}

/**
 * Arma la fila del rastro. `now`/`newId` se inyectan para que el test no dependa del reloj.
 * Un push que no mandó nada (0 entries) NO se registra: llenaría el historial de ruido en cada
 * evento de un hotel sin propiedad sincronizada.
 */
export function buildAriTrailRow(
  hotelId: string,
  action: AriAction,
  outcome: AriPushOutcome,
  now: () => string = () => new Date().toISOString(),
  newId: () => string = () => crypto.randomUUID(),
): AriTrailRow | null {
  const taskIds = outcome.taskIds ?? []
  if (!outcome.error && !taskIds.length && !outcome.values) return null
  const details: Record<string, unknown> = {}
  if (taskIds.length) details.taskIds = taskIds
  if (outcome.values) details.entries = outcome.values
  if (outcome.calls) details.calls = outcome.calls
  if (outcome.error) details.error = outcome.error.slice(0, 300)
  return {
    id: newId(),
    hotelId,
    channel: 'channex',
    action,
    status: outcome.error ? 'error' : 'success',
    details,
    createdAt: now(),
  }
}

/** Lo mínimo del repo de `sync_log` que necesita el rastro. */
export interface AriTrailRepo {
  create: (row: AriTrailRow) => Promise<unknown>
}

/** Asienta una fila del rastro. Nunca lanza: la auditoría no puede tumbar un push. */
export async function recordAriTrail(
  repo: AriTrailRepo | undefined | null,
  hotelId: string,
  action: AriAction,
  outcome: AriPushOutcome,
): Promise<void> {
  if (!repo) return
  const row = buildAriTrailRow(hotelId, action, outcome)
  if (!row) return
  try { await repo.create(row) } catch { /* el rastro nunca rompe el push */ }
}

/**
 * Envuelve un push ARI: lo ejecuta, deja el rastro (con task ids si salió, con el motivo si
 * falló) y propaga el resultado tal cual. El error se re-lanza — quien pushea decide si lo
 * tolera; lo que no puede pasar es que un push fallido no deje huella.
 */
export async function withAriTrail<T>(
  repo: AriTrailRepo | undefined | null,
  hotelId: string,
  action: AriAction,
  run: () => Promise<T>,
  outcomeOf: (result: T) => AriPushOutcome,
): Promise<T> {
  try {
    const result = await run()
    await recordAriTrail(repo, hotelId, action, outcomeOf(result))
    return result
  } catch (e) {
    await recordAriTrail(repo, hotelId, action, { error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

/** Cómo se lee el resultado de un push de availability (booleano o cantidad de rangos). */
const availabilityOutcome = (r: { pushed: boolean | number; taskIds?: string[] }): AriPushOutcome => ({
  taskIds: r.taskIds,
  values: typeof r.pushed === 'number' ? r.pushed : undefined,
  calls: r.pushed ? 1 : 0,
})

/** Push de availability con rastro. Atajo para que el service quede en una línea por método. */
export function withAvailabilityTrail<T extends { pushed: boolean | number; taskIds?: string[] }>(
  repo: AriTrailRepo | undefined | null, hotelId: string, run: () => Promise<T>,
): Promise<T> {
  return withAriTrail(repo, hotelId, 'push_availability', run, availabilityOutcome)
}

/** Ídem para los dos pushes de tarifas (`push_rates` consolidado y `push_rate_overrides` delta). */
export function withRatesTrail<T extends { pushed: number; calls?: number; taskIds?: string[] }>(
  repo: AriTrailRepo | undefined | null, hotelId: string, action: AriAction, run: () => Promise<T>,
): Promise<T> {
  return withAriTrail(repo, hotelId, action, run, (r) => ({
    taskIds: r.taskIds, values: r.pushed, calls: r.calls ?? (r.pushed ? 1 : 0),
  }))
}
