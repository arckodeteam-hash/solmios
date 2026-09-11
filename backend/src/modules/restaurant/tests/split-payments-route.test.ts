// restaurant/tests/split-payments-route.test.ts — #279 (regresión de #214): `GET /api/restaurant/orders/:id/payments`
// por la pila REAL: módulo montado sobre un Router real + `jsonOnlyCompression` (como composition-root.ts) +
// `NodeServer` del framework, que es quien arma el envelope (`buildEnvelope`, kernel/http/server.ts).
//
// Por qué contra el server y no `router.resolve`: el bug vivía en el envelope, no en el usecase. Un body
// `{ data: [...], total, balance }` se toma como lista paginada: `total` va a `meta.pagination` y `balance`
// se DESCARTA. Y depende del TAMAÑO: `compression()` reemplaza `res.body` por un Buffer gzip ANTES del
// envelope (deuda "Envelope roto cuando comprime" en CLAUDE.md), así que una respuesta >1KB salía cruda y
// conservaba `balance`, mientras que una comanda con 0 partes (73 bytes) lo perdía. Por eso se prueba con
// 0 partes y con N partes (>1KB), con y sin `Accept-Encoding: gzip`: la forma que lee el frontend tiene
// que ser la misma en los cuatro caminos.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { Router, NodeServer } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { jsonOnlyCompression } from '../../../shared/middlewares/compression'
import { RestaurantModule } from '../index'

type Row = Record<string, any>
const AT = '2026-09-11T18:35:00.000Z'

// 10 partes cobradas de $10: el JSON supera el umbral de 1KB de compression() con margen.
const MANY = Array.from({ length: 10 }, (_, i) => ({
  id: `part-${i + 1}`, hotelId: 'h1', orderId: 'o-many', seq: i + 1, method: i % 2 ? 'card' : 'cash', amount: 10, tip: 1,
  status: 'completed', paymentId: `pay-${i + 1}`, lineIds: null, createdBy: 'user-waiter', createdAt: AT, updatedAt: AT,
}))

function mount() {
  const rows: Record<string, Row[]> = {
    Roles: [],
    Users: [{ id: 'user-waiter', hotelId: 'h1', role: 'waiter', active: 1, name: 'Carlos Mozo' }],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', currency: 'DOP' }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RestaurantOrders: [
      { id: 'o-empty', hotelId: 'h1', number: 'CMD-1', status: 'sent', subtotal: 100, tax: 18, tip: 0, total: 118, amountPaid: 0, amountReserved: 0, linesLockedUntil: '' },
      { id: 'o-many', hotelId: 'h1', number: 'CMD-2', status: 'sent', subtotal: 100, tax: 18, tip: 0, total: 118, amountPaid: 100, amountReserved: 0, linesLockedUntil: '' },
    ],
    RestaurantOrderPayments: MANY,
  }
  const table = (t: string) => (rows[t] ??= [])
  const matches = (r: Row, f?: Row) => Object.entries(f ?? {}).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    findMany: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)),
    findById: async (t: string, id: string) => table(t).find((r) => r.id === id) ?? null,
    findOne: async (t: string, f?: Row) => table(t).find((r) => matches(r, f)) ?? null,
    create: async (t: string, d: Row) => { const row = { id: `gen-${table(t).length + 1}`, ...d }; table(t).push(row); return row },
    update: async (t: string, id: string, d: Row) => { const cur = table(t).find((r) => r.id === id); if (!cur) return null; Object.assign(cur, d); return cur },
    delete: async () => true,
    count: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)).length,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
  }
  const router = new Router()
  router.use(jsonOnlyCompression({ threshold: 1024 }))   // mismo umbral que composition-root.ts
  const auth = makeAuth()
  ;(RestaurantModule() as any).create({ logger: fakeLogger(), orm, router, auth })
  return { router, auth }
}

let server: NodeServer
let base = ''
let auth: ReturnType<typeof makeAuth>

beforeAll(async () => {
  const m = mount()
  auth = m.auth
  server = new NodeServer(0, fakeLogger())
  await server.start((req) => m.router.resolve(req.method, req.path, req))
  base = `http://127.0.0.1:${server.getPort()}`
})
afterAll(async () => { await server.stop() })

type Envelope = { success: boolean; data: any; meta: any; error: any }

async function getPayments(orderId: string, gzip: boolean): Promise<{ status: number; body: Envelope; encoding: string | null }> {
  const res = await fetch(`${base}/api/restaurant/orders/${orderId}/payments`, {
    headers: { ...bearer(auth, 'waiter', 'h1'), 'accept-encoding': gzip ? 'gzip' : 'identity' },
  })
  return { status: res.status, body: (await res.json()) as Envelope, encoding: res.headers.get('content-encoding') }
}

const EMPTY_BALANCE = { due: 118, paid: 0, pending: 0, outstanding: 118, tips: 0 }
const MANY_BALANCE = { due: 118, paid: 100, pending: 0, outstanding: 18, tips: 10 }

describe('#279 — GET /api/restaurant/orders/:id/payments: el envelope conserva `balance`', () => {
  it('0 partes (respuesta chica, pasa por buildEnvelope): data.parts = [] y data.balance.due', async () => {
    const { status, body } = await getPayments('o-empty', false)
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.parts).toEqual([])
    expect(body.data.balance).toEqual(EMPTY_BALANCE)
    expect(body.data.balance.due).toBe(118)
    // No es una lista paginada: nada en meta.pagination, nada de `data`/`total` sueltos en el primer nivel.
    expect(body.meta).toBeNull()
    expect(Array.isArray(body.data)).toBe(false)
  })

  it('0 partes con Accept-Encoding: gzip (queda bajo el umbral: misma forma)', async () => {
    const { body, encoding } = await getPayments('o-empty', true)
    expect(encoding).toBeNull()
    expect(body.data.parts).toEqual([])
    expect(body.data.balance.due).toBe(118)
  })

  it('10 partes sin gzip (>1KB pero sin compresión: pasa por buildEnvelope): parts ordenadas por seq + balance', async () => {
    const { body, encoding } = await getPayments('o-many', false)
    expect(encoding).toBeNull()
    expect(body.success).toBe(true)
    expect(body.data.parts.map((p: Row) => p.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(body.data.balance).toEqual(MANY_BALANCE)
    expect(body.meta).toBeNull()
  })

  it('10 partes con gzip (>1KB: compression() saltea el envelope): la forma tiene que ser LA MISMA', async () => {
    const plain = await getPayments('o-many', false)
    const gz = await getPayments('o-many', true)
    expect(gz.encoding).toBe('gzip')
    // Deuda del framework: el body comprimido sale sin envelope. Lo que sí se exige es que lo que
    // lee el frontend (`parts` + `balance`) esté en los dos, con el mismo contenido.
    const unwrap = (b: Envelope) => ('success' in b && b.data && !Array.isArray(b.data) ? b.data : b)
    expect(unwrap(gz.body).parts).toEqual(unwrap(plain.body).parts)
    expect(unwrap(gz.body).balance).toEqual(MANY_BALANCE)
    expect(unwrap(plain.body).balance).toEqual(MANY_BALANCE)
  })
})
