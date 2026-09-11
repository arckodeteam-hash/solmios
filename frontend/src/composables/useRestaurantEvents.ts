// composables/useRestaurantEvents.ts — #211: canal en vivo del restaurante (SSE) para el KDS y el Salón.
//
// `EventSource` nativo (sin dependencia nueva). El backend no acepta headers en esa ruta porque
// EventSource no los manda: se pide un ticket de 60 s con el JWT normal (`/restaurant/events/ticket`)
// y se abre `GET /restaurant/events?ticket=…`. La reconexión NO es la nativa del navegador — esa
// reusa la misma URL y el ticket ya venció (401 → EventSource se rinde): acá se cierra y se vuelve a
// abrir con ticket nuevo y backoff. Mientras no hay stream, un polling (`onPoll`) cada `pollMs`
// mantiene la pantalla viva; al reconectar se llama `onPoll` una vez para recuperar lo perdido.
//
// El server cierra cada stream a los 5 min (vida máxima, ver backend usecases/events.ts): eso llega
// como `error` y se trata igual que una caída — reconexión inmediata + refresco.
//
// Imports relativos (no `@/`) a propósito: el test corre también con `bun test`, que no lee los
// `paths` de tsconfig.app.json.
import { ref, getCurrentScope, onScopeDispose, type Ref } from 'vue'
import { RestaurantService, type RestaurantEvent } from '../services/Restaurant.service'
import { toApiUrl } from '../services/http'

export type LiveState = 'idle' | 'connecting' | 'live' | 'reconnecting'

/** Subconjunto de EventSource que usa el composable — inyectable en tests. */
export interface EventSourceLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
  close(): void
}

export interface UseRestaurantEventsOptions {
  /** Evento del stream (nunca `hello`/`ping`: se filtran acá). */
  onEvent: (event: RestaurantEvent) => void
  /** Refresco completo. Se llama por polling mientras no hay stream y una vez al (re)conectar. */
  onPoll?: () => void | Promise<void>
  /** Intervalo del polling de respaldo. */
  pollMs?: number
  /** Escalera de espera entre reintentos (ms); el último valor se repite. */
  backoffMs?: number[]
  /** Fábrica del EventSource (tests). Default: `new EventSource(url)`. */
  createSource?: (url: string) => EventSourceLike
  /** Cómo se consigue el ticket (tests). Default: `RestaurantService.eventsTicket()`. */
  getTicket?: () => Promise<{ ticket: string }>
  /** Reloj inyectable (tests con timers falsos o reales). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

export const DEFAULT_POLL_MS = 15_000
export const DEFAULT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15_000]

export interface UseRestaurantEvents {
  state: Ref<LiveState>
  /** Cantidad de reintentos seguidos sin conectar (0 cuando está en vivo). */
  attempts: Ref<number>
  start(): void
  stop(): void
}

export function useRestaurantEvents(opts: UseRestaurantEventsOptions): UseRestaurantEvents {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  const backoff = opts.backoffMs?.length ? opts.backoffMs : DEFAULT_BACKOFF_MS
  const createSource = opts.createSource ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike)
  const getTicket = opts.getTicket ?? (() => RestaurantService.eventsTicket())
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))

  const state = ref<LiveState>('idle')
  const attempts = ref(0)
  let source: EventSourceLike | null = null
  let stopped = true
  let retryTimer: unknown = null
  let pollTimer: unknown = null
  // Cada intento de conexión lleva un número: un `error` de un EventSource viejo no toca al nuevo.
  let generation = 0

  function clearRetry() { if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null } }
  function stopPolling() { if (pollTimer !== null) { clearTimer(pollTimer); pollTimer = null } }
  function poll() { try { void opts.onPoll?.() } catch { /* el polling nunca tira */ } }
  function startPolling() {
    if (pollTimer !== null || !opts.onPoll) return
    const tick = () => { pollTimer = null; if (stopped || state.value === 'live') return; poll(); pollTimer = setTimer(tick, pollMs) }
    pollTimer = setTimer(tick, pollMs)
  }
  function closeSource() {
    if (!source) return
    const s = source
    source = null
    s.onopen = s.onmessage = s.onerror = null
    s.close()
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== null) return
    state.value = 'reconnecting'
    startPolling()
    const wait = backoff[Math.min(attempts.value, backoff.length - 1)] ?? backoff[backoff.length - 1]!
    attempts.value += 1
    retryTimer = setTimer(() => { retryTimer = null; void connect() }, wait)
  }

  async function connect(): Promise<void> {
    if (stopped) return
    const gen = ++generation
    if (state.value !== 'reconnecting') state.value = 'connecting'
    let ticket: string
    try {
      ticket = (await getTicket()).ticket
    } catch {
      if (gen !== generation || stopped) return
      scheduleRetry()
      return
    }
    if (gen !== generation || stopped) return
    closeSource()
    const es = createSource(toApiUrl(`/restaurant/events?ticket=${encodeURIComponent(ticket)}`))
    source = es
    es.onopen = () => {
      if (gen !== generation) return
      const recovered = state.value === 'reconnecting' || attempts.value > 0
      state.value = 'live'
      attempts.value = 0
      stopPolling()
      // Lo que pasó mientras no había stream (o durante el primer arranque) se recupera con un refresco.
      if (recovered) poll()
    }
    es.onmessage = (ev) => {
      if (gen !== generation) return
      let event: RestaurantEvent | null = null
      try { event = JSON.parse(ev.data) as RestaurantEvent } catch { event = null }
      if (!event || event.type === 'hello' || event.type === 'ping') return
      opts.onEvent(event)
    }
    es.onerror = () => {
      if (gen !== generation) return
      closeSource()
      scheduleRetry()
    }
  }

  function start() {
    if (!stopped) return
    stopped = false
    attempts.value = 0
    void connect()
  }

  function stop() {
    stopped = true
    generation++
    clearRetry()
    stopPolling()
    closeSource()
    state.value = 'idle'
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return { state, attempts, start, stop }
}
