// channex-trail.test.ts — #347: lo que le pasa al transporte y al webhook queda en sync_log.
import { describe, it, expect } from 'bun:test'
import { createChannexHttp } from '../usecases/channex-http'
import { createChannexTrail, createPropertyResolver, describeHttpEvent, PLATFORM_HOTEL_ID } from '../usecases/channex-trail'
import { handleChannexWebhook } from '../usecases/channex-webhook'
import { listChannexLog, toSyncLogRow } from '../usecases/sync-log'

const jsonResponse = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** El transporte tipa `typeof fetch`; los fakes de acá ignoran los argumentos. */
const asFetch = (fn: (...a: any[]) => Promise<Response>) => fn as unknown as typeof fetch

function fakeClock(start = 0) { let t = start; return { now: () => t, advance: (ms: number) => { t += ms } } }

function fakeRepo() {
  const rows: any[] = []
  return {
    rows,
    create: async (r: any) => { rows.push(r); return r },
    paginate: async (filters: Record<string, unknown>, opts: { limit: number; offset?: number }) => {
      const data = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
      const offset = opts.offset ?? 0
      return { data: data.slice(offset, offset + opts.limit), total: data.length, limit: opts.limit, offset, pages: Math.ceil(data.length / opts.limit) }
    },
  }
}

const ariBody = (propertyId: string) => JSON.stringify({ values: [{ property_id: propertyId, rate_plan_id: 'rp', date: '2026-11-22', rate: '333' }] })

/** Espera a que las escrituras async del sink terminen. */
const flush = () => new Promise((r) => setTimeout(r, 5))

describe('describeHttpEvent — un evento del transporte se vuelve una fila legible', () => {
  it('throttled por property → warning con motivo y segundos', () => {
    const row = describeHttpEvent({ type: 'throttled', url: 'https://staging.channex.io/api/v1/availability', endpoint: 'availability', propertyIds: ['p1'], waitMs: 25_400, reason: 'property' })
    expect(row.action).toBe('channex_throttled')
    expect(row.status).toBe('warning')
    expect(row.details.waitSec).toBe(25.4)
    expect(String(row.details.reason)).toContain('property')
    expect(row.details.path).toBe('/api/v1/availability')
  })

  it('429 con reintento → warning; sin reintento → error "reintentos agotados"', () => {
    const conRetry = describeHttpEvent({ type: 'rate_limited', url: 'https://x/restrictions', endpoint: 'restrictions', propertyIds: ['p1'], status: 429, attempt: 0, retryAfter: '2', backoffMs: 2000, willRetry: true })
    expect(conRetry.action).toBe('channex_rate_limited'); expect(conRetry.status).toBe('warning'); expect(conRetry.details.attempt).toBe(1)
    const agotado = describeHttpEvent({ type: 'rate_limited', url: 'https://x/restrictions', endpoint: 'restrictions', propertyIds: ['p1'], status: 429, attempt: 3, retryAfter: null, backoffMs: 4000, willRetry: false })
    expect(agotado.action).toBe('channex_retry_exhausted'); expect(agotado.status).toBe('error')
  })

  it('4xx definitivo → channex_rejected con el detalle de Channex acotado', () => {
    const row = describeHttpEvent({ type: 'client_error', url: 'https://x/restrictions', endpoint: 'restrictions', propertyIds: ['p1'], status: 422, body: { errors: { details: { rate: ['must be greater than 0'] } } } })
    expect(row.action).toBe('channex_rejected')
    expect(row.status).toBe('error')
    expect(String(row.details.error)).toContain('greater than 0')
  })
})

