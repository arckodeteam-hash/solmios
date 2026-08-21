// subscriptions/tests/public-founder-discount.test.ts — CFG-1: el % del programa Fundador sale de
// `special_category_config`, no de una variable de build del frontend.
//
// El endpoint `GET /api/public/founder-discount` es público y tiene cinco ramas (sin repo, sin
// filas de fundador, categoría abierta, ninguna abierta, % inservible) y ningún test las cubría.
// Cada rama decide un NÚMERO que la landing publica como promesa comercial: si diverge del que
// `admin/usecases/special-conditions.ts` aplica al cobrar, es la misma divergencia
// precio-mostrado vs precio-cobrado que GH-31 vino a cerrar.

import { describe, it, expect } from 'bun:test'
import { publicFounderDiscount, FOUNDER_CATEGORY_KEYS } from '../usecases/public-founder-discount'

const repoWith = (rows: any[]) => ({ findMany: async () => rows })

describe('publicFounderDiscount', () => {
  it('sin repo inyectado devuelve null (la página muestra su copy de reserva)', async () => {
    expect(await publicFounderDiscount(undefined)).toBeNull()
    expect(await publicFounderDiscount(null)).toBeNull()
  })

  it('sin filas de categoría fundador devuelve null', async () => {
    expect(await publicFounderDiscount(repoWith([]))).toBeNull()
    // `pioneer` es OTRO programa: no puede prestarle su descuento a la página de Fundador.
    expect(await publicFounderDiscount(repoWith([{ key: 'pioneer', status: 'open', discountPct: 40 }]))).toBeNull()
  })

  it('manda la categoría `open`: es la que un hotel puede tomar HOY', async () => {
    const pct = await publicFounderDiscount(repoWith([
      { key: 'founder_one', status: 'closed', discountPct: 50 },
      { key: 'founder_two', status: 'open', discountPct: 20 },
    ]))
    expect(pct).toBe(20)
  })

  it('sin ninguna abierta muestra el MAYOR de las configuradas', async () => {
    const pct = await publicFounderDiscount(repoWith([
      { key: 'founder_one', status: 'closed', discountPct: 30 },
      { key: 'founder_two', status: 'full', discountPct: 45 },
    ]))
    expect(pct).toBe(45)
  })

  it('un % inservible en la categoría abierta cae al resto, no se publica basura', async () => {
    // 0, 100, negativos y no-numéricos no son descuentos usables.
    const pct = await publicFounderDiscount(repoWith([
      { key: 'founder_one', status: 'open', discountPct: 0 },
      { key: 'founder_two', status: 'closed', discountPct: 25 },
    ]))
    expect(pct).toBe(25)
  })

  it('si NINGÚN % es usable devuelve null en vez de un número inventado', async () => {
    for (const bad of [0, 100, 120, -5, 'ochenta', null, undefined]) {
      const pct = await publicFounderDiscount(repoWith([{ key: 'founder_one', status: 'open', discountPct: bad }]))
      expect(pct).toBeNull()
    }
  })

  it('acepta el % como string numérico (la columna puede volver como texto según el motor)', async () => {
    expect(await publicFounderDiscount(repoWith([{ key: 'founder_one', status: 'open', discountPct: '35' }]))).toBe(35)
  })

  it('las claves publicadas son exactamente las dos del programa Fundador', () => {
    expect([...FOUNDER_CATEGORY_KEYS]).toEqual(['founder_one', 'founder_two'])
  })
})
