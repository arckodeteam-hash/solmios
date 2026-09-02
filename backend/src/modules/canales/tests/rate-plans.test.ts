// rate-plans.test.ts — P5: múltiples rate plans por room type (BAR + B&B), el setup que
// exige la certificación PMS de Channex. Cubre el lector de configuration, el matcheo
// plan→rate plan de Channex, el precio con markup, y el push/sync multi-plan end-to-end
// (con fetch mockeado, formato real del payload).
import { describe, it, expect, afterEach } from 'bun:test'
import { readRatePlans, matchRatePlan, planPrice, DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()

describe('readRatePlans', () => {
  it('sin configuration devuelve el default BAR + B&B (markup 0/20)', async () => {
    const plans = await readRatePlans(async () => [], 'h1')
    expect(plans).toEqual(DEFAULT_RATE_PLANS)
    expect(plans.map((p) => p.code)).toEqual(['bar', 'bb'])
  })

  it('lee los planes del hotel desde configuration (JSON string u objeto)', async () => {
    const custom = [{ code: 'bar', label: 'BAR', markupPct: 0, keywords: ['bar'] }, { code: 'half', label: 'Media Pensión', markupPct: 35, keywords: ['half'] }]
    const plans = await readRatePlans(async (_m: string, q: any) => q.key === 'rate_plans' ? [{ value: JSON.stringify(custom) }] : [], 'h1')
    expect(plans).toEqual(custom)
  })

  it('configuration malformada cae al default sin romper', async () => {
    const plans = await readRatePlans(async () => [{ value: '{"roto":' }], 'h1')
    expect(plans).toEqual(DEFAULT_RATE_PLANS)
  })
})

describe('matchRatePlan — títulos del examen', () => {
  const EXAMEN = [
    { id: 'rp-twin-bar', title: 'Twin - Best Available Rate' },
    { id: 'rp-twin-bb', title: 'Twin - Bed & Breakfast' },
  ]

  it('BAR matchea "Best Available Rate" por keyword', () => {
    expect(matchRatePlan(EXAMEN, DEFAULT_RATE_PLANS[0]!)).toBe('rp-twin-bar')
  })

  it('B&B matchea "Bed & Breakfast" por keyword', () => {
    expect(matchRatePlan(EXAMEN, DEFAULT_RATE_PLANS[1]!)).toBe('rp-twin-bb')
  })

  it('retrocompatible: con un solo "X Standard", BAR cae al primero y B&B no se publica', () => {
    const solo = [{ id: 'rp-1', title: 'Double Standard' }]
    expect(matchRatePlan(solo, DEFAULT_RATE_PLANS[0]!)).toBe('rp-1')
    expect(matchRatePlan(solo, DEFAULT_RATE_PLANS[1]!)).toBeUndefined()
  })

  it('planPrice aplica el markup sobre centavos (100→120 con +20%)', () => {
    expect(planPrice(10000, 20)).toBe(12000)
    expect(planPrice(10000, 0)).toBe(10000)
  })
})

describe('pushSeasonalRates multi-plan (P5)', () => {
  let restore: () => void
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  function installFetch(captured: { restrictions?: any; ratePlans: any[] }) {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/room_types')) return json({ data: [{ id: 'rt-1', attributes: { title: 'Double' } }] })
      if (u.includes('/rate_plans')) return json({ data: [
        { id: 'rp-bar', attributes: { title: 'Double BAR', room_type_id: 'rt-1' } },
        { id: 'rp-bb', attributes: { title: 'Double Bed & Breakfast', room_type_id: 'rt-1' } },
      ] })
      if (u.includes('/restrictions')) { captured.restrictions = JSON.parse(opts.body); return json({ data: [] }) }
      return json({ data: [] })
    }) as any
    return () => { globalThis.fetch = orig }
  }

  it('un entry POR PLAN en la MISMA llamada: BAR al precio base y B&B +20%', async () => {
    const captured: { restrictions?: any; ratePlans: any[] } = { ratePlans: [] }
    restore = installFetch(captured)
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
    const rates = [{ roomType: 'Double', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }]
    const res = await uc.pushSeasonalRates({ channexPropertyId: 'p1', channexApiKey: 'k' } as any, rates,
      [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }], new Map(), DEFAULT_RATE_PLANS)

    // 4 entries en UNA llamada: línea base de 500 días (BAR + B&B) + la temporada (BAR + B&B).
    expect(res.pushed).toBe(4)
    const deTemporada = captured.restrictions!.values.filter((v: any) => v.date_from === '2099-06-01')
    const byRp = Object.fromEntries(deTemporada.map((v: any) => [v.rate_plan_id, topRate(v)]))
    expect(byRp['rp-bar']).toBe(10000)
    expect(byRp['rp-bb']).toBe(12000)
    // OBP: el precio viaja por ocupación en los dos planes.
    expect(deTemporada.find((v: any) => v.rate_plan_id === 'rp-bb').rates)
      .toEqual([{ occupancy: 2, rate: 12000 }])
  })

  it('con la grilla del examen (1 solo RP Standard) solo publica BAR — no rompe', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/room_types')) return json({ data: [{ id: 'rt-1', attributes: { title: 'Double' } }] })
      if (u.includes('/rate_plans')) return json({ data: [{ id: 'rp-1', attributes: { title: 'Double Standard', room_type_id: 'rt-1' } }] })
      if (u.includes('/restrictions')) { (globalThis as any).__captured = JSON.parse(opts.body); return json({ data: [] }) }
      return json({ data: [] })
    }) as any
    restore = () => { globalThis.fetch = orig }
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
    const res = await uc.pushSeasonalRates({ channexPropertyId: 'p1', channexApiKey: 'k' } as any,
      [{ roomType: 'Double', season: 'media', occupancy: 2, basePrice: 100, percentage: 0 }],
      [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }], new Map(), DEFAULT_RATE_PLANS)

    expect(res.pushed).toBe(2)   // línea base + temporada, ambas solo BAR: B&B no tiene counterpart
    const ids = [...new Set((globalThis as any).__captured.values.map((v: any) => v.rate_plan_id))]
    expect(ids).toEqual(['rp-1'])
  })

  it('P4: CTA/CTD/min_stay_through van en el entry (test 7 de certificación)', async () => {
    const captured: { restrictions?: any } = {}
    restore = installFetch(captured as any)
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
    await uc.pushSeasonalRates({ channexPropertyId: 'p1', channexApiKey: 'k' } as any,
      [{ roomType: 'Double', season: 'media', occupancy: 2, basePrice: 100, percentage: 0, minStay: 2, maxStay: 7 }],
      [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }], new Map(), DEFAULT_RATE_PLANS,
      [{ roomType: 'Double', season: 'media', closedToArrival: 1, ctd: 0, minStayThrough: 3 }])

    // La línea base de 500 días no lleva restricciones: las restricciones son de la TEMPORADA.
    const baseline = captured.restrictions!.values.find((v: any) => v.rate_plan_id === 'rp-bar' && v.date_from !== '2099-06-01')
    expect(baseline.min_stay_arrival).toBeUndefined()
    expect(baseline.closed_to_arrival).toBeUndefined()
    const bar = captured.restrictions!.values.find((v: any) => v.rate_plan_id === 'rp-bar' && v.date_from === '2099-06-01')
    expect(bar.min_stay_arrival).toBe(2)       // de RoomRates (como siempre)
    expect(bar.max_stay).toBe(7)
    expect(bar.closed_to_arrival).toBe(true)   // CTA — de rate_restrictions
    expect(bar.closed_to_departure).toBeUndefined()  // CTD en 0: NO se manda (update parcial)
    expect(bar.min_stay_through).toBe(3)       // through — de rate_restrictions
    // Los dos planes llevan las mismas restricciones en la misma llamada.
    const bb = captured.restrictions!.values.find((v: any) => v.rate_plan_id === 'rp-bb' && v.date_from === '2099-06-01')
    expect(bb.closed_to_arrival).toBe(true)
    expect(bb.min_stay_through).toBe(3)
  })

  it('días pintados (temporada sin catálogo) salen DESPUÉS del rango del catálogo — last win', async () => {
    const captured: { restrictions?: any } = {}
    restore = installFetch(captured as any)
    const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
    // media: catálogo 2099-06-01→30; especial: SIN fechas, pintada 2099-06-10→12 (solapa).
    const assigned = new Map([['especial', [{ startDate: '2099-06-10', endDate: '2099-06-12' }]]])
    // 'especial' PRIMERO en el array de rates: el orden de entrada NO debe decidir el ganador.
    await uc.pushSeasonalRates({ channexPropertyId: 'p1', channexApiKey: 'k' } as any, [
      { roomType: 'Double', season: 'especial', occupancy: 2, basePrice: 300, percentage: 50 },
      { roomType: 'Double', season: 'media', occupancy: 2, basePrice: 110, percentage: 30 },
    ], [{ name: 'media', startDate: '2099-06-01', endDate: '2099-06-30' }], assigned, DEFAULT_RATE_PLANS)

    // Orden del payload: línea base (hoy) → catálogo → días pintados. Channex aplica FIFO y el
    // último gana, así que el tramo pintado tiene que salir DESPUÉS del rango del catálogo.
    const dates = captured.restrictions!.values.filter((v: any) => v.rate_plan_id === 'rp-bar').map((v: any) => v.date_from)
    expect(dates.slice(1)).toEqual(['2099-06-01', '2099-06-10'])
    expect(dates[0]).toBe(new Date().toISOString().slice(0, 10))   // la línea base arranca hoy
  })
})

