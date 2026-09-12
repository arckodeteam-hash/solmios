// channex-http.test.ts — Test 12 de la certificación: rate limit + backoff en 429/5xx.
// El reloj y el sleep son falsos: los tests corren instantáneos y verifican los
// INTERVALOS que se esperarían, no que pasara tiempo real.
import { describe, it, expect } from 'bun:test'
import { createChannexHttp, MAX_PER_PROPERTY_PER_MINUTE, PROPERTY_PAUSE_ON_429_MS } from '../usecases/channex-http'

const jsonResponse = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function fakeClock(start = 0) {
  let t = start
  return {
    now: () => t,
    advance: (ms: number) => { t += ms },
  }
}

function makeTransport(fetchImpl: any, clock: ReturnType<typeof fakeClock>, maxPerMinute: number) {
  const sleeps: number[] = []
  const http = createChannexHttp(fetchImpl, {
    maxPerMinute,
    windowMs: 60_000,
    now: clock.now,
    sleep: async (ms) => { sleeps.push(ms); clock.advance(ms) },
  })
  return { http, sleeps }
}

describe('createChannexHttp — rate limit (test 12)', () => {
  it('bloquea cuando la ventana se llena y libera al expirar el request más viejo', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 2)

    await http.request('https://x/availability', { method: 'POST' })
    await http.request('https://x/availability', { method: 'POST' })
    const third = http.request('https://x/availability', { method: 'POST' })
    expect(calls).toBe(2)        // el tercero NO salió: ventana llena
    await third
    expect(calls).toBe(3)        // salió tras esperar lo que le faltaba al más viejo
    expect(sleeps.length).toBeGreaterThan(0)
    expect(sleeps[0]).toBeGreaterThan(59_000)       // lo que le faltaba al más viejo (~60s)
    expect(sleeps[0]).toBeLessThanOrEqual(60_010)   // + el margen fijo de 5ms del limiter
  })

  it('una vez expirada la ventana, hay budget de nuevo', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 2)

    await http.request('https://x/restrictions', { method: 'POST' })
    clock.advance(60_001)        // la ventana entera expiró
    await http.request('https://x/restrictions', { method: 'POST' })
    expect(calls).toBe(2)        // sin bloqueo: no hizo falta dormir
  })

  it('el límite aplica SOLO a los ARI updates, no a GETs ni CRUD de contenido', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 1)

    // Dos ARI updates llenan la ventana (max 1)…
    await http.request('https://x/availability', { method: 'POST' })
    // …pero GETs y POSTs de contenido pasan sin bloqueo (el sync no se auto-limita).
    await http.request('https://x/room_types', { method: 'GET' })
    await http.request('https://x/rate_plans', { method: 'POST' })
    expect(calls).toBe(3)
    expect(sleeps).toEqual([])
  })
})

describe('createChannexHttp — backoff en 429/5xx (test 12)', () => {
  it('429 con Retry-After: reintenta tras esperar LO QUE DICE CHANNEX y devuelve el resultado', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => {
      calls++
      if (calls === 1) return jsonResponse(429, { errors: 'rate limited' }, { 'retry-after': '2' })
      return jsonResponse(200, { data: { ok: true } })
    }, clock, 10)

    const res = await http.request('https://x/rate', { method: 'POST' })
    expect(res.ok).toBe(true)
    expect(calls).toBe(2)
    expect(sleeps).toEqual([2000]) // Retry-After: 2s manda sobre el backoff exponencial
  })

  it('5xx transitorio: backoff exponencial y éxito en el reintento', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => {
      calls++
      if (calls <= 2) return jsonResponse(503, { errors: 'unavailable' })
      return jsonResponse(200, { data: [] })
    }, clock, 10)

    const res = await http.request('https://x/flaky', { method: 'POST' })
    expect(res.ok).toBe(true)
    expect(calls).toBe(3)
    expect(sleeps).toEqual([500, 1000]) // 500·2^0, 500·2^1
  })

  it('4xx definitivo (400): NO reintenta', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(400, { errors: { details: 'bad' } }) }, clock, 10)

    const res = await http.request('https://x/bad', { method: 'POST' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
    expect(calls).toBe(1)
    expect(sleeps).toEqual([])
  })

  it('error de red/timeout: reintenta y lanza al agotarlos', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; throw new Error('network down') }, clock, 10)

    await expect(http.request('https://x/dead', { method: 'GET' })).rejects.toThrow('network down')
    expect(calls).toBe(4) // 1 inicial + 3 reintentos
    expect(sleeps).toEqual([500, 1000, 2000])
  })

  it('429 persistente: agota reintentos y devuelve la última respuesta', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http } = makeTransport(async () => { calls++; return jsonResponse(429, {}, { 'retry-after': '1' }) }, clock, 10)

    const res = await http.request('https://x/rate', { method: 'POST' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(429)
    expect(calls).toBe(4)
  })
})

// ── #294: techo por property × endpoint (10/min cada POST según rate-limits.md de Channex) ──
const ariBody = (propertyId: string) =>
  JSON.stringify({ values: [{ property_id: propertyId, rate_plan_id: 'rp', date: '2026-11-22', rate: '333' }] })

