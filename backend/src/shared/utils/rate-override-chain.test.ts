// rate-override-chain.test.ts — La tarifa por FECHA dentro de la cadena de precio.
//
// Es el punto donde el precio que el hotel publica a las OTAs y el que cobra su propia web tienen
// que dar el MISMO número. Si estas dos capas se separan, el hotelero ve 333 en el panel, la OTA
// vende a 333 y la web propia cobra 110 — el bug que este archivo existe para que no vuelva.
import { describe, it, expect } from 'bun:test'
import { overrideRateFor, sumStayPrice, buildSeasonByDate, DIRECT_RATE_PLAN, type NightlyRateOverride } from './rate-resolution'

const ovr = (o: Partial<NightlyRateOverride>): NightlyRateOverride => ({
  roomType: 'Twin', ratePlan: 'bar', dateFrom: '2026-11-22', dateTo: '2026-11-22', rate: 333, ...o,
})

describe('overrideRateFor', () => {
  it('devuelve el precio del override que cubre la fecha', () => {
    expect(overrideRateFor([ovr({})], 'Twin', '2026-11-22')).toBe(333)
  })

  it('0 cuando la fecha queda fuera del rango', () => {
    expect(overrideRateFor([ovr({})], 'Twin', '2026-11-23')).toBe(0)
  })

  it('gana el rango MÁS CORTO: "el 24 y 25 a 900" pisa a "todo diciembre a 432"', () => {
    const all = [
      ovr({ dateFrom: '2026-12-01', dateTo: '2026-12-31', rate: 432 }),
      ovr({ dateFrom: '2026-12-24', dateTo: '2026-12-25', rate: 900 }),
    ]
    expect(overrideRateFor(all, 'Twin', '2026-12-25')).toBe(900)
    expect(overrideRateFor(all, 'Twin', '2026-12-10')).toBe(432)
  })

  it('el motor DIRECTO solo mira el plan base: un override de B&B no se filtra al precio público', () => {
    const soloBB = [ovr({ ratePlan: 'bb', rate: 999 })]
    expect(overrideRateFor(soloBB, 'Twin', '2026-11-22')).toBe(0)
    expect(overrideRateFor(soloBB, 'Twin', '2026-11-22', 'bb')).toBe(999)
    expect(DIRECT_RATE_PLAN).toBe('bar')
  })

  it('case-insensitive en tipo y plan (el panel guarda "Twin", la grilla manda "twin")', () => {
    expect(overrideRateFor([ovr({ roomType: 'twin', ratePlan: 'BAR' })], 'TWIN', '2026-11-22')).toBe(333)
  })

  it('un override SIN precio (solo restricciones) no cambia la tarifa', () => {
    expect(overrideRateFor([ovr({ rate: 0 })], 'Twin', '2026-11-22')).toBe(0)
  })

  it('no cruza de tipo de habitación', () => {
    expect(overrideRateFor([ovr({ roomType: 'Double' })], 'Twin', '2026-11-22')).toBe(0)
  })
})

describe('sumStayPrice con tarifas por fecha', () => {
  const baseRates = [{ roomType: 'Twin', season: 'media', occupancy: 2, price: 110, basePrice: 110, percentage: 0 }]
  const seasonByDate = new Map([
    ['2026-11-21', 'media'], ['2026-11-22', 'media'], ['2026-11-23', 'media'],
  ])
  const nights = ['2026-11-21', '2026-11-22', '2026-11-23']

  it('sin overrides el total no cambia (compat con todos los callers viejos)', () => {
    expect(sumStayPrice(nights, baseRates, 'Twin', seasonByDate, 2, 100)).toBe(330)
  })

  it('el override pisa SOLO su noche: las otras siguen a precio de temporada', () => {
    expect(sumStayPrice(nights, baseRates, 'Twin', seasonByDate, 2, 100, [ovr({})])).toBe(553)  // 110 + 333 + 110
  })

  it('un rango de override cubre todas sus noches', () => {
    const rango = [ovr({ dateFrom: '2026-11-21', dateTo: '2026-11-23', rate: 200 })]
    expect(sumStayPrice(nights, baseRates, 'Twin', seasonByDate, 2, 100, rango)).toBe(600)
  })

  it('override sobre una noche SIN temporada: pisa al fallback rooms.basePrice', () => {
    const sinTemporada = new Map([['2026-11-21', 'media']])
    // 110 (temporada) + 333 (override) + 100 (fallback, sin temporada ni override).
    expect(sumStayPrice(nights, baseRates, 'Twin', sinTemporada, 2, 100, [ovr({})])).toBe(543)
  })

  it('decimales: el total se redondea una sola vez al final', () => {
    const centavos = [ovr({ dateFrom: '2026-11-21', dateTo: '2026-11-23', rate: 456.23 })]
    expect(sumStayPrice(nights, baseRates, 'Twin', seasonByDate, 2, 100, centavos)).toBe(1368.69)
  })
})

describe('buildSeasonByDate — el RANGO del catálogo también asigna temporada', () => {
  const CATALOGO = [
    { name: 'baja', startDate: '2026-09-01', endDate: '2026-12-14' },
    { name: 'alta', startDate: '2026-12-15', endDate: '2027-04-15' },
    { name: 'especial', startDate: null, endDate: null },   // se pinta en el planning
  ]

  it('una fecha dentro del rango del catálogo queda con esa temporada', () => {
    const m = buildSeasonByDate([], CATALOGO, ['2026-10-05', '2027-01-20'])
    expect(m.get('2026-10-05')).toBe('baja')
    expect(m.get('2027-01-20')).toBe('alta')
  })

  it('el día PINTADO en el planning pisa al rango del catálogo', () => {
    const m = buildSeasonByDate([{ date: '2026-10-05', season: 'especial' }], CATALOGO, ['2026-10-05'])
    expect(m.get('2026-10-05')).toBe('especial')
  })

  it('una fecha fuera de todo rango no queda con temporada (cotiza por el precio base)', () => {
    expect(buildSeasonByDate([], CATALOGO, ['2028-03-01']).get('2028-03-01')).toBeUndefined()
  })

  it('si dos rangos se solapan gana el MÁS CORTO — el más específico', () => {
    const solapado = [
      { name: 'anual', startDate: '2026-01-01', endDate: '2026-12-31' },
      { name: 'navidad', startDate: '2026-12-20', endDate: '2026-12-26' },
    ]
    const m = buildSeasonByDate([], solapado, ['2026-12-24', '2026-06-10'])
    expect(m.get('2026-12-24')).toBe('navidad')
    expect(m.get('2026-06-10')).toBe('anual')
  })

  it('sin catálogo se comporta como siempre: solo los días pintados', () => {
    const m = buildSeasonByDate([{ date: '2026-10-05', season: 'alta' }])
    expect(m.get('2026-10-05')).toBe('alta')
    expect(m.size).toBe(1)
  })

  it('una temporada sin fechas no asigna nada por rango', () => {
    expect(buildSeasonByDate([], [{ name: 'especial' }], ['2026-10-05']).size).toBe(0)
  })
})
