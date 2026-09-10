// SalesPipeline.service.test.ts — #147: el service pega a las rutas del backend con la forma
// exacta que esperan (`key` = hotel:<id>|lead:<id> en el path, `{days}` en el body) y no toca
// la respuesta: la fila del pipeline se pasa completa, sin copiar por lista blanca.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: Array<{ method: string; path: string; body?: unknown }> = []
let response: unknown = null
vi.mock('./http', () => ({
  http: {
    get: (path: string) => { calls.push({ method: 'GET', path }); return Promise.resolve(response) },
    put: (path: string, body?: unknown) => { calls.push({ method: 'PUT', path, body }); return Promise.resolve(response) },
    post: (path: string, body?: unknown) => { calls.push({ method: 'POST', path, body }); return Promise.resolve(response) },
  },
}))

import { SalesPipelineService } from './SalesPipeline.service'

beforeEach(() => {
  calls.length = 0
  response = null
})

describe('SalesPipelineService', () => {
  it('list pega a GET /admin/sales-pipeline y devuelve {data,total} tal cual', async () => {
    const row = { key: 'hotel:h1', hotelId: 'h1', stage: 'registered', heat: 'cold', unCampoNuevo: 'llega igual' }
    response = { data: [row], total: 1 }
    const res = await SalesPipelineService.list()
    expect(calls).toEqual([{ method: 'GET', path: '/admin/sales-pipeline' }])
    expect(res.total).toBe(1)
    // Sin `.map()` por lista blanca: un campo que el backend agregue después no se pierde.
    expect(res.data[0]).toBe(row)
  })

  it('updateProspect manda el key en el path (escapado) y el parcial en el body', async () => {
    response = { id: 'p1' }
    await SalesPipelineService.updateProspect('hotel:h 1', { lostReason: 'price', notes: null })
    expect(calls).toEqual([{ method: 'PUT', path: '/admin/sales-pipeline/hotel%3Ah%201', body: { lostReason: 'price', notes: null } }])
  })

  it('extendTrial pega a POST /admin/subscriptions/:hotelId/extend-trial con {days}', async () => {
    response = { subscription: { status: 'trialing' }, daysLeft: 7, previousTrialEndsAt: null, emailSent: true }
    const res = await SalesPipelineService.extendTrial('h1', 7)
    expect(calls).toEqual([{ method: 'POST', path: '/admin/subscriptions/h1/extend-trial', body: { days: 7 } }])
    expect(res.daysLeft).toBe(7)
  })

  it('assignees pega a GET /admin/sales-pipeline/assignees y devuelve {data} tal cual', async () => {
    const user = { id: 'u1', name: 'Ana', email: 'ana@solmios.com' }
    response = { data: [user] }
    const res = await SalesPipelineService.assignees()
    expect(calls).toEqual([{ method: 'GET', path: '/admin/sales-pipeline/assignees' }])
    expect(res.data[0]).toBe(user)
  })
})
