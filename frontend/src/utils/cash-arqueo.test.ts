// cash-arqueo.test.ts — La matemática del arqueo de cierre (números del flujo real de la
// auditoría docs/qa-ui/caja-2026-08-22: fondo $500 + ingreso $1000 − egreso $200 = esperado $1300).
import { describe, it, expect } from 'vitest'
import { round2, BALANCE_EPSILON, denominationsFor, sumDenominations, buildArqueo } from './cash-arqueo'

describe('round2 / BALANCE_EPSILON — espejo del backend', () => {
  it('round2 corrige la cola binaria (1.005 → 1.01, no 1.00)', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1290)).toBe(1290)
  })

  it('epsilon = 0.01: un centavo de diferencia CUADRA (mismo criterio que el backend)', () => {
    expect(Math.abs(0.01) > BALANCE_EPSILON).toBe(false)
    expect(Math.abs(0.02) > BALANCE_EPSILON).toBe(true)
  })
})

describe('denominationsFor / sumDenominations', () => {
  it('DOP tiene denominaciones; una moneda sin configurar devuelve [] (campo libre)', () => {
    expect(denominationsFor('DOP')).toContain(2000)
    expect(denominationsFor('dop')).toContain(2000) // case-insensitive
    expect(denominationsFor('XYZ')).toEqual([])
    expect(denominationsFor(undefined)).toEqual([])
  })

  it('la suma del desglose ES el contado de efectivo (1290 = 1000 + 200 + 50 + 4×10)', () => {
    const denoms = denominationsFor('DOP')
    const counts: Record<string, number | null> = { '1000': 1, '200': 1, '50': 1, '10': 4 }
    expect(sumDenominations(counts, denoms)).toBe(1290)
  })

  it('las denominaciones sin cantidad (null o vacía) no suman nada', () => {
    const denoms = denominationsFor('USD')
    expect(sumDenominations({ '100': 2, '50': null, '20': '' }, denoms)).toBe(200)
  })
})

describe('buildArqueo — desglose por método que cierra a la vista', () => {
  // Fondo 500 + efectivo neto +800 (1000 ingreso − 200 egreso) = esperado efectivo 1300.
  // Tarjeta: 300 neto, no entra al cajón.
  const base = { opening: 500, byMethodNet: { cash: 800, card: 300 } }

  it('el efectivo esperado suma el fondo; el resto de métodos solo su neto', () => {
    const a = buildArqueo({ ...base, countedByMethod: {} })
    const cash = a.methods.find(m => m.method === 'cash')!
    const card = a.methods.find(m => m.method === 'card')!
    expect(cash.expected).toBe(1300)
    expect(card.expected).toBe(300)
    expect(a.totalExpected).toBe(1600)
  })

  it('sin contar nada: contado/diferencia en null y pendingCount (no se puede cerrar)', () => {
    const a = buildArqueo({ ...base, countedByMethod: {} })
    expect(a.pendingCount).toBe(true)
    expect(a.totalCounted).toBeNull()
    expect(a.totalDifference).toBeNull()
  })

  it('contado 1290 contra esperado 1300 → diferencia −10 en vivo y exige motivo', () => {
    const a = buildArqueo({ ...base, countedByMethod: { cash: 1290, card: 300 } })
    expect(a.methods.find(m => m.method === 'cash')!.difference).toBe(-10)
    expect(a.totalCounted).toBe(1590)
    expect(a.totalDifference).toBe(-10)
    expect(a.requiresReason).toBe(true)
  })

  it('arqueo cuadrado (todo igual al esperado) NO exige motivo', () => {
    const a = buildArqueo({ ...base, countedByMethod: { cash: 1300, card: 300 } })
    expect(a.totalDifference).toBe(0)
    expect(a.requiresReason).toBe(false)
  })

  it('el egreso RESTA del esperado (un egreso de 200 no infla el cajón en 200)', () => {
    const a = buildArqueo({ opening: 0, byMethodNet: { cash: -200 }, countedByMethod: { cash: -200 } })
    expect(a.methods[0].expected).toBe(-200)
    // flujo real: fondo 0 + ingreso 500 − egreso 200
    const real = buildArqueo({ opening: 0, byMethodNet: { cash: 300 }, countedByMethod: { cash: 300 } })
    expect(real.methods[0].expected).toBe(300)
  })

  it('diferencia de un centavo (dentro de BALANCE_EPSILON) no exige motivo', () => {
    const a = buildArqueo({ ...base, countedByMethod: { cash: 1300.01, card: 300 } })
    expect(a.requiresReason).toBe(false)
  })

  it('diferencia en un método secundario (tarjeta) también exige motivo aunque el efectivo cuadre', () => {
    const a = buildArqueo({ ...base, countedByMethod: { cash: 1300, card: 290 } })
    expect(a.requiresReason).toBe(true)
  })

  it('un turno sin movimientos sigue mostrando el efectivo (esperado = fondo)', () => {
    const a = buildArqueo({ opening: 500, byMethodNet: {}, countedByMethod: { cash: 500 } })
    expect(a.methods).toHaveLength(1)
    expect(a.totalDifference).toBe(0)
    expect(a.requiresReason).toBe(false)
  })

  it('input basura del v-model ("") cuenta como no contado, no como 0', () => {
    const a = buildArqueo({ ...base, countedByMethod: { cash: '', card: 300 } })
    expect(a.pendingCount).toBe(true)
  })
})
