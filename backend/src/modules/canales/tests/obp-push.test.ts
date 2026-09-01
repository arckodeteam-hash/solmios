// obp-push.test.ts — #404: el push a Channex manda precio por ocupación (OBP) en per_person.
// Verifica el formato REAL del payload a POST /restrictions contra el fetch de Channex.
import { describe, it, expect, afterEach } from 'bun:test'
import { ChannexUseCase } from '../usecases/channex'
import { silentLogger } from 'arckode-framework/testing'

const CFG = { channexPropertyId: 'prop-1', channexApiKey: 'key-1' } as any
const SEASONS = [{ name: 'alta', startDate: '2099-12-01', endDate: '2099-12-31' }]

// Mock de fetch: GET devuelve el catálogo (room type "doble" con su rate plan), POST captura el body.
function installFetch(captured: { restrictions?: any }) {
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: string, opts: any) => {
    const u = String(url)
    const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.includes('/room_types')) return json({ data: [{ id: 'rt-1', attributes: { title: 'Doble' } }] })
    if (u.includes('/rate_plans')) return json({ data: [{ id: 'rp-1', attributes: { room_type_id: 'rt-1' } }] })
    if (u.includes('/restrictions')) { captured.restrictions = JSON.parse(opts.body); return json({ data: [], meta: { message: 'Success' } }) }
    return json({ data: [] })
  }) as any
  return () => { globalThis.fetch = orig }
}

const uc = () => new ChannexUseCase(silentLogger() as any, async () => ({ apiKey: 'key-1', environment: 'staging' } as any))

/**
 * El entry de la TEMPORADA. El push arranca con una línea base de 500 días desde hoy (test 1 de la
 * certificación: fuera de las temporadas Channex igual tiene que tener tarifa), así que `values[0]`
 * es esa línea base, no lo que estos tests miran. Se selecciona por la fecha de la temporada.
 */
const seasonEntry = (captured: { restrictions?: any }) =>
  captured.restrictions.values.find((v: any) => v.date_from === SEASONS[0]!.startDate)
let restore: () => void
afterEach(() => restore?.())

describe('pushSeasonalRates — OBP (#404)', () => {
  it('per_person: el entry lleva rates:[{occupancy,rate}] con TODAS las ocupaciones', async () => {
    const captured: { restrictions?: any } = {}
    restore = installFetch(captured)
    const rates = [
      { roomType: 'Doble', season: 'alta', occupancy: 1, basePrice: 80, percentage: 0 },
      { roomType: 'Doble', season: 'alta', occupancy: 2, basePrice: 100, percentage: 0 },
    ]
    await uc().pushSeasonalRates(CFG, rates, SEASONS, new Map(), 'per_person')
    const entry = seasonEntry(captured)
    expect(entry.rate_plan_id).toBe('rp-1')
    expect(entry.rate).toBeUndefined()                       // NO manda rate plano
    expect(entry.rates).toEqual([{ occupancy: 1, rate: 8000 }, { occupancy: 2, rate: 10000 }])  // centavos
  })

  it('per_room: el entry lleva un rate plano, sin array de ocupaciones', async () => {
    const captured: { restrictions?: any } = {}
    restore = installFetch(captured)
    const rates = [{ roomType: 'Doble', season: 'alta', occupancy: 2, basePrice: 100, percentage: 0 }]
    await uc().pushSeasonalRates(CFG, rates, SEASONS, new Map(), 'per_room')
    const entry = seasonEntry(captured)
    expect(entry.rate).toBe(10000)
    expect(entry.rates).toBeUndefined()
  })

  it('aplica el % de markup por ocupación', async () => {
    const captured: { restrictions?: any } = {}
    restore = installFetch(captured)
    const rates = [{ roomType: 'Doble', season: 'alta', occupancy: 2, basePrice: 100, percentage: 10 }]
    await uc().pushSeasonalRates(CFG, rates, SEASONS, new Map(), 'per_person')
    expect(seasonEntry(captured).rates).toEqual([{ occupancy: 2, rate: 11000 }])  // 100*1.10*100
  })
})
