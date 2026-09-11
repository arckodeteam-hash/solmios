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
// Auth: EventSource no manda headers. La ruta acepta un "ticket" = access token de 60 s pedido con
// el JWT normal (`GET /api/restaurant/events/ticket`) y pasado por query — el JWT de 24 h nunca
// viaja en una URL (quedaría en el access.log de nginx). Ver infrastructure/auth/bearer-from-query.ts.
import type { Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
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
  push(chunk: string): void
  close(): void
}

export interface HubOptions {
  heartbeatMs: number
  maxLifetimeMs: number
}

/** Cada 20 s: nginx corta un upstream callado a los 60 s (proxy_read_timeout por defecto). */
export const HEARTBEAT_MS = 20_000
/** 5 min: tope de vida de un suscriptor huérfano (ver arriba). El navegador reconecta al instante y refresca la cola. */
export const MAX_LIFETIME_MS = 5 * 60_000
/** Vida del ticket de conexión: alcanza para abrir el stream, no para reutilizarlo desde un log. */
export const TICKET_TTL_SECONDS = 60

export class RestaurantEventHub {
  private readonly byHotel = new Map<string, Set<Subscriber>>()

  constructor(private readonly opts: HubOptions = { heartbeatMs: HEARTBEAT_MS, maxLifetimeMs: MAX_LIFETIME_MS }) {}

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

  /** Stream de un hotel. Primer chunk `hello`; luego eventos y `ping` de heartbeat. Termina por vida máxima o closeAll. */
  async *subscribe(hotelId: string): AsyncGenerator<string> {
    const queue: string[] = []
    let closed = false
    let wake: (() => void) | null = null
    const sub: Subscriber = {
      push: (chunk) => { queue.push(chunk); wake?.() },
      close: () => { closed = true; wake?.() },
    }
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
      subs.delete(sub)
      if (!subs.size) this.byHotel.delete(hotelId)
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
    stream: hub.subscribe(hotelId),
  }
}

/**
 * Ticket de conexión: el mismo payload del JWT vigente (hotel, rol, userType, impersonación) firmado
 * por 60 s. Se pide con el token normal en el header y se usa UNA vez para abrir el EventSource.
 */
export function eventsTicket(auth: Auth, user: CurrentUser & { userType?: string; impersonatedBy?: string }): { ticket: string; expiresIn: number } {
  const hotelId = hotelFor(user)
  const payload = { id: user.id, role: user.role ?? '', hotelId, userType: user.userType, impersonatedBy: user.impersonatedBy }
  return { ticket: auth.createToken(payload as { id: string; role: string }, `${TICKET_TTL_SECONDS}s`), expiresIn: TICKET_TTL_SECONDS }
}
