// rate-resolution-child-discount.test.ts — Tarea "Cobro % niños" (2026-09-09, generalizada desde
// "Cobro 50% niños" a un porcentaje configurable 1-100).
//
// `sumStayPriceForComposition` es la ÚNICA función nueva de esta tarea: sin la regla habilitada
// (o sin niños que paguen) tiene que dar EXACTAMENTE lo mismo que `sumStayPrice` de siempre — cero
// regresión para cualquier hotel que no toque la config nueva. Con la regla habilitada, "el valor
// de un adulto" es el precio TOTAL de la estadía para `effectiveAdults` dividido entre esa
// cantidad — nunca una fila de ocupación=1 inventada, porque la grilla de este sistema no es
// lineal por persona (existe justo para permitir descuentos de grupo). El 50% NUNCA está
// hardcodeado — cada test pasa su propio porcentaje, incluidos los bordes 1% y 100% del pedido.
import { describe, it, expect } from 'bun:test'
import { sumStayPrice, sumStayPriceForComposition } from './rate-resolution'

describe('sumStayPriceForComposition', () => {
  const oneNight = ['2027-01-10']
  const seasonByDate = new Map([['2027-01-10', 'alta']])
  const ratesSingleAndDouble = [
    { roomType: 'standard', season: 'alta', occupancy: 1, price: 100, basePrice: 100, percentage: 0 },
    { roomType: 'standard', season: 'alta', occupancy: 2, price: 180, basePrice: 180, percentage: 0 },
  ]

  it('regla deshabilitada: da EXACTAMENTE lo mismo que sumStayPrice de siempre (headcount total plano)', () => {
    const off = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 1, false, 50, 0)
    const legacy = sumStayPrice(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 2, 0) // effectiveAdults+payingChildren=2
    expect(off).toBe(legacy)
    expect(off).toBe(180) // la fila de ocupación=2 tal cual, sin split
  })

  it('regla habilitada sin niños con plaza: no hay nada que descontar, igual al headcount de solo adultos', () => {
    const price = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 2, 0, true, 50, 0)
    expect(price).toBe(sumStayPrice(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 2, 0))
  })

  it('ejemplo LITERAL del pedido: tarifa 2 adultos $200 → $100/adulto, 60% → niño $60', () => {
    const rates = [{ roomType: 'standard', season: 'alta', occupancy: 2, price: 200, basePrice: 200, percentage: 0 }]
    const price = sumStayPriceForComposition(oneNight, rates, 'standard', seasonByDate, 2, 1, true, 60, 0)
    // adultsTotal=200, perAdult=100, niño=60% de 100=60 → total 260.
    expect(price).toBe(260)
  })

  it('borde 1%: 1 adulto a $100 + 1 niño al 1% → niño = $1, total $101', () => {
    const price = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 1, true, 1, 0)
    expect(price).toBe(101)
  })

  it('50%: 1 adulto a $100 + 1 niño → $150 (niño = 50% de $100) — el mismo caso que antes era el ÚNICO comportamiento posible', () => {
    const price = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 1, true, 50, 0)
    expect(price).toBe(150)
  })

  it('borde 100%: 1 adulto a $100 + 1 niño al 100% → niño paga igual que un adulto, total $200', () => {
    const price = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 1, true, 100, 0)
    expect(price).toBe(200)
  })

  it('2 adultos ($180, tarifa de grupo con descuento) + 1 niño al 50% → niño = 50% de $90 (180/2) = $45, total $225', () => {
    const price = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 2, 1, true, 50, 0)
    expect(price).toBe(225)
  })

  it('2 niños con plaza al 75%: 1 adulto $100 + 2×$75 = $250', () => {
    const price = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 2, true, 75, 0)
    expect(price).toBe(250)
  })

  it('varias noches con temporadas distintas: el split se aplica sobre el TOTAL de la estadía, no noche por noche', () => {
    const nights = ['2027-01-10', '2027-01-11']
    const seasons = new Map([['2027-01-10', 'alta'], ['2027-01-11', 'baja']])
    const rates = [
      { roomType: 'standard', season: 'alta', occupancy: 1, price: 100, basePrice: 100, percentage: 0 },
      { roomType: 'standard', season: 'baja', occupancy: 1, price: 60, basePrice: 60, percentage: 0 },
    ]
    // adultsTotal = 100 + 60 = 160 (1 adulto). 1 niño con plaza al 50% → 160 + 80 = 240.
    const price = sumStayPriceForComposition(nights, rates, 'standard', seasons, 1, 1, true, 50, 0)
    expect(price).toBe(240)
  })

  it('sin grilla cargada (fallback rooms.basePrice): el split igual aplica sobre el fallback', () => {
    // Sin room_rates para este tipo → cae al fallback en cada noche, para cualquier ocupación.
    const price = sumStayPriceForComposition(oneNight, [], 'suite', seasonByDate, 1, 1, true, 50, 50)
    // adultsTotal (fallback, ignora ocupación) = 50. 1 niño al 50% de 50 = 25. Total 75.
    expect(price).toBe(75)
  })

  it('redondeo: no deja arrastre binario con tarifas que no dividen limpio (3 adultos a $100 + 1 niño al 50%)', () => {
    const rates = [{ roomType: 'standard', season: 'alta', occupancy: 3, price: 100, basePrice: 100, percentage: 0 }]
    // perAdult = 100/3 = 33.333..., niño = 16.666... → total = 116.666... → round2 = 116.67
    const price = sumStayPriceForComposition(oneNight, rates, 'standard', seasonByDate, 3, 1, true, 50, 0)
    expect(price).toBe(116.67)
  })

  it('defensa: un porcentaje fuera de [1,100] pasado directo a la función se clampea (nunca gratis, nunca más que un adulto extra)', () => {
    const zero = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 1, true, 0, 0)
    expect(zero).toBe(101) // clampea a 1%, no a 0 (0 sería "gratis", distinto de "regla deshabilitada")
    const over = sumStayPriceForComposition(oneNight, ratesSingleAndDouble, 'standard', seasonByDate, 1, 1, true, 500, 0)
    expect(over).toBe(200) // clampea a 100%, nunca más que el valor de un adulto
  })
})
