// useRestaurantEvents.test.ts — #211: reconexión con ticket nuevo y polling de respaldo.
//
// Sin `vi.mock` ni timers falsos: el composable recibe la fábrica de EventSource, el ticket y el reloj
// por opciones, así el test corre igual con vitest (`bun run test`) y con `bun test`. Los tiempos son
// reales pero de milisegundos (backoff 5/10 ms, polling 20 ms).
import { describe, it, expect } from 'vitest'
import { useRestaurantEvents, type EventSourceLike } from './useRestaurantEvents'

class FakeSource implements EventSourceLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  closed = false
  url: string
  constructor(url: string) { this.url = url }
  close() { this.closed = true }
  open() { this.onopen?.({}) }
  emit(data: unknown) { this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }) }
  fail() { this.onerror?.({}) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function harness(overrides: { ticketFails?: () => boolean } = {}) {
  const sources: FakeSource[] = []
  const events: unknown[] = []
  let polls = 0
  let tickets = 0
  const live = useRestaurantEvents({
    onEvent: (e) => events.push(e),
    onPoll: () => { polls++ },
    pollMs: 20,
    backoffMs: [5, 10],
    createSource: (url) => { const s = new FakeSource(url); sources.push(s); return s },
    getTicket: async () => {
      tickets++
      if (overrides.ticketFails?.()) throw new Error('sin red')
      return { ticket: `t${tickets}` }
    },
  })
  return { live, sources, events, polls: () => polls, tickets: () => tickets, last: () => sources[sources.length - 1]! }
}

describe('useRestaurantEvents — conexión', () => {
  it('pide un ticket, abre el EventSource con ?ticket= y pasa a "live" al abrir', async () => {
    const h = harness()
    expect(h.live.state.value).toBe('idle')
    h.live.start()
    expect(h.live.state.value).toBe('connecting')
    await sleep(1)
    expect(h.tickets()).toBe(1)
    expect(h.last().url).toContain('/api/restaurant/events?ticket=t1')
    h.last().open()
    expect(h.live.state.value).toBe('live')
    expect(h.live.attempts.value).toBe(0)
    // Primera conexión limpia: no hace falta refrescar (la pantalla ya cargó por su cuenta).
    expect(h.polls()).toBe(0)
    h.live.stop()
  })

  it('entrega los eventos del stream y filtra hello/ping y basura', async () => {
    const h = harness()
    h.live.start()
    await sleep(1)
    h.last().open()
    h.last().emit({ type: 'hello', at: 'x' })
    h.last().emit({ type: 'ping', at: 'x' })
    h.last().emit('no es json')
    h.last().emit({ type: 'order.sent', at: 'x', orderId: 'o1', stationIds: ['s1'] })
    h.last().emit({ type: 'line.status', at: 'x', lineId: 'l1', status: 'ready' })
    expect(h.events).toEqual([
      { type: 'order.sent', at: 'x', orderId: 'o1', stationIds: ['s1'] },
      { type: 'line.status', at: 'x', lineId: 'l1', status: 'ready' },
    ])
    h.live.stop()
  })
})

describe('useRestaurantEvents — reconexión', () => {
  it('al caer el stream: "reconnecting", cierra el viejo, reconecta con ticket NUEVO y refresca al volver', async () => {
    const h = harness()
    h.live.start()
    await sleep(1)
    const first = h.last()
    first.open()
    expect(h.live.state.value).toBe('live')

    first.fail()
    expect(h.live.state.value).toBe('reconnecting')
    expect(first.closed).toBe(true)
    expect(h.live.attempts.value).toBe(1)

    await sleep(8)   // backoff[0] = 5 ms
    expect(h.sources).toHaveLength(2)
    expect(h.tickets()).toBe(2)
    expect(h.last().url).toContain('ticket=t2')   // nunca reusa el ticket vencido
    expect(h.last()).not.toBe(first)

    const polled = h.polls()
    h.last().open()
    expect(h.live.state.value).toBe('live')
    expect(h.live.attempts.value).toBe(0)
    expect(h.polls()).toBe(polled + 1)   // recupera lo perdido sin recargar la página
    h.live.stop()
  })

  it('escalera de backoff: 5 ms, 10 ms y luego 10 ms (repite el último)', async () => {
    const h = harness()
    h.live.start()
    await sleep(1)
    h.last().fail()
    expect(h.sources).toHaveLength(1)
    await sleep(7)
    expect(h.sources).toHaveLength(2)
    h.last().fail()
    await sleep(7)
    expect(h.sources).toHaveLength(2)   // todavía no (espera 10 ms)
    await sleep(6)
    expect(h.sources).toHaveLength(3)
    h.last().fail()
    await sleep(13)
    expect(h.sources).toHaveLength(4)
    expect(h.live.attempts.value).toBe(3)
    h.live.stop()
  })

  it('un error del EventSource viejo (ya reemplazado) no dispara otra reconexión', async () => {
    const h = harness()
    h.live.start()
    await sleep(1)
    const first = h.last()
    first.fail()
    await sleep(8)
    const second = h.last()
    expect(second).not.toBe(first)
    second.open()
    // El handler del viejo se desengancha al cerrarlo; aunque alguien lo llamara, no hace nada.
    expect(first.onerror).toBeNull()
    expect(h.live.state.value).toBe('live')
    await sleep(15)
    expect(h.sources).toHaveLength(2)
    h.live.stop()
  })

  it('si no consigue ticket (backend caído) también reintenta con backoff', async () => {
    let down = true
    const h = harness({ ticketFails: () => down })
    h.live.start()
    await sleep(2)
    expect(h.sources).toHaveLength(0)
    expect(h.live.state.value).toBe('reconnecting')
    down = false
    await sleep(8)
    expect(h.sources).toHaveLength(1)
    h.last().open()
    expect(h.live.state.value).toBe('live')
    h.live.stop()
  })
})

describe('useRestaurantEvents — polling de respaldo', () => {
  it('mientras no hay stream hace polling cada pollMs; en vivo no; al reconectar lo corta', async () => {
    const h = harness()
    h.live.start()
    await sleep(1)
    h.last().open()
    await sleep(45)
    expect(h.polls()).toBe(0)   // en vivo, cero polling

    h.last().fail()
    // Reintentos fallidos seguidos: el polling sigue solo.
    await sleep(8); h.last().fail()
    await sleep(13); h.last().fail()
    await sleep(30)
    expect(h.polls()).toBeGreaterThanOrEqual(2)

    await sleep(13)
    const before = h.polls()
    h.last().open()
    expect(h.live.state.value).toBe('live')
    expect(h.polls()).toBe(before + 1)   // el refresco de recuperación
    await sleep(45)
    expect(h.polls()).toBe(before + 1)   // y después nada: vuelve a mandar el stream
    h.live.stop()
  })

  it('stop() cierra el stream, frena reintentos y polling, y vuelve a idle', async () => {
    const h = harness()
    h.live.start()
    await sleep(1)
    h.last().fail()
    h.live.stop()
    expect(h.live.state.value).toBe('idle')
    expect(h.last().closed).toBe(true)
    const n = h.sources.length
    const p = h.polls()
    await sleep(40)
    expect(h.sources).toHaveLength(n)
    expect(h.polls()).toBe(p)
  })
})
