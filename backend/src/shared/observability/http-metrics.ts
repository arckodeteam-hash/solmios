// shared/observability/http-metrics.ts — middleware que mide cada petición y avisa de los errores.
// Regla de oro: SIEMPRE devuelve la respuesta de next() (o relanza su excepción). El registro va en
// try/catch y `onError` se llama sin esperar: si el store o el sink fallan, el cliente no lo nota.
import type { MiddlewareHandler, HttpRequest, HttpResponse } from 'arckode-framework'
import type { HttpMetricsStore } from './metrics'
import { normalizeRouteKey } from './route-key'

export interface ErrorEvent {
  method: string
  /** Path normalizado (UUID/ULID/dígitos → :id). */
  path: string
  statusCode: number
  message: string
  stack?: string
  hotelId?: string
}

export interface HttpMetricsOptions {
  onError?: (e: ErrorEvent) => void | Promise<void>
  now?: () => number
}

const SERVER_ERROR = 500
const RATE_LIMITED = 429
const STACK_LINES = 5

function requestPath(req: HttpRequest): string {
  const raw = req.path || (req as { url?: string }).url || '/'
  return normalizeRouteKey(raw)
}

function hotelIdOf(req: HttpRequest): string | undefined {
  const user = req.user as { hotelId?: unknown } | undefined
  return typeof user?.hotelId === 'string' ? user.hotelId : undefined
}

function responseMessage(res: HttpResponse): string {
  const body = res.body as { error?: unknown; message?: unknown } | undefined
  if (typeof body?.error === 'string' && body.error) return body.error
  if (typeof body?.message === 'string' && body.message) return body.message
  return `HTTP ${res.status}`
}

function shortStack(err: unknown): string | undefined {
  const stack = err instanceof Error ? err.stack : undefined
  return stack ? stack.split('\n').slice(0, STACK_LINES).join('\n') : undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Llama al sink sincrónicamente; si devuelve promesa, se traga el rechazo. Nunca lanza. */
function emit(onError: HttpMetricsOptions['onError'], event: ErrorEvent): void {
  if (!onError) return
  try {
    const out = onError(event)
    if (out && typeof (out as Promise<void>).catch === 'function') (out as Promise<void>).catch(() => {})
  } catch { /* el sink no puede tumbar la petición */ }
}

export function httpMetrics(store: HttpMetricsStore, opts: HttpMetricsOptions = {}): MiddlewareHandler {
  const now = opts.now ?? (() => performance.now())
  return async (req, next) => {
    const started = now()
    let res: HttpResponse
    try {
      res = await next()
    } catch (err) {
      try {
        const path = requestPath(req)
        store.record({ method: req.method, route: path, status: SERVER_ERROR, durationMs: now() - started })
        emit(opts.onError, { method: req.method, path, statusCode: SERVER_ERROR, message: errorMessage(err), stack: shortStack(err), hotelId: hotelIdOf(req) })
      } catch { /* el registro nunca cambia el resultado */ }
      throw err
    }
    try {
      const path = requestPath(req)
      store.record({ method: req.method, route: path, status: res.status, durationMs: now() - started })
      if (res.status >= SERVER_ERROR || res.status === RATE_LIMITED) {
        emit(opts.onError, { method: req.method, path, statusCode: res.status, message: responseMessage(res), hotelId: hotelIdOf(req) })
      }
    } catch { /* idem: la respuesta de next() se devuelve igual */ }
    return res
  }
}
