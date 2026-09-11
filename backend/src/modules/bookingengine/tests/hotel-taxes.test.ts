// hotel-taxes.test.ts — Tarea 24 (#88): un solo lector de impuestos para rates, booking y grupo.
//
// Antes había tres copias que no coincidían (uno exigía `active` verdadero, otro aceptaba la
// ausencia; uno miraba la key `impuestos`, el otro no). Acá se fija la semántica: la de
// facturación (`facturas/usecases/billing.ts`) — activas con tasa > 0; sin config, `hotels`.
import { describe, it, expect } from 'bun:test'
import { readHotelTaxes, taxLinesOn, sumTaxLines } from '../usecases/hotel-taxes'

const cfgWith = (value: unknown, key = 'taxes') => ({
  findOne: async (f: any) => (f?.key === key ? { value } : null),
  findMany: async (f: any) => (f?.key === key ? [{ value }] : []),
}) as any

describe('readHotelTaxes — misma semántica que facturación', () => {
  it('devuelve solo las activas con tasa > 0, con nombre y %', async () => {
    const taxes = await readHotelTaxes(cfgWith([
      { activo: true, tasa: 18, nombre: 'ITBIS' },
      { activo: true, tasa: 10, nombre: 'Propina legal' },
      { activo: false, tasa: 5, nombre: 'Apagado' },
      { activo: true, tasa: 0, nombre: 'Cero' },
      { tasa: 7, nombre: 'Sin flag' },
    ]), 'h1', { taxRate: 99, taxName: 'NO' })
    expect(taxes).toEqual([{ name: 'ITBIS', rate: 18 }, { name: 'Propina legal', rate: 10 }])
  })

  it('acepta el shape inglés {name, rate, active} y la key legacy `impuestos`', async () => {
    const taxes = await readHotelTaxes(cfgWith([{ name: 'VAT', rate: 21, active: true }], 'impuestos'), 'h1', null)
    expect(taxes).toEqual([{ name: 'VAT', rate: 21 }])
  })

  it('sin config (o vacía) cae a hotels.taxRate/taxName — lo que Configuración → Impuestos sí guarda', async () => {
    expect(await readHotelTaxes(cfgWith([]), 'h1', { taxRate: 18, taxName: 'ITBIS' })).toEqual([{ name: 'ITBIS', rate: 18 }])
    expect(await readHotelTaxes(null, 'h1', async () => ({ taxRate: 12, taxName: 'IVA' }))).toEqual([{ name: 'IVA', rate: 12 }])
    expect(await readHotelTaxes(cfgWith([]), 'h1', { taxRate: 0 })).toEqual([])
  })

  it('un repo que solo tiene findMany (tests viejos de /rates) también sirve', async () => {
    const onlyMany = { findMany: async (f: any) => (f?.key === 'taxes' ? [{ value: [{ activo: true, tasa: 18, nombre: 'ITBIS' }] }] : []) } as any
    expect(await readHotelTaxes(onlyMany, 'h1', null)).toEqual([{ name: 'ITBIS', rate: 18 }])
  })

  it('si la lectura revienta, no tumba la reserva: fallback al hotel', async () => {
    const broken = { findOne: async () => { throw new Error('db') }, findMany: async () => { throw new Error('db') } } as any
    expect(await readHotelTaxes(broken, 'h1', { taxRate: 18, taxName: 'ITBIS' })).toEqual([{ name: 'ITBIS', rate: 18 }])
  })
})

describe('taxLinesOn / sumTaxLines — el desglose cierra con el total', () => {
  it('cada línea redondeada aparte y el total es la suma de las líneas', () => {
    const lines = taxLinesOn(333.33, [{ name: 'ITBIS', rate: 18 }, { name: 'Propina', rate: 10 }])
    expect(lines).toEqual([
      { name: 'ITBIS', rate: 18, amount: 60 },       // 59.9994 → 60
      { name: 'Propina', rate: 10, amount: 33.33 },  // 33.333 → 33.33
    ])
    expect(sumTaxLines(lines)).toBe(93.33)
  })

  it('base negativa o sin impuestos → cero, sin líneas fantasma', () => {
    expect(taxLinesOn(-5, [{ name: 'ITBIS', rate: 18 }])).toEqual([{ name: 'ITBIS', rate: 18, amount: 0 }])
    expect(taxLinesOn(100, [])).toEqual([])
    expect(sumTaxLines([])).toBe(0)
  })
})
