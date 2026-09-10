// REQ-MON-01 — instrumentación HTTP: ruta normalizada, agregado en memoria con techo y middleware
// que mide sin cambiar jamás la respuesta de next().
import { describe, it, expect } from 'bun:test'
import { Router, NotFoundError, ValidationError, RateLimitError, ConflictError } from 'arckode-framework'
import { normalizeRouteKey } from '../observability/route-key'
import { HttpMetricsStore, MAX_ROUTES, OTHER_ROUTE_KEY } from '../observability/metrics'
import { httpMetrics, type ErrorEvent } from '../observability/http-metrics'

const UUID = '9f8e7d6c-1a2b-4c3d-8e9f-0a1b2c3d4e5f'
const ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const reqOf = (method: string, path: string, user?: unknown): any => ({ method, path, headers: {}, user })
const ok = async () => ({ status: 200, body: { ok: true } })

/** Reloj falso: cada llamada avanza `stepMs` para que la duración medida sea determinista. */
function fakeClock(stepMs: number) {
  let t = 0
  return () => { t += stepMs; return t }
}

describe('normalizeRouteKey (1.1)', () => {
  it('colapsa UUID, ULID y números en :id y deja intactas las rutas fijas', () => {
    expect(normalizeRouteKey(`/api/reservas/${UUID}/charges`)).toBe('/api/reservas/:id/charges')
    expect(normalizeRouteKey('/api/reservas/44')).toBe('/api/reservas/:id')
    expect(normalizeRouteKey(`/api/reservas/${ULID}`)).toBe('/api/reservas/:id')
    expect(normalizeRouteKey('/api/hoteles')).toBe('/api/hoteles')
  })

  it('ignora query string y hash; path vacío → /', () => {
    expect(normalizeRouteKey('/api/reservas/44?page=2#x')).toBe('/api/reservas/:id')
    expect(normalizeRouteKey('')).toBe('/')
  })
})

describe('HttpMetricsStore (1.2)', () => {
  it('3 peticiones → 2 rutas, /api/reservas/:id con count 2', () => {
    const store = new HttpMetricsStore()
    store.record({ method: 'GET', route: '/api/reservas/:id', status: 200, durationMs: 10 })
    store.record({ method: 'GET', route: '/api/reservas/:id', status: 500, durationMs: 30 })
    store.record({ method: 'GET', route: '/api/hoteles', status: 200, durationMs: 5 })
    const snap = store.snapshot()
    expect(snap.rutas).toHaveLength(2)
    const reservas = snap.rutas.find((r) => r.ruta === '/api/reservas/:id')!
    expect(reservas.count).toBe(2)
    expect(reservas.errors).toBe(1)
    expect(reservas.avgMs).toBe(20)
    expect(reservas.maxMs).toBe(30)
    expect(snap.totales.peticiones).toBe(3)
    expect(snap.totales.erroresPct).toBe(33.3)
    expect(snap.totales.avgMs).toBe(15)
    expect(Number.isNaN(Date.parse(snap.ventanaDesde))).toBe(false)
  })

  it('p95 sale de las muestras, no del promedio', () => {
    const store = new HttpMetricsStore()
    for (let i = 1; i <= 100; i++) store.record({ method: 'GET', route: '/x', status: 200, durationMs: i })
    const [ruta] = store.snapshot().rutas
    expect(ruta!.p95Ms).toBe(95)
    expect(ruta!.avgMs).toBe(50.5)
  })

  it('superado MAX_ROUTES el mapa no crece: los patrones nuevos caen en "otras"', () => {
    const store = new HttpMetricsStore()
    for (let i = 0; i < MAX_ROUTES; i++) store.record({ method: 'GET', route: `/r${i}`, status: 200, durationMs: 1 })
    expect(store.snapshot().rutas).toHaveLength(MAX_ROUTES)
    for (let i = 0; i < 50; i++) store.record({ method: 'GET', route: `/nueva${i}`, status: 503, durationMs: 1 })
    const snap = store.snapshot()
    expect(snap.rutas).toHaveLength(MAX_ROUTES + 1)
    const otras = snap.rutas.find((r) => r.ruta === OTHER_ROUTE_KEY)!
    expect(otras.count).toBe(50)
    expect(otras.errors).toBe(50)
    // una ruta ya conocida sigue acumulando en su propio bucket
    store.record({ method: 'GET', route: '/r0', status: 200, durationMs: 1 })
    expect(store.snapshot().rutas.find((r) => r.ruta === '/r0')!.count).toBe(2)
  })

  it('reset vacía el agregado y reinicia la ventana', () => {
    const store = new HttpMetricsStore()
    store.record({ method: 'GET', route: '/x', status: 200, durationMs: 1 })
    store.reset()
    expect(store.snapshot().rutas).toHaveLength(0)
    expect(store.snapshot().totales.peticiones).toBe(0)
  })
})

