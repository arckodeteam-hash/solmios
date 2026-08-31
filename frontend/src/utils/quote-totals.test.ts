// quote-totals.test.ts — La regresión que motivó el módulo: 18% de $360 es $64.80, el
// Math.round al entero de antes imprimía $65.00 y un total de $425.00 en la proforma.
import { describe, it, expect } from 'vitest'
import { quoteTotals } from './quote-totals'

describe('quoteTotals — la cotización del planning cierra a centavos', () => {
  it('18% de $360 = $64.80 de impuesto y $424.80 de total (antes redondeaba a $65/$425)', () => {
    const t = quoteTotals([{ type: 'Suite', qty: 1, price: 120 }], 3, 18)
    expect(t.subtotal).toBe(360)
    expect(t.tax).toBe(64.8)
    expect(t.total).toBe(424.8)
  })

  it('suma varias líneas antes de aplicar la tasa (el impuesto va sobre el subtotal, no por línea)', () => {
    const t = quoteTotals([
      { type: 'Suite', qty: 1, price: 100 },
      { type: 'Double', qty: 2, price: 50 },
    ], 2, 10)
    expect(t.subtotal).toBe(400) // (100 + 2×50) × 2 noches
    expect(t.tax).toBe(40)
    expect(t.total).toBe(440)
  })

  it('hotel sin tasa (0%): sin impuesto, el total es el subtotal (la proforma no desglosa)', () => {
    const t = quoteTotals([{ type: 'Single', qty: 1, price: 80 }], 4, 0)
    expect(t.tax).toBe(0)
    expect(t.total).toBe(t.subtotal)
  })

  it('centavos de borde: 18% de $100.05 = $18.01 (18.009 redondeado a centavos, no truncado)', () => {
    const t = quoteTotals([{ type: 'Single', qty: 3, price: 33.35 }], 1, 18)
    expect(t.subtotal).toBe(100.05)
    expect(t.tax).toBe(18.01)
    expect(t.total).toBe(118.06)
  })

  it('entradas vacías o basura no producen NaN: todo a 0', () => {
    expect(quoteTotals([], 0, 18)).toEqual({ subtotal: 0, tax: 0, total: 0 })
    const basura = quoteTotals([{ type: 'X', qty: Number('a'), price: Number('b') }], Number('c'), Number('d'))
    expect(basura).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })
})
