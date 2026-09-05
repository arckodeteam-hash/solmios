// canales/tests/seasons-planning.test.ts — Pintar días en el planning tiene que valer siempre.
//
// Los dos orígenes de fechas de una temporada eran EXCLUYENTES: si tenía fechas propias en el
// catálogo, los días pintados en el planning se descartaban. Así, pintar días de una temporada
// con fechas no hacía absolutamente nada — sólo funcionaba para las que no tienen fechas.
//
// Medido en producción el 2026-09-05 (Hotel Boutique Palma): el 10/9 estaba pintado como "media"
// (+70% en el canal) y Channex publicaba el precio de "baja". El hotel pinta el planning y el canal
// lo ignora.
import { describe, it, expect, afterEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

function installFetch(captured: { body?: any }) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, o: any) => {
    const u = String(url)
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/room_types')) return json({ data: [{ id: 'rt-1', attributes: { title: 'Double Room' } }] })
    if (u.includes('/rate_plans')) return json({ data: [{ id: 'rp-bar', attributes: { title: 'Double Room BAR', room_type_id: 'rt-1' } }] })
    if (u.includes('/restrictions')) { captured.body = JSON.parse(o.body); return json({ data: [], meta: {} }) }
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(silentLogger() as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
const cfg = { channexPropertyId: 'p1', channexApiKey: 'k' } as any
const rate = (v: any) => (v.rates?.[0]?.rate ?? v.rate)

describe('días pintados vs fechas del catálogo', () => {
  let restore: () => void
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('una temporada CON fechas propias también publica sus días pintados', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg,
      [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 70 }] as any,
      [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }] as any,
      new Map([['media', [{ startDate: '2099-03-10', endDate: '2099-03-12' }]]]) as any,
      DEFAULT_RATE_PLANS,
    )
    const rangos = captured.body.values.map((v: any) => `${v.date_from}→${v.date_to}`)
    expect(rangos).toContain('2099-06-01→2099-06-30')   // el catálogo
    expect(rangos).toContain('2099-03-10→2099-03-12')   // y los días pintados
  })

  it('los días pintados salen DESPUÉS del catálogo: son la capa que tiene que ganar', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg,
      [
        { roomType: 'Double Room', season: 'baja', occupancy: 2, basePrice: 100, percentage: 0 },
        { roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 70 },
      ] as any,
      [
        { name: 'baja', startDate: '2099-01-01', endDate: '2099-12-31' },
        { name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' },
      ] as any,
      // "media" pintada DENTRO del rango de "baja": el día pintado tiene que mandar.
      new Map([['media', [{ startDate: '2099-03-10', endDate: '2099-03-12' }]]]) as any,
      DEFAULT_RATE_PLANS,
    )
    const vals = captured.body.values
    const iPintado = vals.findIndex((v: any) => v.date_from === '2099-03-10')
    const iBaja = vals.findIndex((v: any) => v.date_from === '2099-01-01')
    expect(iPintado).toBeGreaterThan(iBaja)
    expect(rate(vals[iPintado])).toBe(17000)   // 100 × 1.70
    expect(rate(vals[iBaja])).toBe(10000)
  })

  it('una temporada SIN fechas propias sigue publicando por sus días pintados', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    const res = await uc().pushSeasonalRates(cfg,
      [{ roomType: 'Double Room', season: 'especial', occupancy: 2, basePrice: 100, percentage: 40 }] as any,
      [{ name: 'especial', startDate: '', endDate: '' }] as any,
      new Map([['especial', [{ startDate: '2099-05-01', endDate: '2099-05-02' }]]]) as any,
      DEFAULT_RATE_PLANS,
    )
    const entry = captured.body.values.find((v: any) => v.date_from === '2099-05-01')
    expect(rate(entry)).toBe(14000)
    expect(res.seasonsWithoutDates).toEqual([])
  })

  it('sin fechas NI días pintados se reporta una sola vez como "sin fechas"', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    const res = await uc().pushSeasonalRates(cfg,
      [{ roomType: 'Double Room', season: 'especial', occupancy: 2, basePrice: 100, percentage: 0 }] as any,
      [{ name: 'especial', startDate: '', endDate: '' }] as any,
      new Map() as any, DEFAULT_RATE_PLANS,
    )
    expect(res.seasonsWithoutDates).toEqual(['especial'])
    expect(res.skipped).toBe(1)   // una sola vez, no una por pasada
  })
})
