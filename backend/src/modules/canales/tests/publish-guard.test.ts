// publish-guard.test.ts — La pausa de sincronización tiene que FRENAR los envíos.
// Antes `syncEnabled` solo lo miraba la ingesta de reservas: un hotel con la sincronización
// apagada seguía publicando precios y disponibilidad en las OTAs.
import { describe, it, expect, afterEach, beforeEach } from 'bun:test'
import { canPublish, isSyncActive } from '../usecases/publish-guard'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()
const RANGES = [{ dateFrom: '2099-11-01', dateTo: '2099-11-03', availability: 2 }]
const ACTIVO = { id: 'c1', hotelId: 'h1', channexPropertyId: 'prop-1', syncEnabled: 1 } as any
const PAUSADO = { ...ACTIVO, syncEnabled: 0 }

function installFetch(calls: string[]) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    if (opts?.method === 'POST') calls.push(u)
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200 })
    if (u.includes('/room_types')) return json({ data: [{ id: 'rt', attributes: { title: 'Twin Room' } }] })
    if (u.includes('/rate_plans')) return json({ data: [{ id: 'rp', attributes: { room_type_id: 'rt', title: 'Twin Room BAR' } }] })
    return json({ data: [{ id: 'task-1', type: 'task' }] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
let restore: (() => void) | undefined
beforeEach(() => resetChannexHttpForTests())
afterEach(() => { restore?.(); restore = undefined; resetChannexHttpForTests() })

describe('canPublish', () => {
  it('exige propiedad Y sincronización activa', () => {
    expect(canPublish(ACTIVO)).toBe(true)
    expect(canPublish(PAUSADO)).toBe(false)
    expect(canPublish({ syncEnabled: 1 })).toBe(false)
    expect(canPublish(undefined)).toBe(false)
  })

  it('una config vieja sin la marca se considera activa (default del modelo)', () => {
    expect(isSyncActive({ channexPropertyId: 'p' })).toBe(true)
    expect(canPublish({ channexPropertyId: 'p' })).toBe(true)
  })
})

describe('con la sincronización pausada no sale ningún envío', () => {
  it('availability por tipo', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    expect(await uc().pushAvailability(PAUSADO, 'twin', RANGES)).toEqual({ pushed: false, taskIds: [] })
    expect(calls).toHaveLength(0)
  })

  it('availability consolidada', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    expect(await uc().pushAllAvailability(PAUSADO, [{ roomType: 'twin', ranges: RANGES }])).toEqual({ pushed: 0, taskIds: [] })
    expect(calls).toHaveLength(0)
  })

  it('tarifas por fecha', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().pushRateOverrides(PAUSADO, [{ roomType: 'twin', ratePlan: 'bar', dateFrom: '2099-11-22', dateTo: '2099-11-22', rate: 333 }])
    expect(res.pushed).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('tarifas por temporada (y lo reporta como no conectado, no como éxito vacío)', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().pushSeasonalRates(PAUSADO, [{ roomType: 'twin', season: 'alta', occupancy: 2, basePrice: 100, percentage: 0 }], [{ name: 'alta', startDate: '2099-12-01', endDate: '2099-12-31' }])
    expect(res.notConnected).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('con la sincronización activa el mismo envío SÍ sale', async () => {
    const calls: string[] = []; restore = installFetch(calls)
    const res = await uc().pushAvailability(ACTIVO, 'twin', RANGES)
    expect(res.pushed).toBe(true)
    expect(calls.filter((u) => u.includes('/availability'))).toHaveLength(1)
  })
})
