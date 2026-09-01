// push-overrides.test.ts — Payload del push DELTA de tarifas por fecha.
// Cada bloque de acá se corresponde con un test numerado de la certificación PMS de Channex:
// una sola llamada por guardado, precios independientes por rate plan, restricciones batcheadas,
// y nada de fechas pasadas.
import { describe, it, expect, afterEach } from 'bun:test'
import { buildOverrideValues, type OverridePushItem } from '../usecases/push-overrides'
import { DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import { ChannexUseCase } from '../usecases/channex'
import { resetChannexHttpForTests } from '../usecases/channex-http'
import type { AriTargets } from '../usecases/channex-mapping'
import { silentLogger } from 'arckode-framework/testing'

const TODAY = '2026-09-01'

/** Twin y Double, cada uno con BAR y B&B — el setup que usa el guion de la certificación. */
const TARGETS: AriTargets = {
  rtIdByTitle: new Map([['twin room', 'rt-twin'], ['double room', 'rt-double']]),
  rpsByRt: new Map([
    ['rt-twin', [{ id: 'rp-twin-bar', title: 'Twin Room BAR' }, { id: 'rp-twin-bb', title: 'Twin Room Bed & Breakfast' }]],
    ['rt-double', [{ id: 'rp-double-bar', title: 'Double Room BAR' }, { id: 'rp-double-bb', title: 'Double Room Bed & Breakfast' }]],
  ]),
}

const cell = (o: Partial<OverridePushItem>): OverridePushItem =>
  ({ roomType: 'Twin Room', ratePlan: 'bar', dateFrom: TODAY, dateTo: TODAY, ...o }) as OverridePushItem

const build = (items: OverridePushItem[]) =>
  buildOverrideValues(items, 'prop-1', TARGETS, DEFAULT_RATE_PLANS, TODAY)

describe('test 2 — una tarifa, una fecha', () => {
  it('el precio va en centavos, al rate plan correcto, en un entry de un solo día', () => {
    const { values } = build([cell({ dateFrom: '2026-11-22', dateTo: '2026-11-22', rate: 333 })])
    expect(values).toEqual([{
      property_id: 'prop-1', rate_plan_id: 'rp-twin-bar',
      date_from: '2026-11-22', date_to: '2026-11-22', rate: 33300,
    }])
  })
})

describe('test 3 — varias tarifas en una sola llamada', () => {
  it('las tres celdas del guion salen en UN payload, con el precio de B&B independiente de BAR', () => {
    const { values } = build([
      cell({ roomType: 'Twin Room', ratePlan: 'bar', dateFrom: '2026-11-21', dateTo: '2026-11-21', rate: 333 }),
      cell({ roomType: 'Double Room', ratePlan: 'bar', dateFrom: '2026-11-25', dateTo: '2026-11-25', rate: 444 }),
      cell({ roomType: 'Double Room', ratePlan: 'bb', dateFrom: '2026-11-29', dateTo: '2026-11-29', rate: 456.23 }),
    ])
    expect(values.map((v) => [v.rate_plan_id, v.rate])).toEqual([
      ['rp-twin-bar', 33300],
      ['rp-double-bar', 44400],
      // 456.23 tal cual: NO es 444 × 1.2. El markup del plan no se aplica sobre un override.
      ['rp-double-bb', 45623],
    ])
  })
})

describe('tests 5, 6 y 7 — restricciones', () => {
  it('min stay va como min_stay_arrival y solo se manda lo que el override fija', () => {
    const { values } = build([cell({ dateFrom: '2026-11-23', dateTo: '2026-11-23', minStay: 3 })])
    expect(values[0]).toEqual({
      property_id: 'prop-1', rate_plan_id: 'rp-twin-bar',
      date_from: '2026-11-23', date_to: '2026-11-23', min_stay_arrival: 3,
    })
    expect(values[0]!.rate).toBeUndefined()   // update parcial: no pisa el precio de temporada
  })

  it('stop sell viaja como booleano', () => {
    const { values } = build([cell({ stopSell: 1 })])
    expect(values[0]!.stop_sell).toBe(true)
  })

  it('CTA, CTD, min y max stay conviven en el mismo entry', () => {
    const { values } = build([cell({
      dateFrom: '2026-12-01', dateTo: '2026-12-10',
      minStay: 2, maxStay: 14, closedToArrival: 1, closedToDeparture: 1, minStayThrough: 4,
    })])
    expect(values[0]).toMatchObject({
      min_stay_arrival: 2, max_stay: 14,
      closed_to_arrival: true, closed_to_departure: true, min_stay_through: 4,
    })
  })
})

describe('apagar una restricción', () => {
  it('un flag que se APAGA se manda explícito en false — omitirlo dejaría el cierre vivo en la OTA', () => {
    const { values } = build([cell({ rate: 333, cleared: ['stopSell', 'closedToArrival'] })])
    expect(values[0]!.stop_sell).toBe(false)
    expect(values[0]!.closed_to_arrival).toBe(false)
  })

  it('apagar un mínimo de estadía vuelve a 1 (Channex expresa "sin mínimo" con 1, no con 0)', () => {
    const { values } = build([cell({ rate: 333, cleared: ['minStay', 'minStayThrough', 'maxStay'] })])
    expect(values[0]!.min_stay_arrival).toBe(1)
    expect(values[0]!.min_stay_through).toBe(1)
    expect(values[0]!.max_stay).toBe(0)   // "sin tope" sí es 0
  })

  it('una dimensión que nunca estuvo seteada no se manda', () => {
    const { values } = build([cell({ rate: 333 })])
    expect(Object.keys(values[0]!).sort()).toEqual(['date_from', 'date_to', 'property_id', 'rate', 'rate_plan_id'])
  })
})

describe('test 8 — medio año en un entry', () => {
  it('un rango largo es UN entry, no un entry por día', () => {
    const { values } = build([
      cell({ roomType: 'Twin Room', dateFrom: '2026-12-01', dateTo: '2027-05-31', rate: 432 }),
      cell({ roomType: 'Double Room', dateFrom: '2026-12-01', dateTo: '2027-05-31', rate: 342 }),
    ])
    expect(values).toHaveLength(2)
    expect(values[0]).toMatchObject({ date_from: '2026-12-01', date_to: '2027-05-31', rate: 43200 })
  })
})

describe('fechas pasadas', () => {
  it('un rango que empezó ayer se recorta desde hoy (Channex rechaza fechas pasadas)', () => {
    const { values } = build([cell({ dateFrom: '2026-08-01', dateTo: '2026-09-30', rate: 100 })])
    expect(values[0]!.date_from).toBe(TODAY)
    expect(values[0]!.date_to).toBe('2026-09-30')
  })

  it('un rango enteramente pasado se descarta y se cuenta como vencido', () => {
    const { values, skips } = build([cell({ dateFrom: '2026-07-01', dateTo: '2026-08-15', rate: 100 })])
    expect(values).toHaveLength(0)
    expect(skips.expiredRanges).toBe(1)
  })
})

describe('celdas que no se pueden publicar', () => {
  it('un room type sin counterpart en Channex se saltea con motivo, sin romper el resto', () => {
    const { values, skips } = build([
      cell({ roomType: 'Penthouse', rate: 500 }),
      cell({ roomType: 'Twin Room', rate: 333 }),
    ])
    expect(values).toHaveLength(1)
    expect(skips.roomTypesWithoutRatePlan).toEqual(['Penthouse'])
  })

  it('un código de plan que el hotel no tiene se saltea con motivo', () => {
    const { values, skips } = build([cell({ ratePlan: 'media-pension', rate: 500 })])
    expect(values).toHaveLength(0)
    expect(skips.ratePlansUnknown).toEqual(['media-pension'])
  })

  it('un room type que existe pero cuyo plan no tiene rate plan cae al mismo motivo', () => {
    const targets: AriTargets = {
      rtIdByTitle: new Map([['twin room', 'rt-twin']]),
      rpsByRt: new Map([['rt-twin', [{ id: 'rp-only-bar', title: 'Twin Room BAR' }]]]),
    }
    const { values, skips } = buildOverrideValues([cell({ ratePlan: 'bb', rate: 200 })], 'prop-1', targets, DEFAULT_RATE_PLANS, TODAY)
    expect(values).toHaveLength(0)
    expect(skips.roomTypesWithoutRatePlan).toEqual(['Twin Room'])
  })
})

describe('ChannexUseCase.pushRateOverrides — una sola llamada HTTP', () => {
  let restore: (() => void) | undefined
  afterEach(() => { restore?.(); resetChannexHttpForTests() })

  function installFetch(captured: { posts: any[]; gets: number }) {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string, opts: any) => {
      const u = String(url)
      const json = (data: any) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u.includes('/room_types')) { captured.gets++; return json({ data: [{ id: 'rt-twin', attributes: { title: 'Twin Room' } }] }) }
      if (u.includes('/rate_plans')) { captured.gets++; return json({ data: [{ id: 'rp-twin-bar', attributes: { title: 'Twin Room BAR', room_type_id: 'rt-twin' } }] }) }
      if (u.includes('/restrictions')) { captured.posts.push(JSON.parse(opts.body)); return json({ data: [] }) }
      return json({ data: [] })
    }) as any
    return () => { globalThis.fetch = orig }
  }

  const uc = () => new ChannexUseCase(silentLogger() as any, async () => ({ apiKey: 'k', environment: 'staging' }) as any)
  const CFG = { channexPropertyId: 'prop-1', channexApiKey: 'k' } as any

  it('tres celdas guardadas = UN POST /restrictions con tres entries (tests 3 y 13)', async () => {
    const captured = { posts: [] as any[], gets: 0 }
    restore = installFetch(captured)
    const res = await uc().pushRateOverrides(CFG, [
      cell({ dateFrom: '2026-11-21', dateTo: '2026-11-21', rate: 333 }),
      cell({ dateFrom: '2026-11-25', dateTo: '2026-11-25', rate: 444 }),
      cell({ dateFrom: '2026-11-29', dateTo: '2026-11-29', rate: 456.23 }),
    ])
    expect(captured.posts).toHaveLength(1)
    expect(captured.posts[0].values).toHaveLength(3)
    expect(res).toMatchObject({ pushed: 3, calls: 1 })
  })

  it('sin celdas publicables no hace ninguna llamada', async () => {
    const captured = { posts: [] as any[], gets: 0 }
    restore = installFetch(captured)
    const res = await uc().pushRateOverrides(CFG, [cell({ roomType: 'Penthouse', rate: 1 })])
    expect(captured.posts).toHaveLength(0)
    expect(res.calls).toBe(0)
    expect(res.skips.roomTypesWithoutRatePlan).toEqual(['Penthouse'])
  })

  it('sin propiedad sincronizada no llama a Channex', async () => {
    const captured = { posts: [] as any[], gets: 0 }
    restore = installFetch(captured)
    const res = await uc().pushRateOverrides({} as any, [cell({ rate: 333 })])
    expect(captured.gets).toBe(0)
    expect(res).toMatchObject({ pushed: 0, calls: 0 })
  })

  it('un rechazo de Channex se propaga como error (no se traga)', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      const u = String(url)
      const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
      if (u.includes('/room_types')) return json({ data: [{ id: 'rt-twin', attributes: { title: 'Twin Room' } }] })
      if (u.includes('/rate_plans')) return json({ data: [{ id: 'rp-twin-bar', attributes: { title: 'Twin Room BAR', room_type_id: 'rt-twin' } }] })
      if (u.includes('/restrictions')) return json({ errors: { title: 'date_from is in the past' } }, 422)
      return json({ data: [] })
    }) as any
    restore = () => { globalThis.fetch = orig }
    await expect(uc().pushRateOverrides(CFG, [cell({ rate: 333 })])).rejects.toThrow(/Channex rechazó los overrides/)
  })
})
