// canales/usecases/channex-http.ts — Transporte HTTP de Channex con rate limit y reintentos.
//
// Test 12 de la certificación PMS: Channex exige demostrar que el PMS respeta los
// rate limits (~20 ARI/minuto) y reacciona a 429/5xx con backoff, no con ráfagas.
// Antes cada evento disparaba un fetch inmediato sin timeout ni reintento: una ráfaga
// de ediciones podía meternos en 429 y los fallos se perdían en silencio.
//
// El limiter vive a nivel MÓDULO (singleton): aunque haya varias instancias de
// ChannexUseCase, el budget de requests es uno solo contra la API de Channex.

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

export function createChannexHttp(fetchImpl?: typeof fetch, opts: ChannexHttpOptions = {}) {
  const maxPerMinute = opts.maxPerMinute ?? 18
  const windowMs = opts.windowMs ?? 60_000
  const retries = opts.retries ?? 3
  const timeoutMs = opts.timeoutMs ?? 15_000
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const sentAt: number[] = [] // timestamps dentro de la ventana deslizante

  /** Bloquea hasta que haya lugar en la ventana. Cada intento (incluidos retries) consume slot. */
  async function acquireSlot(): Promise<void> {
    for (;;) {
      const t = now()
      while (sentAt.length && t - sentAt[0]! >= windowMs) sentAt.shift()
      if (sentAt.length < maxPerMinute) { sentAt.push(t); return }
      // Ventana llena: esperar lo que le falta al request más viejo para expirar.
      await sleep(windowMs - (t - sentAt[0]!) + 5)
    }
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
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (isAriUpdate(url, init.method)) await acquireSlot()
      try {
        const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
        const text = await res.text()
        let data: T
        try { data = text ? (JSON.parse(text) as T) : (null as T) } catch { data = text as unknown as T }
        last = { ok: res.ok, status: res.status, data }
        if (res.ok) return last
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

  return { request, resetWindow: () => { sentAt.length = 0 } }
}

/** Instancia compartida por todo el módulo: un solo budget de rate limit contra Channex. */
export const sharedChannexHttp = createChannexHttp()

/**
 * SOLO TESTS: reinicia la ventana del limiter compartido. bun:test corre cada archivo en su
 * propio proceso, pero los tests DE UN MISMO archivo comparten el singleton — sin esto, un
 * test que consume el budget deja a los siguientes esperando 60s reales (timeout).
 */
export const resetChannexHttpForTests = (): void => { sharedChannexHttp.resetWindow() }
