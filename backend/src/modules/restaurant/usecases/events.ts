// restaurant/usecases/events.ts — Canal en vivo del restaurante (#211): un stream SSE por conexión,
// agrupado por hotel. El KDS y el Salón dejan de depender del polling de 15 s (queda como fallback).
//
// Transporte: `HttpResponse.stream` del framework (kernel/http/types.ts). El server (kernel/http/
// server.ts) consume el AsyncGenerator con `for await` y escribe cada chunk como `data: <chunk>\n\n`
// con `Content-Type: text/event-stream` — es el ÚNICO mecanismo de streaming que ofrece; no hay
// soporte de `ReadableStream`/`Response` de Bun (`res.body` que no sea Buffer se envuelve en JSON).
// Ventajas de usarlo: `compression()` lo saltea explícitamente (`if (res.stream) return res`) y
// `timeout(30000)` no lo corta (la carrera es contra el handler, que devuelve el stream al instante).
// Limitaciones que este archivo compensa:
//   - el server solo escribe `data:` (sin `event:`/`id:`), así que el tipo viaja DENTRO del JSON;
//   - el generador no ve el socket, y bajo Bun `nodeRes.write()` sobre una conexión que el cliente
//     cerró NO falla (sonda del 2026-09-11: el suscriptor seguía vivo 6 s después de cortar el curl,
//     con heartbeat de 1 s). Un cliente que se fue es indetectable desde acá. Por eso la vida máxima
//     por conexión es CORTA (MAX_LIFETIME_MS): el navegador reconecta solo y vuelve a pedir la cola, y
//     un suscriptor huérfano nunca vive más que eso. El heartbeat mantiene vivo el proxy (nginx corta
//     un upstream callado a los 60 s) — no sirve para detectar el corte.
//
// Auth: EventSource no manda headers. La ruta acepta SOLO un "ticket" (`HotelAuth.createTicket`,
// `type:'ticket'`, scope TICKET_SCOPE, `jti` de un solo uso, 60 s) pedido con el JWT normal en
// `GET /api/restaurant/events/ticket` y pasado por query. El ticket no es un access token: como
// `Bearer` en cualquier otra ruta da 401, y usado dos veces también. El JWT de 24 h nunca viaja en
// una URL (quedaría en el access.log de nginx). Ver infrastructure/auth/sse-ticket-auth.ts.
//
// Topes (#211, auditoría): MAX_STREAMS_PER_HOTEL / MAX_STREAMS_PER_USER. Al superarlos se cierra el
// stream MÁS VIEJO (el navegador de esa pestaña reconecta y, si sigue de más, vuelve a cerrar el más
// viejo: una pestaña olvidada nunca deja sin canal a la que se está usando). Sin tope, cada F5 de
// una tablet dejaba un suscriptor huérfano vivo 5 min y un cliente malicioso los acumulaba sin límite.
import type { Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { HotelAuth } from '../../../infrastructure/auth/hotel-auth'
import type { CurrentUser } from '../types'

export type RestaurantEventType = 'hello' | 'ping' | 'order.sent' | 'line.status' | 'order.closed' | 'table.changed'

/** Lo que viaja por el stream. Chico a propósito: el cliente vuelve a pedir la cola/el salón al recibirlo. */
export interface RestaurantEvent {
  type: RestaurantEventType
  at: string
  orderId?: string
  tableId?: string
  lineId?: string
  /** line.status: estado nuevo de la línea · order.closed: estado final de la comanda · table.changed: estado de la mesa */
  status?: string
  /** order.sent: estaciones de las líneas despachadas ('' = sin estación) — el KDS decide si le toca sonar. */
  stationIds?: string[]
}

interface Subscriber {
  userId: string
  push(chunk: string): void
  close(): void
}

export interface HubOptions {
  heartbeatMs: number
  maxLifetimeMs: number
  maxPerHotel?: number
  maxPerUser?: number
}

/** Cada 20 s: nginx corta un upstream callado a los 60 s (proxy_read_timeout por defecto). */
export const HEARTBEAT_MS = 20_000
/** 5 min: tope de vida de un suscriptor huérfano (ver arriba). El navegador reconecta al instante y refresca la cola. */
export const MAX_LIFETIME_MS = 5 * 60_000
/** Vida del ticket de conexión: alcanza para abrir el stream, no para reutilizarlo desde un log. */
export const TICKET_TTL_SECONDS = 60
/** Scope del ticket: solo lo acepta GET /api/restaurant/events (sse-ticket-auth). */
export const TICKET_SCOPE = 'restaurant:events'
/** Streams simultáneos por hotel: KDS por estación + salón + cobrar en varias tablets entra holgado. */
export const MAX_STREAMS_PER_HOTEL = 20
/** Streams simultáneos por usuario: dos pestañas (KDS + Salón) y una de reserva. */
export const MAX_STREAMS_PER_USER = 3

export class RestaurantEventHub {
  private readonly byHotel = new Map<string, Set<Subscriber>>()
  private readonly opts: Required<HubOptions>

  constructor(opts: HubOptions = { heartbeatMs: HEARTBEAT_MS, maxLifetimeMs: MAX_LIFETIME_MS }) {
    this.opts = { maxPerHotel: MAX_STREAMS_PER_HOTEL, maxPerUser: MAX_STREAMS_PER_USER, ...opts }
  }

  /** Entrega el evento a TODOS los streams del hotel (y a ninguno de otro hotel). */
  publish(hotelId: string, event: Omit<RestaurantEvent, 'at'> & { at?: string }): void {
    const subs = this.byHotel.get(hotelId)
    if (!subs?.size) return
    const chunk = JSON.stringify({ ...event, at: event.at ?? new Date().toISOString() })
    for (const s of subs) s.push(chunk)
  }

  /** Conexiones vivas del hotel (diagnóstico/tests). */
  size(hotelId: string): number { return this.byHotel.get(hotelId)?.size ?? 0 }

  /** Cierra todos los streams (shutdown): el server termina cada respuesta y los navegadores reconectan al volver. */
  closeAll(): void {
    for (const subs of this.byHotel.values()) for (const s of [...subs]) s.close()
  }

  /** Conexiones vivas de un usuario en el hotel (diagnóstico/tests). */
  sizeForUser(hotelId: string, userId: string): number {
    let n = 0
    for (const s of this.byHotel.get(hotelId) ?? []) if (s.userId === userId) n++
    return n
  }

  /** Saca al suscriptor del hotel en el acto (no espera al `finally` del generador: el tope cuenta al instante). */
  private drop(hotelId: string, sub: Subscriber): void {
    const subs = this.byHotel.get(hotelId)
    if (!subs) return
    subs.delete(sub)
    if (!subs.size) this.byHotel.delete(hotelId)
  }

  /** Antes de sumar uno: si el usuario o el hotel están al tope, se cierra el más viejo (los Set conservan orden de llegada). */
  private makeRoom(hotelId: string, userId: string): void {
    const subs = this.byHotel.get(hotelId)
    if (!subs) return
    while (this.sizeForUser(hotelId, userId) >= this.opts.maxPerUser) {
      const oldest = [...subs].find((s) => s.userId === userId)
      if (!oldest) break
      oldest.close()
    }
    while (subs.size >= this.opts.maxPerHotel) {
      const oldest = subs.values().next().value as Subscriber | undefined
      if (!oldest) break
      oldest.close()
    }
  }

  /** Stream de un hotel. Primer chunk `hello`; luego eventos y `ping` de heartbeat. Termina por vida máxima, tope o closeAll. */
  async *subscribe(hotelId: string, userId = ''): AsyncGenerator<string> {
    const queue: string[] = []
    let closed = false
    let wake: (() => void) | null = null
    const sub: Subscriber = {
      userId,
      push: (chunk) => { queue.push(chunk); wake?.() },
      close: () => { closed = true; this.drop(hotelId, sub); wake?.() },
    }
    this.makeRoom(hotelId, userId)
    const subs = this.byHotel.get(hotelId) ?? new Set<Subscriber>()
    subs.add(sub)
    this.byHotel.set(hotelId, subs)
    const heartbeat = setInterval(() => sub.push(JSON.stringify({ type: 'ping', at: new Date().toISOString() })), this.opts.heartbeatMs)
    const lifetime = setTimeout(() => sub.close(), this.opts.maxLifetimeMs)
    try {
      yield JSON.stringify({ type: 'hello', at: new Date().toISOString() })
      // Lo encolado se entrega antes de cerrar (un cierre no pierde el evento que llegó junto con él).
      while (true) {
        const next = queue.shift()
        if (next !== undefined) { yield next; continue }
        if (closed) break
        await new Promise<void>((resolve) => { wake = resolve })
        wake = null
      }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(lifetime)
      this.drop(hotelId, sub)
    }
  }
}

function hotelFor(user: CurrentUser): string {
  const h = user.hotelId || ''
  if (!h) throw new ValidationError('Sin hotel asignado')
  return h
}

/** Respuesta SSE para el hotel del usuario. Los headers anti-buffering van acá; nginx además necesita `proxy_buffering off`. */
export function eventStream(hub: RestaurantEventHub, user: CurrentUser): { status: number; headers: Record<string, string>; stream: AsyncGenerator<string> } {
  const hotelId = hotelFor(user)
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
    stream: hub.subscribe(hotelId, user.id),
  }
}

