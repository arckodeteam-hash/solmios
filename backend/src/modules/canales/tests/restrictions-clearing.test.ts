// canales/tests/restrictions-clearing.test.ts — Una restricción que se pone se tiene que poder sacar.
//
// Hasta el 2026-09-04 los campos solo se mandaban con valor > 0, así que ponerlos en cero no
// mandaba nada y Channex conservaba el valor anterior. Verificado en producción (Hotel Boutique
// Palma): CTA y min stay puestos y después quitados desde el panel seguían activos en el canal.
// Y el neutro de `min_stay` en Channex es 1, no 0 — un 0 hace que rechace el entry ENTERO
// ("must be greater than or equal to 1"), llevándose puestas las demás restricciones del entry.
import { describe, it, expect, afterEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const SEASON = [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }]

function installFetch(captured: { body?: any }, opts: { warnings?: unknown[] } = {}) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, o: any) => {
    const u = String(url)
    const json = (d: any) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/room_types')) return json({ data: [{ id: 'rt-1', attributes: { title: 'Double Room' } }] })
    if (u.includes('/rate_plans')) return json({ data: [{ id: 'rp-bar', attributes: { title: 'Double Room BAR', room_type_id: 'rt-1' } }] })
    if (u.includes('/restrictions')) {
      captured.body = JSON.parse(o.body)
      return json({ data: [], meta: opts.warnings ? { warnings: opts.warnings } : {} })
    }
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(silentLogger() as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
const cfg = { channexPropertyId: 'p1', channexApiKey: 'k' } as any
const season = (v: any) => v.date_from === '2099-06-01'

describe('restricciones en cero', () => {
  let restore: () => void
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('CTA/CTD apagados se mandan EXPLÍCITOS en false: así se pueden sacar', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS,
      [{ roomType: 'Double Room', season: 'media', closedToArrival: 0, closedToDeparture: 0, minStayThrough: 0 }] as any)

    const entry = captured.body.values.find(season)
    expect(entry.closed_to_arrival).toBe(false)
    expect(entry.closed_to_departure).toBe(false)
  })

  it('sin fila de restricciones tampoco quedan colgadas: false explícito igual', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS, [])

    const entry = captured.body.values.find(season)
    expect(entry.closed_to_arrival).toBe(false)
    expect(entry.closed_to_departure).toBe(false)
  })

  it('min_stay en 0 sale como 1 (el neutro de Channex), NUNCA como 0', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0, minStay: 0 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS,
      [{ roomType: 'Double Room', season: 'media', minStayThrough: 0 }] as any)

    const entry = captured.body.values.find(season)
    expect(entry.min_stay_arrival).toBe(1)
    expect(entry.min_stay_through).toBe(1)
  })

  it('los valores reales pasan intactos y arrival y through siguen siendo independientes', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0, minStay: 10 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS,
      [{ roomType: 'Double Room', season: 'media', closedToArrival: 1, minStayThrough: 7 }] as any)

    const entry = captured.body.values.find(season)
    expect(entry.min_stay_arrival).toBe(10)
    expect(entry.min_stay_through).toBe(7)
    expect(entry.closed_to_arrival).toBe(true)
    expect(entry.closed_to_departure).toBe(false)
  })

  it('ningún entry sale nunca con min_stay 0 — es lo que hace que Channex descarte el entry entero', async () => {
    const captured: { body?: any } = {}
    restore = installFetch(captured)
    await uc().pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS, [])

    for (const v of captured.body.values) {
      if ('min_stay_arrival' in v) expect(v.min_stay_arrival).toBeGreaterThanOrEqual(1)
      if ('min_stay_through' in v) expect(v.min_stay_through).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('warnings de Channex', () => {
  let restore: () => void
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  it('un 200 con warnings no pasa desapercibido: se loguea qué descartó', async () => {
    const captured: { body?: any } = {}
    const logs: Array<{ msg: string; meta?: any }> = []
    restore = installFetch(captured, { warnings: [{ warning: { min_stay_arrival: ['must be greater than or equal to 1'] } }] })
    const logger = { info: () => {}, error: () => {}, debug: () => {}, warn: (msg: string, meta?: any) => { logs.push({ msg, meta }) } }
    const useCase = new ChannexUseCase(logger as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

    await useCase.pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS, [])

    expect(logs).toHaveLength(1)
    expect(logs[0]!.meta.descartados).toBe(1)
  })

  it('sin warnings no se loguea nada', async () => {
    const captured: { body?: any } = {}
    const logs: unknown[] = []
    restore = installFetch(captured)
    const logger = { info: () => {}, error: () => {}, debug: () => {}, warn: (...a: unknown[]) => { logs.push(a) } }
    const useCase = new ChannexUseCase(logger as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)

    await useCase.pushSeasonalRates(cfg, [{ roomType: 'Double Room', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }] as any,
      SEASON as any, new Map(), DEFAULT_RATE_PLANS, [])

    expect(logs).toHaveLength(0)
  })
})
