// channex-http.test.ts — Test 12 de la certificación: rate limit + backoff en 429/5xx.
// El reloj y el sleep son falsos: los tests corren instantáneos y verifican los
// INTERVALOS que se esperarían, no que pasara tiempo real.
import { describe, it, expect } from 'bun:test'
import { createChannexHttp } from '../usecases/channex-http'

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

    await http.request('https://x/1', { method: 'GET' })
    await http.request('https://x/2', { method: 'GET' })
    const third = http.request('https://x/3', { method: 'GET' })
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

    await http.request('https://x/1', { method: 'GET' })
    clock.advance(60_001)        // la ventana entera expiró
    await http.request('https://x/2', { method: 'GET' })
    expect(calls).toBe(2)        // sin bloqueo: no hizo falta dormir
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