describe('syncProperty multi-plan (P5)', () => {
  it('crea UN rate plan de Channex por (room type × plan) con su precio', async () => {
    const created: any[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/rate_plans') && opts?.method === 'POST') { created.push(JSON.parse(opts.body).rate_plan); return json({ data: { id: crypto.randomUUID() } }) }
      if (u.includes('/rate_plans')) return json({ data: [] })
      // Channex devuelve el room type con el título que se le mandó ("Double" → "Double Room",
      // ver shared/utils/room-type-titles): el fake lo espeja en vez de inventar otro.
      if (u.includes('/room_types') && opts?.method === 'POST') return json({ data: { id: 'rt-1', attributes: { title: JSON.parse(opts.body).room_type.title } } })
      if (u.includes('/room_types')) return json({ data: [] })
      return json({ data: [] })
    }) as any
    const restore = () => { globalThis.fetch = orig }
    try {
      const uc = new ChannexUseCase(log as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
      await uc.syncProperty('h1', { name: 'H' }, [{ type: 'Double', cnt: 2, capacity: 2, basePrice: 100 }],
        { channexPropertyId: 'p1', channexApiKey: 'k' } as any, DEFAULT_RATE_PLANS)

      const titles = created.map((rp) => rp.title).sort()
      expect(titles).toEqual(['Double Room BAR', 'Double Room Bed & Breakfast'])
      const bb = created.find((rp) => rp.title === 'Double Room Bed & Breakfast')!
      expect(bb.options[0].rate).toBe(12000)   // base 100 × (1+20%) en centavos
    } finally { restore(); resetChannexHttpForTests() }
  })
})

/**
 * Precio del entry para la ocupación PRIMARIA (la más alta). Las tarifas viajan siempre como
 * `rates: [{occupancy, rate}]` — el hotel tarifa por persona; `rate` plano solo queda para filas
 * legacy sin ocupación.
 */
const topRate = (v: any): number | undefined =>
  v.rate ?? [...(v.rates ?? [])].sort((a: any, b: any) => b.occupancy - a.occupancy)[0]?.rate
