// canales/usecases/channex-http.ts — Transporte HTTP de Channex con rate limit y reintentos.
//
// Test 12 de la certificación PMS: Channex exige demostrar que el PMS respeta los
// rate limits (~20 ARI/minuto) y reacciona a 429/5xx con backoff, no con ráfagas.
// Antes cada evento disparaba un fetch inmediato sin timeout ni reintento: una ráfaga
// de ediciones podía meternos en 429 y los fallos se perdían en silencio.
//
// El limiter vive a nivel MÓDULO (singleton): aunque haya varias instancias de
// ChannexUseCase, el budget de requests es uno solo contra la API de Channex.
//
// Hay DOS techos, y los dos salen de docs.channex.io/api-v.1-documentation/rate-limits.md:
//   - global: 20 ARI/min sumando availability + restrictions (acá 18, con margen);
//   - por property: 10/min de POST /availability Y 10/min de POST /restrictions (acá 9, con
//     margen). Este segundo techo faltaba (#294): con el global solo, un hotel que disparaba
//     12 pushes de restrictions en un minuto pasaba el filtro nuestro y cobraba 429 de Channex.
// Ante un 429 en un ARI update, la doc pide "pausar la property 1 minuto": se hace además del
// backoff del request, para que los pushes SIGUIENTES de esa property tampoco salgan en ráfaga.