describe('httpMetrics middleware (1.3, 2.2, 2.4)', () => {
  it('mide 3 peticiones reales y agrega por ruta normalizada', async () => {
    const store = new HttpMetricsStore()
    const mw = httpMetrics(store, { now: fakeClock(10) })
    expect((await mw(reqOf('GET', `/api/reservas/${UUID}`), ok)).status).toBe(200)
    expect((await mw(reqOf('GET', '/api/reservas/44'), ok)).status).toBe(200)
    expect((await mw(reqOf('GET', '/api/hoteles'), ok)).status).toBe(200)
    const snap = store.snapshot()
    expect(snap.rutas).toHaveLength(2)
    const reservas = snap.rutas.find((r) => r.ruta === '/api/reservas/:id')!
    expect(reservas.count).toBe(2)
    expect(reservas.avgMs).toBe(10)
  })

  it('una excepción del handler se relanza al cliente Y queda registrada (store + sink)', async () => {
    const store = new HttpMetricsStore()
    const events: ErrorEvent[] = []
    const mw = httpMetrics(store, { onError: (e) => { events.push(e) } })
    const boom = async () => { throw new Error('se rompió') }
    await expect(mw(reqOf('POST', '/api/reservas/44', { hotelId: 'h1' }), boom)).rejects.toThrow('se rompió')
    const ruta = store.snapshot().rutas[0]!
    expect(ruta.ruta).toBe('/api/reservas/:id')
    expect(ruta.errors).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ method: 'POST', path: '/api/reservas/:id', statusCode: 500, message: 'se rompió', hotelId: 'h1' })
    expect(events[0]!.stack).toContain('se rompió')
  })

  it('un ErrorContract lanzado se registra con su httpStatus (como hará el Router) y NO despierta al sink', async () => {
    const store = new HttpMetricsStore()
    const events: ErrorEvent[] = []
    const mw = httpMetrics(store, { onError: (e) => { events.push(e) } })
    await expect(mw(reqOf('GET', '/api/reservas/44'), async () => { throw new NotFoundError('Reserva no encontrada') })).rejects.toBeInstanceOf(NotFoundError)
    await expect(mw(reqOf('POST', '/api/reservas'), async () => { throw new ValidationError('Fecha inválida') })).rejects.toBeInstanceOf(ValidationError)
    await expect(mw(reqOf('POST', '/api/reservas'), async () => { throw new ConflictError('Ya existe') })).rejects.toBeInstanceOf(ConflictError)
    const snap = store.snapshot()
    expect(snap.totales.peticiones).toBe(3)
    expect(snap.totales.erroresPct).toBe(0)
    expect(store.snapshot().rutas.every((r) => r.errors === 0)).toBe(true)
    expect(events).toHaveLength(0)
  })

  it('un RateLimitError lanzado se registra como 429 y sí avisa al sink (igual que una respuesta 429)', async () => {
    const store = new HttpMetricsStore()
    const events: ErrorEvent[] = []
    const mw = httpMetrics(store, { onError: (e) => { events.push(e) } })
    await expect(mw(reqOf('GET', '/x'), async () => { throw new RateLimitError('Demasiadas peticiones') })).rejects.toBeInstanceOf(RateLimitError)
    expect(events).toEqual([expect.objectContaining({ statusCode: 429, message: 'Demasiadas peticiones' })])
    expect(store.snapshot().totales.erroresPct).toBe(0)
  })

  it('avisa al sink en 5xx y 429, no en 4xx comunes', async () => {
    const store = new HttpMetricsStore()
    const events: ErrorEvent[] = []
    const mw = httpMetrics(store, { onError: (e) => { events.push(e) } })
    await mw(reqOf('GET', '/a'), async () => ({ status: 404, body: { error: 'No encontrado' } }))
    await mw(reqOf('GET', '/b'), async () => ({ status: 429, body: { message: 'Demasiadas peticiones' } }))
    await mw(reqOf('GET', '/c'), async () => ({ status: 503 }))
    expect(events.map((e) => [e.statusCode, e.message])).toEqual([[429, 'Demasiadas peticiones'], [503, 'HTTP 503']])
    expect(store.snapshot().totales.peticiones).toBe(3)
  })

  it('devuelve la respuesta de next() aunque el store o el sink fallen', async () => {
    const brokenStore = { record: () => { throw new Error('store roto') } } as unknown as HttpMetricsStore
    const mw = httpMetrics(brokenStore, {
      onError: () => { throw new Error('sink roto') },
    })
    const res = await mw(reqOf('GET', '/x'), async () => ({ status: 500, body: { error: 'x' } }))
    expect(res).toEqual({ status: 500, body: { error: 'x' } })
    // la excepción del handler sigue llegando al cliente, no la del store
    await expect(mw(reqOf('GET', '/x'), async () => { throw new Error('del handler') })).rejects.toThrow('del handler')
  })

  it('un sink asíncrono que rechaza no bloquea ni tumba la petición', async () => {
    const store = new HttpMetricsStore()
    let called = 0
    const mw = httpMetrics(store, { onError: async () => { called++; throw new Error('repo caído') } })
    const res = await mw(reqOf('GET', '/x'), async () => ({ status: 500 }))
    expect(res.status).toBe(500)
    expect(called).toBe(1)
    await Promise.resolve() // el rechazo se traga sin unhandled rejection
  })

  it('integración con Router.resolve: la respuesta HTTP y el status registrado coinciden', async () => {
    const store = new HttpMetricsStore()
    const events: ErrorEvent[] = []
    const router = new Router()
    router.use(httpMetrics(store, { onError: (e) => { events.push(e) } }))
    router.get('/api/reservas/:id', async () => { throw new NotFoundError('Reserva no encontrada') })
    router.post('/api/reservas', async () => { throw new ValidationError('Fecha inválida') })
    router.get('/api/boom', async () => { throw new Error('se rompió') })
    router.get('/api/ok', async () => ({ status: 200, body: { ok: true } }))

    const notFound = await router.resolve('GET', '/api/reservas/44')
    const invalid = await router.resolve('POST', '/api/reservas')
    const boom = await router.resolve('GET', '/api/boom')
    const fine = await router.resolve('GET', '/api/ok')
    expect([notFound.status, invalid.status, boom.status, fine.status]).toEqual([404, 400, 500, 200])
    expect(notFound.body).toEqual({ error: 'Reserva no encontrada', code: 'NOT_FOUND' })

    const snap = store.snapshot()
    const byRoute = Object.fromEntries(snap.rutas.map((r) => [r.ruta, r]))
    expect(snap.totales.peticiones).toBe(4)
    expect(byRoute['/api/reservas/:id']!.errors).toBe(0)
    expect(byRoute['/api/reservas']!.errors).toBe(0)
    expect(byRoute['/api/boom']!.errors).toBe(1)
    expect(byRoute['/api/ok']!.errors).toBe(0)
    expect(snap.totales.erroresPct).toBe(25)
    // sólo el 500 real llega al sink: el 404/400 de negocio no
    expect(events.map((e) => [e.path, e.statusCode])).toEqual([['/api/boom', 500]])
  })
})
