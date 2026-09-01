// rate-override-chain.test.ts — La tarifa por FECHA dentro de la cadena de precio.
//
// Es el punto donde el precio que el hotel publica a las OTAs y el que cobra su propia web tienen
// que dar el MISMO número. Si estas dos capas se separan, el hotelero ve 333 en el panel, la OTA
// vende a 333 y la web propia cobra 110 — el bug que este archivo existe para que no vuelva.
import { describe, it, expect } from 'bun:test'
import { overrideRateFor, sumStayPrice, DIRECT_RATE_PLAN, type NightlyRateOverride } from './rate-resolution'

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