export interface ChannexHttpOptions {
  /** Máximo de requests por ventana. Default 18 (margen bajo los 20/min de Channex). */
  maxPerMinute?: number
  /** Ventana deslizante en ms. Default 60s. */
  windowMs?: number
  /** Reintentos por request ante 429/5xx/timeout. Default 3. */
  retries?: number
  /** Timeout por intento. Default 15s. */
  timeoutMs?: number
  /** Inyectables para tests: reloj y sleep falsos hacen los tests instantáneos. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface ChannexHttpResponse<T = unknown> {
  ok: boolean
  status: number
  data: T
}

const RETRYABLE_STATUS = (status: number): boolean => status === 429 || status >= 500

const MS_PER_SECOND = 1000

/**
 * El rate limit de Channex (~20/min) aplica a los ARI UPDATES (POST /availability y
 * POST /restrictions), no al CRUD de contenido ni a los GETs. Limitar todo el tráfico
 * haría que un full sync (property + room types + N planes) se auto-bloquee a sí mismo.
 */
const isAriUpdate = (url: string, method?: string): boolean =>
  method === 'POST' && /\/(availability|restrictions)$/.test(String(url).split('?')[0] ?? '')

/** Techo por default: margen bajo los ~20/min que exige Channex. */
export const DEFAULT_MAX_PER_MINUTE = 18

/** Techo por property y endpoint: margen bajo los 10/min que documenta Channex para cada POST. */
export const MAX_PER_PROPERTY_PER_MINUTE = 9

/** Lo que la doc pide tras un 429: "pause updates for the property for 1 minute and try again". */
export const PROPERTY_PAUSE_ON_429_MS = 60_000

type AriEndpoint = 'availability' | 'restrictions'

const ariEndpointOf = (url: string): AriEndpoint | null => {
  const m = /\/(availability|restrictions)$/.exec(String(url).split('?')[0] ?? '')
  return m ? (m[1] as AriEndpoint) : null
}

/**
 * `property_id` de cada value del body de un ARI update, sin repetidos. El body llega ya
 * serializado (`JSON.stringify`) desde `channexReq`; si no se puede leer, el request cae al
 * techo global solo — mejor un 429 aislado que un push que no sale nunca.
 */
const propertyIdsOf = (body: BodyInit | null | undefined): string[] => {
  if (typeof body !== 'string') return []
  try {
    const parsed = JSON.parse(body) as { values?: Array<{ property_id?: unknown }> }
    const ids = new Set<string>()
    for (const v of parsed.values ?? []) if (typeof v?.property_id === 'string' && v.property_id) ids.add(v.property_id)
    return [...ids]
  } catch { return [] }
}

/**
 * Saneo del techo: entero >= 1. Un 0 CONGELA la cola para siempre —`acquireSlot` no encontraría
 * lugar nunca y el push se quedaría esperando— y un NaN rompe todas las comparaciones de la
 * ventana, así que lo que no pasa este filtro se ignora y el límite vigente queda como está.
 */
const saneMaxPerMinute = (n: unknown): number | null => {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v >= 1 ? v : null
}

export function createChannexHttp(fetchImpl?: typeof fetch, opts: ChannexHttpOptions = {}) {
  // `let` y no `const`: el techo se configura desde el Super Admin y tiene que poder cambiar EN
  // CALIENTE (ver setMaxPerMinute). `acquireSlot` lo lee adentro del loop, así que un push que ya
  // está esperando su turno se entera del valor nuevo en la vuelta siguiente.
  let maxPerMinute = saneMaxPerMinute(opts.maxPerMinute) ?? DEFAULT_MAX_PER_MINUTE
  const windowMs = opts.windowMs ?? 60_000
  const retries = opts.retries ?? 3
  const timeoutMs = opts.timeoutMs ?? 15_000
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const sentAt: number[] = [] // timestamps dentro de la ventana deslizante (budget global)
  // Budget por property × endpoint: `<property_id>:<availability|restrictions>` → timestamps.
  const sentAtByProperty = new Map<string, number[]>()
  // Pausa por 429: misma clave → hasta cuándo no sale nada de esa property por ese endpoint.
  const pausedUntil = new Map<string, number>()

  const propertyKey = (propertyId: string, endpoint: AriEndpoint): string => `${propertyId}:${endpoint}`

  const prune = (arr: number[], t: number): void => { while (arr.length && t - arr[0]! >= windowMs) arr.shift() }

  /**
   * Bloquea hasta que haya lugar en la ventana global Y en la de cada property del body. Cada
   * intento (incluidos retries) consume slot en todas. Se toman juntas: reservar el slot global
   * y después quedarse esperando el de la property gastaría budget global sin mandar nada.
   */
  async function acquireSlot(propertyIds: string[], endpoint: AriEndpoint | null): Promise<void> {
    const keys = endpoint ? propertyIds.map((id) => propertyKey(id, endpoint)) : []
    for (;;) {
      const t = now()
      let waitMs = 0
      prune(sentAt, t)
      if (sentAt.length >= maxPerMinute) waitMs = Math.max(waitMs, windowMs - (t - sentAt[0]!))
      for (const k of keys) {
        const until = pausedUntil.get(k) ?? 0
        if (until > t) waitMs = Math.max(waitMs, until - t)
        else if (until) pausedUntil.delete(k)
        const arr = sentAtByProperty.get(k) ?? []
        prune(arr, t)
        if (arr.length >= MAX_PER_PROPERTY_PER_MINUTE) waitMs = Math.max(waitMs, windowMs - (t - arr[0]!))
      }
      if (waitMs === 0) {
        sentAt.push(t)
        for (const k of keys) {
          const arr = sentAtByProperty.get(k) ?? []
          arr.push(t)
          sentAtByProperty.set(k, arr)
        }
        return
      }
      // Alguna ventana llena (o property en pausa): esperar lo que le falta a la más lenta.
      await sleep(waitMs + 5)
    }
  }

  /** 429 en un ARI update: la doc de Channex pide pausar esa property un minuto. */
  function pauseProperties(propertyIds: string[], endpoint: AriEndpoint | null): void {
    if (!endpoint) return
    const until = now() + PROPERTY_PAUSE_ON_429_MS
    for (const id of propertyIds) pausedUntil.set(propertyKey(id, endpoint), until)
  }

  /**
   * Cambia el techo de peticiones por minuto sin reiniciar el proceso: es lo que el operador
   * guarda en la config de la cola (`ari-outbox` › PUT /config), que llega hasta acá por el
   * connector. Los valores que no pasan el saneo se ignoran en silencio: mejor seguir con el
   * límite anterior que dejar la cola trabada.
   */
  function setMaxPerMinute(n: number): void {
    const v = saneMaxPerMinute(n)
    if (v !== null) maxPerMinute = v
  }

  /** Backoff exponencial (500ms·2^attempt, tope 30s); si Channex manda Retry-After, ese manda. */
  function backoffMs(attempt: number, retryAfter: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * MS_PER_SECOND, 60_000)
    }
    return Math.min(500 * 2 ** attempt, 30_000)
  }

  async function request<T = unknown>(url: string, init: RequestInit): Promise<ChannexHttpResponse<T>> {
    // Lazy: el fetch se resuelve POR REQUEST. Así el singleton respeta mocks de
    // globalThis.fetch en tests y siempre usa el global vigente en producción.
    const doFetch = fetchImpl ?? ((u: Parameters<typeof fetch>[0], i: Parameters<typeof fetch>[1]) => globalThis.fetch(u, i))
    let last: ChannexHttpResponse<T> = { ok: false, status: 0, data: null as T }
    const ari = isAriUpdate(url, init.method)
    const endpoint = ari ? ariEndpointOf(url) : null
    const propertyIds = ari ? propertyIdsOf(init.body) : []
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (ari) await acquireSlot(propertyIds, endpoint)
      try {
        const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
        const text = await res.text()
        let data: T
        try { data = text ? (JSON.parse(text) as T) : (null as T) } catch { data = text as unknown as T }
        last = { ok: res.ok, status: res.status, data }
        if (res.ok) return last
        if (res.status === 429 && ari) pauseProperties(propertyIds, endpoint)
        if (RETRYABLE_STATUS(res.status) && attempt < retries) {
          await sleep(backoffMs(attempt, res.headers.get('retry-after')))
          continue
        }
        return last // 4xx definitivo (400/401/404…) o reintentos agotados
      } catch (err) {
        // Timeout / error de red: mismo tratamiento que 5xx — reintentar con backoff.
        last = { ok: false, status: 0, data: null as T }
        if (attempt < retries) { await sleep(backoffMs(attempt, null)); continue }
        throw err
      }
    }
    return last
  }

  return {
    request,
    setMaxPerMinute,
    resetWindow: () => { sentAt.length = 0; sentAtByProperty.clear(); pausedUntil.clear() },
  }
}

/** Instancia compartida por todo el módulo: un solo budget de rate limit contra Channex. */
export const sharedChannexHttp = createChannexHttp()

/**
 * El techo configurado desde el Super Admin aplicado al transporte compartido. Existe como función
 * de módulo (y no como algo que se le pase al constructor) porque quien tiene el valor guardado es
 * `ari-outbox`, que no puede importar de `canales`: el connector canales-ari-outbox escucha el
 * cambio de config y llama acá. Un valor inválido no cambia nada (ver saneMaxPerMinute).
 */
export const setChannexMaxPerMinute = (n: number): void => { sharedChannexHttp.setMaxPerMinute(n) }

/**
 * SOLO TESTS: reinicia la ventana del limiter compartido. bun:test corre cada archivo en su
 * propio proceso, pero los tests DE UN MISMO archivo comparten el singleton — sin esto, un
 * test que consume el budget deja a los siguientes esperando 60s reales (timeout).
 */
export const resetChannexHttpForTests = (): void => { sharedChannexHttp.resetWindow() }