/**
 * Ticket de conexión: el mismo payload del JWT vigente (hotel, rol, userType, impersonación) firmado
 * como `type:'ticket'` con scope TICKET_SCOPE y `jti` único, por 60 s. Se pide con el token normal en
 * el header y se usa UNA vez para abrir el EventSource; no sirve como Bearer en ninguna otra ruta.
 */
export function eventsTicket(auth: Auth, user: CurrentUser & { userType?: string; impersonatedBy?: string }): { ticket: string; expiresIn: number } {
  const hotelId = hotelFor(user)
  const payload = { id: user.id, role: user.role ?? '', hotelId, userType: user.userType, impersonatedBy: user.impersonatedBy }
  return { ticket: ticketIssuer(auth).createTicket(payload, TICKET_SCOPE, `${TICKET_TTL_SECONDS}s`).ticket, expiresIn: TICKET_TTL_SECONDS }
}

/** El service recibe `Auth` (los tests le pasan fakes); los tickets los firma solo `HotelAuth`. Error de wiring, no de request. */
function ticketIssuer(auth: Auth): Pick<HotelAuth, 'createTicket'> {
  const candidate = auth as Partial<Pick<HotelAuth, 'createTicket'>>
  if (typeof candidate.createTicket !== 'function') throw new Error('restaurant: los tickets del canal en vivo requieren HotelAuth (createTicket)')
  return candidate as Pick<HotelAuth, 'createTicket'>
}