const postAri = (http: ReturnType<typeof createChannexHttp>, endpoint: 'availability' | 'restrictions', propertyId: string) =>
  http.request(`https://x/${endpoint}`, { method: 'POST', body: ariBody(propertyId) })

describe('createChannexHttp — rate limit por property (#294)', () => {
  it(`bloquea el push ${MAX_PER_PROPERTY_PER_MINUTE + 1} de una property aunque el budget global tenga lugar`, async () => {
    const clock = fakeClock()
    let calls = 0
    // Global holgado (100): lo único que puede frenar es el techo por property.
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 100)

    for (let i = 0; i < MAX_PER_PROPERTY_PER_MINUTE; i++) await postAri(http, 'restrictions', 'prop-A')
    expect(calls).toBe(MAX_PER_PROPERTY_PER_MINUTE)
    expect(sleeps).toEqual([])

    const extra = postAri(http, 'restrictions', 'prop-A')
    expect(calls).toBe(MAX_PER_PROPERTY_PER_MINUTE)   // NO salió: la property agotó su minuto
    await extra
    expect(calls).toBe(MAX_PER_PROPERTY_PER_MINUTE + 1)
    expect(sleeps.length).toBe(1)
    expect(sleeps[0]).toBeGreaterThan(59_000)          // esperó a que expire el más viejo de ESA property
  })

  it('availability y restrictions de la MISMA property son budgets separados', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 100)

    for (let i = 0; i < MAX_PER_PROPERTY_PER_MINUTE; i++) await postAri(http, 'restrictions', 'prop-A')
    // restrictions agotado; availability de la misma property sigue teniendo lugar.
    await postAri(http, 'availability', 'prop-A')
    expect(calls).toBe(MAX_PER_PROPERTY_PER_MINUTE + 1)
    expect(sleeps).toEqual([])
  })

  it('otra property NO queda frenada por la que agotó su budget', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 100)

    for (let i = 0; i < MAX_PER_PROPERTY_PER_MINUTE; i++) await postAri(http, 'availability', 'prop-A')
    await postAri(http, 'availability', 'prop-B')
    expect(calls).toBe(MAX_PER_PROPERTY_PER_MINUTE + 1)
    expect(sleeps).toEqual([])
  })

  it('el techo global sigue mandando: con global=2, la tercera property espera', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 2)

    await postAri(http, 'availability', 'prop-A')
    await postAri(http, 'availability', 'prop-B')
    const third = postAri(http, 'availability', 'prop-C')
    expect(calls).toBe(2)
    await third
    expect(calls).toBe(3)
    expect(sleeps.length).toBe(1)
  })

  it('un 429 en un ARI update pausa ESA property 60 s (lo que pide la doc) sin tocar a las demás', async () => {
    const clock = fakeClock()
    const hits: string[] = []
    const { http, sleeps } = makeTransport(async (_u: string, init: RequestInit) => {
      const pid = (JSON.parse(String(init.body)) as { values: Array<{ property_id: string }> }).values[0]!.property_id
      hits.push(pid)
      // prop-A: 429 la primera vez, 200 después. prop-B: siempre 200.
      if (pid === 'prop-A' && hits.filter((h) => h === 'prop-A').length === 1) return jsonResponse(429, {}, { 'retry-after': '1' })
      return jsonResponse(200, { data: [] })
    }, clock, 100)

    const res = await postAri(http, 'restrictions', 'prop-A')
    expect(res.ok).toBe(true)
    expect(hits).toEqual(['prop-A', 'prop-A'])
    // Durmió el Retry-After (1 s) y DESPUÉS lo que faltaba de la pausa de 60 s antes de reintentar.
    expect(sleeps[0]).toBe(1000)
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(PROPERTY_PAUSE_ON_429_MS)

    // prop-B no fue castigada por el 429 de prop-A.
    const before = sleeps.length
    await postAri(http, 'restrictions', 'prop-B')
    expect(sleeps.length).toBe(before)
  })

  it('la pausa por 429 alcanza a los pushes SIGUIENTES de esa property, no solo al reintento', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => {
      calls++
      return calls === 1 ? jsonResponse(429, {}, { 'retry-after': '1' }) : jsonResponse(200, { data: [] })
    }, clock, 100)

    const t0 = clock.now()
    await postAri(http, 'availability', 'prop-A')      // 429 → pausa hasta t0+60s → reintento a >= t0+60s
    expect(clock.now() - t0).toBeGreaterThanOrEqual(PROPERTY_PAUSE_ON_429_MS)
    const sleptSoFar = sleeps.length
    await postAri(http, 'availability', 'prop-A')      // ya pasó la pausa: sale directo
    expect(sleeps.length).toBe(sleptSoFar)
    expect(calls).toBe(3)
  })

  it('un body ilegible o sin property_id cae al techo global solo (no se traba)', async () => {
    const clock = fakeClock()
    let calls = 0
    const { http, sleeps } = makeTransport(async () => { calls++; return jsonResponse(200, { data: [] }) }, clock, 100)

    for (let i = 0; i < MAX_PER_PROPERTY_PER_MINUTE + 3; i++) {
      await http.request('https://x/availability', { method: 'POST', body: 'not-json' })
    }
    expect(calls).toBe(MAX_PER_PROPERTY_PER_MINUTE + 3)
    expect(sleeps).toEqual([])
  })
})
