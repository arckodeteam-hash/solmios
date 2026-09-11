// Restaurant.service.split.test.ts — #279: `listOrderPayments` con la respuesta REAL del endpoint.
//
// Por qué contra el envelope y no contra un mock del service: cobrar.test.ts mockea el service con un
// `balance` completo, así que nunca vio que el backend devolvía `{ data: [], meta: { pagination } }` sin
// `balance`. Acá se pasa por el `http.ts` real con `fetch` stubeado con los bytes que manda el servidor:
// el envelope del framework (`{success,data,meta,error}`) y también el cuerpo crudo que sale cuando la
// respuesta supera 1KB y `compression()` saltea el envelope (deuda documentada en CLAUDE.md).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RestaurantService, type OrderPaymentsList } from './Restaurant.service'

const BALANCE = { due: 118, paid: 100, pending: 0, outstanding: 18, tips: 10 }
const PART = { id: 'part-1', hotelId: 'h1', orderId: 'o-many', seq: 1, method: 'cash', amount: 10, tip: 1, status: 'completed', paymentId: 'pay-1', lineIds: null, createdBy: 'user-waiter', createdAt: '2026-09-11T18:35:00.000Z', updatedAt: '2026-09-11T18:35:00.000Z' }

/** Respuesta del backend tal cual la arma `buildEnvelope` (kernel/http/server.ts) para un body que no es lista. */
const ENVELOPE_FIXED = JSON.stringify({ success: true, data: { parts: [PART], balance: BALANCE }, meta: null, error: null })
/** Lo que respondía prod ANTES del fix (issue #279): `total` a `meta.pagination`, `balance` descartado. */
const ENVELOPE_BUGGY_PROD = '{"success":true,"data":[],"meta":{"pagination":{"total":0}},"error":null}'
/** Cuerpo crudo: >1KB con `Accept-Encoding: gzip` el server manda el body sin envelope (compression() antes de buildEnvelope). */
const RAW_COMPRESSED_PATH = JSON.stringify({ parts: [PART], balance: BALANCE })

function stubFetch(text: string, status = 200) {
  const fetchMock = vi.fn(async () => ({ ok: status < 400, status, text: async () => text, json: async () => JSON.parse(text) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('#279 — RestaurantService.listOrderPayments lee la forma real del endpoint', () => {
  beforeEach(() => { localStorage.setItem('token', 'tok') })
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear() })

  it('envelope del framework: `data.parts` + `data.balance` llegan enteros al service', async () => {
    const fetchMock = stubFetch(ENVELOPE_FIXED)
    const res: OrderPaymentsList = await RestaurantService.listOrderPayments('o-many')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('/api/restaurant/orders/o-many/payments')
    expect(res.parts.map((p) => p.seq)).toEqual([1])
    expect(res.balance).toEqual(BALANCE)
    expect(res.balance.due).toBe(118)
  })

  it('camino comprimido (body crudo sin envelope): la misma forma', async () => {
    stubFetch(RAW_COMPRESSED_PATH)
    const res = await RestaurantService.listOrderPayments('o-many')
    expect(res.parts).toHaveLength(1)
    expect(res.balance).toEqual(BALANCE)
  })

  it('la respuesta vieja de prod (lista paginada sin balance) NO trae `parts` ni `balance`: es lo que cobrar.vue tiene que tratar como error', async () => {
    stubFetch(ENVELOPE_BUGGY_PROD)
    const res = await RestaurantService.listOrderPayments('o-empty')
    // http.ts reconstruye `{data,total}` desde meta.pagination: nada de `balance` sobrevive.
    expect((res as unknown as { balance?: unknown }).balance).toBeUndefined()
    expect((res as unknown as { parts?: unknown }).parts).toBeUndefined()
  })
})