describe('createChannexTrail + transporte — el sink escribe en sync_log con el hotel de la property', () => {
  it('un push retenido por el rate limit deja fila channex_throttled en el hotel dueño', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async (pid) => (pid === 'prop-A' ? 'hotel-A' : null) })
    const clock = fakeClock()
    const http = createChannexHttp(asFetch(async () => jsonResponse(200, { data: [] })), {
      maxPerMinute: 1, windowMs: 60_000, now: clock.now, sleep: async (ms) => clock.advance(ms), onEvent: trail.onHttpEvent,
    })

    await http.request('https://x/availability', { method: 'POST', body: ariBody('prop-A') })
    await http.request('https://x/availability', { method: 'POST', body: ariBody('prop-A') })   // el 2.º espera
    await flush()

    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0].hotelId).toBe('hotel-A')
    expect(repo.rows[0].action).toBe('channex_throttled')
    expect(repo.rows[0].status).toBe('warning')
    expect(repo.rows[0].details.reason).toContain('global')
  })

  it('429 y después 200: fila del 429 (con reintento) + la espera de la pausa de 60 s antes del reintento', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async () => 'hotel-A' })
    const clock = fakeClock()
    let calls = 0
    const http = createChannexHttp(asFetch(async () => { calls++; return calls === 1 ? jsonResponse(429, {}, { 'retry-after': '1' }) : jsonResponse(200, { data: [] }) }), {
      maxPerMinute: 100, now: clock.now, sleep: async (ms) => clock.advance(ms), onEvent: trail.onHttpEvent,
    })
    const res = await http.request('https://x/restrictions', { method: 'POST', body: ariBody('prop-A') })
    await flush()
    expect(res.ok).toBe(true)
    expect(repo.rows.map((r) => r.action)).toEqual(['channex_rate_limited', 'channex_throttled'])
    expect(repo.rows[0].details.httpStatus).toBe(429)
    expect(repo.rows[0].details.willRetry).toBe(true)
    expect(repo.rows[1].details.reason).toContain('pausa de 60 s')   // el reintento esperó la pausa por 429 (#294)
  })

  it('reintentos agotados → fila error channex_retry_exhausted', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async () => 'hotel-A' })
    const clock = fakeClock()
    const http = createChannexHttp(asFetch(async () => jsonResponse(503, {})), { maxPerMinute: 100, retries: 1, now: clock.now, sleep: async (ms) => clock.advance(ms), onEvent: trail.onHttpEvent })
    const res = await http.request('https://x/restrictions', { method: 'POST', body: ariBody('prop-A') })
    await flush()
    expect(res.ok).toBe(false)
    expect(repo.rows.map((r) => r.action)).toEqual(['channex_server_error', 'channex_retry_exhausted'])
    expect(repo.rows[1].status).toBe('error')
  })

  it('sin property en el body (GET, CRUD) la fila va a platform', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async () => 'hotel-A' })
    const http = createChannexHttp(asFetch(async () => jsonResponse(404, { errors: { title: 'Not Found' } })), { maxPerMinute: 100, onEvent: trail.onHttpEvent })
    await http.request('https://x/room_types/zzz', { method: 'GET' })
    await flush()
    expect(repo.rows[0].hotelId).toBe(PLATFORM_HOTEL_ID)
    expect(repo.rows[0].action).toBe('channex_rejected')
  })

  it('si el repo lanza, el push sigue y no explota', async () => {
    const trail = createChannexTrail({ syncLogRepo: { create: async () => { throw new Error('db caída') } }, resolveHotel: async () => 'hotel-A' })
    const http = createChannexHttp(asFetch(async () => jsonResponse(400, {})), { maxPerMinute: 100, onEvent: trail.onHttpEvent })
    const res = await http.request('https://x/restrictions', { method: 'POST', body: ariBody('prop-A') })
    await flush()
    expect(res.status).toBe(400)
  })

  it('un sink que lanza tampoco frena el request', async () => {
    const http = createChannexHttp(asFetch(async () => jsonResponse(400, {})), { maxPerMinute: 100, onEvent: () => { throw new Error('sink roto') } })
    const res = await http.request('https://x/restrictions', { method: 'POST', body: ariBody('prop-A') })
    expect(res.status).toBe(400)
  })
})

describe('createPropertyResolver — property → hotel con caché', () => {
  it('consulta Canales por channexPropertyId una sola vez dentro del TTL', async () => {
    let queries = 0
    const clock = fakeClock()
    const resolve = createPropertyResolver(async (_m, q) => { queries++; return q.channexPropertyId === 'p1' ? [{ hotelId: 'h1' }] : [] }, 1000, clock.now)
    expect(await resolve('p1')).toBe('h1')
    expect(await resolve('p1')).toBe('h1')
    expect(await resolve('p2')).toBeNull()
    expect(queries).toBe(2)
    clock.advance(1001)
    await resolve('p1')
    expect(queries).toBe(3)
  })
})

