// src/infrastructure/auth/sse-ticket-auth.ts — autenticación por TICKET de un solo uso (#211).
//
// Para clientes que no pueden mandar headers (`EventSource`) y tienen que pasar la credencial por
// la URL. El ticket lo emite `HotelAuth.createTicket(payload, scope, ttl)` con `type:'ticket'` +
// `scope` + `jti`; esta capa lo verifica para SU scope y consume el `jti` UNA vez. Reemplaza a
// `auth.authenticate()` en la ruta del stream — nunca lo complementa: un access token normal en la
// query o el header NO abre el stream (401), y un ticket como `Bearer` en cualquier otra ruta tampoco
// (`HotelAuth.verifyToken` rechaza `type !== 'access'`). Así, un ticket que quedó en el access.log
// de nginx no sirve para nada: ni para la API, ni para reabrir el stream.
//
// El registro de `jti` usados vive en memoria (una instancia por proceso, igual que el hub de SSE):
// alcanza porque el ticket vence en segundos; un restart lo olvida junto con los streams.
import type { MiddlewareHandler } from 'arckode-framework'
import { AuthError } from 'arckode-framework'
import type { HotelAuth } from './hotel-auth'

/** jti ya consumidos, con vencimiento. Se poda al consumir: nunca crece más que los tickets vivos. */
export class UsedTickets {
  private readonly used = new Map<string, number>()

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  /** true la primera vez que se ve el jti (queda marcado); false si ya se usó dentro del TTL. */
  consume(jti: string): boolean {
    const t = this.now()
    for (const [k, exp] of this.used) if (exp <= t) this.used.delete(k)
    if (this.used.has(jti)) return false
    this.used.set(jti, t + this.ttlMs)
    return true
  }

  size(): number { return this.used.size }
}

export interface SseTicketAuthOptions {
  /** Scope que el ticket tiene que traer (el mismo con el que se emitió). */
  scope: string
  /** Nombre del parámetro de query. */
  param?: string
  /** Vida del ticket: cuánto se recuerda un jti consumido. */
  ttlMs: number
  used?: UsedTickets
}

/**
 * Middleware: toma `?ticket=` (o `Authorization: Bearer <ticket>`), lo verifica como ticket del scope,
 * consume el jti y deja `req.user` como lo haría `auth.authenticate()` (loadPermissions/requirePermission
 * siguen igual). Sin ticket, ticket de otro scope, access token, o jti repetido → AuthError (401).
 */
export function sseTicketAuth(auth: Pick<HotelAuth, 'verifyTicket'>, opts: SseTicketAuthOptions): MiddlewareHandler {
  const param = opts.param ?? 'ticket'
  const used = opts.used ?? new UsedTickets(opts.ttlMs)
  return async (req, next) => {
    const header = req.headers?.['authorization']
    const fromHeader = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
    const fromQuery = req.query?.[param]
    const token = fromHeader || (typeof fromQuery === 'string' ? fromQuery : '')
    if (!token) throw new AuthError('Authentication ticket required')
    const { jti, ...user } = auth.verifyTicket(token, opts.scope)
    if (!used.consume(jti)) throw new AuthError('Ticket already used')
    req.user = user
    return next()
  }
}
