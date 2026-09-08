// ari-outbox/tests/rate-limit.e2e.test.ts — CA-7: meter la outbox en el camino NO rompe el límite
// de ~20 ARI updates por minuto que exige Channex (test 12 de la certificación).
//
// El riesgo real del cambio: el coalescer en memoria disparaba los pushes uno por uno a medida que
// vencían sus timers, mientras que el drain de la outbox agarra TODAS las filas vencidas de golpe
// —un deploy después de un rato caído puede juntar decenas— y las publica en un for. Si ese for
// esquivara el limiter de `createChannexHttp`, la primera pasada del worker nos metería en 429 y
// Channex nos suspendería la conexión.
//
// Por eso el test es end-to-end sobre el camino completo (schedule → drain → publisher →
// createChannexHttp → fetch) y afirma sobre los timestamps de las llamadas que EFECTIVAMENTE
// salieron. No hace falta DB: lo que se mide es el ritmo, no la persistencia (esa es restart.e2e).
// Reloj y sleep falsos —el mismo patrón de canales/tests/channex-http.test.ts—: el test corre en
// milisegundos y verifica los intervalos que se habrían esperado de verdad.

import { describe, it, expect } from 'bun:test'
import { createChannexHttp } from '../../canales/usecases/channex-http'
import { AriOutbox, type AriOutboxPort } from '../usecases/outbox-queue'
import type { AriOutboxRow } from '../types'

const MAX_PER_MINUTE = 18 // el margen bajo los 20/min de Channex que ya usa el transporte
const WINDOW_MS = 60_000
const DEBOUNCE_MS = 1500

const jsonResponse = () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })

function fakeClock(start = Date.parse('2026-09-07T10:00:00.000Z')) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

/** Puerto en memoria (el mismo de outbox-queue.test.ts): acá la tabla no aporta nada al criterio. */
function makePort(clock: { now: () => number }) {
  const rows: AriOutboxRow[] = []
  const port: AriOutboxPort = {
    async create(row) {
      const stored = { ...row, createdAt: new Date(clock.now()).toISOString(), updatedAt: new Date(clock.now()).toISOString() }
      rows.push(stored)
      return stored
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch, { updatedAt: new Date(clock.now()).toISOString() })
      return row ?? null
    },
    async findMany(query) {
      return rows.filter((r) => Object.entries(query).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
    },
  }
  return { port, rows }
}

/** Arma el camino real: outbox → publisher → transporte de Channex → fetch falso. */
function makeEscenario(maxPerMinute = MAX_PER_MINUTE) {
  const clock = fakeClock()
  const { port, rows } = makePort(clock)
  const salidas: Array<{ url: string; method: string; at: number }> = []
  const sleeps: number[] = []
  const http = createChannexHttp(
    (async (url: any, init: any) => {
      // Se registra acá y no en el publisher: lo que le importa a Channex es la llamada que sale
      // por el cable, después de que el limiter la haya dejado pasar.
      salidas.push({ url: String(url), method: String(init?.method ?? 'GET'), at: clock.now() })
      return jsonResponse()
    }) as unknown as typeof fetch, // el fake no implementa `preconnect`, que el tipo global exige
    {
      maxPerMinute,
      windowMs: WINDOW_MS,
      now: clock.now,
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms) }, // el sleep falso corre el reloj
    },
  )
  const outbox = new AriOutbox({ repo: port, now: clock.now, debounceMs: DEBOUNCE_MS, newId: () => `row-${rows.length + 1}` })
  return { clock, outbox, rows, http, salidas, sleeps }
}

const ariUpdates = (salidas: Array<{ url: string; method: string; at: number }>) =>
  salidas.filter((s) => s.method === 'POST' && /\/(availability|restrictions)$/.test(s.url)).map((s) => s.at)

describe('CA-7 — la outbox respeta el rate limit de ARI de Channex', () => {
  it('40 hoteles encolados y drenados de una sola pasada no superan las 18 llamadas por minuto', async () => {
    const { clock, outbox, rows, http, salidas } = makeEscenario()
    outbox.registerPublisher('rates', {
      push: async (hotelId) => {
        // El publisher real hace exactamente esto: un ARI update por el transporte compartido.
        await http.request(`https://api.channex.io/api/v1/${hotelId}/availability`, { method: 'POST', body: '{}' })
      },
    })

    // 40 HOTELES distintos: la agrupación de la outbox es por (hotel, kind), así que son 40 filas
    // y 40 pushes de verdad — no hay coalescing que disimule el problema.
    for (let i = 0; i < 40; i++) await outbox.schedule(`hotel-${i}`, 'rates')
    expect(rows).toHaveLength(40)

    clock.advance(DEBOUNCE_MS) // vencen todas juntas: el peor caso para el limiter
    expect(await outbox.drain()).toBe(40)

    const ts = ariUpdates(salidas)
    expect(ts).toHaveLength(40) // ninguna se perdió: el limiter espera, no descarta
    expect(rows.every((r) => r.status === 'sent')).toBe(true)

    // El criterio, medido sobre la ventana deslizante: entre una llamada y la número 18 posterior
    // tiene que haber pasado al menos un minuto.
    for (let i = 0; i + MAX_PER_MINUTE < ts.length; i++) {
      expect(ts[i + MAX_PER_MINUTE]! - ts[i]!).toBeGreaterThanOrEqual(WINDOW_MS)
    }
    // Y el drain no se acelera solo: 40 llamadas a 18/min no pueden caber en menos de dos ventanas.
    expect(ts[ts.length - 1]! - ts[0]!).toBeGreaterThanOrEqual(2 * WINDOW_MS)
  })

  it('los GET y el CRUD de contenido del publisher no consumen budget de ARI', async () => {
    // Es lo que hoy evita que un full sync se auto-bloquee: si el limiter contara todo el tráfico,
    // leer room_types y crear rate_plans se comería la cuota antes del primer push de tarifas.
    const { clock, outbox, http, salidas, sleeps } = makeEscenario(2)
    outbox.registerPublisher('rates', {
      push: async (hotelId) => {
        await http.request(`https://api.channex.io/api/v1/room_types?hotel=${hotelId}`, { method: 'GET' })
        await http.request('https://api.channex.io/api/v1/rate_plans', { method: 'POST', body: '{}' })
        await http.request(`https://api.channex.io/api/v1/${hotelId}/availability`, { method: 'POST', body: '{}' })
      },
    })

    await outbox.schedule('hotel-a', 'rates')
    await outbox.schedule('hotel-b', 'rates')
    clock.advance(DEBOUNCE_MS)
    await outbox.drain()

    expect(salidas).toHaveLength(6)          // 2 hoteles × (GET + POST contenido + POST availability)
    expect(ariUpdates(salidas)).toHaveLength(2)
    expect(sleeps).toEqual([])               // con budget 2, los 2 ARI updates entraron sin esperar
  })
})