describe('webhook + trail — cada callback deja rastro', () => {
  const SECRETO = 's3cr3t'
  const store = { read: async () => ({ webhookSecret: SECRETO }), write: async () => {} }

  it('ingestada → webhook_ingested en el hotel de la property', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async () => 'hotel-A' })
    const res = await handleChannexWebhook(
      { store, ingestRevision: async () => ({ success: true, errors: [] }), trail, logger: { info() {}, warn() {}, error() {} } },
      { headers: { 'api-key': SECRETO }, body: { event: 'booking_new', payload: { booking_id: 'b', property_id: 'prop-A', revision_id: 'rev-1' }, user_id: null } },
    )
    await flush()
    expect(res.status).toBe(200)
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]).toMatchObject({ hotelId: 'hotel-A', action: 'webhook_ingested', status: 'success' })
    expect(repo.rows[0].details.revisionId).toBe('rev-1')
  })

  it('credencial inválida → webhook_rejected en platform', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async () => 'hotel-A' })
    const res = await handleChannexWebhook(
      { store, ingestRevision: async () => ({ success: true, errors: [] }), trail, logger: { info() {}, warn() {}, error() {} } },
      { headers: { 'api-key': 'mala' }, body: { event: 'booking_new' } },
    )
    await flush()
    expect(res.status).toBe(401)
    expect(repo.rows[0]).toMatchObject({ hotelId: PLATFORM_HOTEL_ID, action: 'webhook_rejected', status: 'error' })
  })

  it('sin payload con plan B → webhook_feed_fallback (warning)', async () => {
    const repo = fakeRepo()
    const trail = createChannexTrail({ syncLogRepo: repo, resolveHotel: async () => 'hotel-A' })
    await handleChannexWebhook(
      { store, ingestRevision: async () => ({ success: true, errors: [] }), syncFeed: async () => ({ success: true, errors: [] }), trail, logger: { info() {}, warn() {}, error() {} } },
      { headers: { 'api-key': SECRETO }, body: { event: 'booking_new', property_id: 'prop-A', user_id: null } },
    )
    await flush()
    expect(repo.rows[0]).toMatchObject({ hotelId: 'hotel-A', action: 'webhook_feed_fallback', status: 'warning' })
  })
})

describe('listChannexLog — registro paginado del admin', () => {
  it('pagina en la consulta, filtra por hotel/estado/acción y etiqueta la acción', async () => {
    const repo = fakeRepo()
    for (let i = 0; i < 7; i++) await repo.create({ id: `r${i}`, hotelId: i % 2 ? 'h1' : 'platform', action: i % 2 ? 'channex_throttled' : 'ingest_bookings_cron', status: i % 2 ? 'warning' : 'success', details: { waitMs: 100, waitSec: 0.1 }, createdAt: `2026-09-12T10:00:0${i}Z` })

    const todo = await listChannexLog(repo, { limit: 3, page: 2 })
    expect(todo.total).toBe(7); expect(todo.pages).toBe(3); expect(todo.items).toHaveLength(3)

    const soloH1 = await listChannexLog(repo, { hotelId: 'h1', status: 'warning' })
    expect(soloH1.total).toBe(3)
    expect(soloH1.items[0].action).toBe('Channex: push en espera por límite de peticiones')
    expect(soloH1.items[0].actionKey).toBe('channex_throttled')
    expect(soloH1.items[0].details).not.toContain('waitMs')     // oculto: ya está como segundos

    const accionInvalida = await listChannexLog(repo, { action: 'DROP TABLE' })
    expect(accionInvalida.total).toBe(7)                       // se ignora, no se filtra por texto libre
  })

  it('toSyncLogRow conserva la clave cruda además de la etiqueta', () => {
    const row = toSyncLogRow({ id: '1', hotelId: 'h', action: 'webhook_ingested', status: 'success', details: { revisionId: 'r' }, createdAt: 'x' })
    expect(row.actionKey).toBe('webhook_ingested')
    expect(row.action).toContain('Webhook')
    expect(row.details).toBe('revisión: r')
  })
})
