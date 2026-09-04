// child-composition.test.ts — espejo de backend/src/shared/usecases/tests/child-composition.test.ts.
// Misma fórmula, mismos casos — si el frontend y el backend alguna vez calculan distinto, el
// huésped ve un precio en el widget y le cobran otro al crear la reserva.
import { describe, it, expect } from 'vitest'
import { resolveChildComposition, fitsRoomCapacity, DEFAULT_CHILD_POLICY, type ChildPolicy } from './child-composition'

const POLICY: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

describe('resolveChildComposition', () => {
  it('0-3 años → no consume plaza (ejemplo del pedido)', () => {
    const c = resolveChildComposition(2, [3, 0], POLICY)
    expect(c.freeChildren).toBe(2)
    expect(c.payingChildren).toBe(0)
    expect(c.chargeableOccupancy).toBe(2)
  })

  it('4-12 años → consume plaza, cuenta como ocupante normal', () => {
    const c = resolveChildComposition(2, [5, 10], POLICY)
    expect(c.payingChildren).toBe(2)
    expect(c.chargeableOccupancy).toBe(4)
  })

  it('mayor a 12 → se trata como adulto', () => {
    const c = resolveChildComposition(2, [15], POLICY)
    expect(c.effectiveAdults).toBe(3)
    expect(c.chargeableOccupancy).toBe(3)
  })

  it('edad basura se ignora', () => {
    const c = resolveChildComposition(2, [-1, NaN], POLICY)
    expect(c.effectiveAdults).toBe(2)
    expect(c.payingChildren).toBe(0)
  })

  // Requerimiento 5 (Cálculo de ocupación, 2026-09-03) — fronteras exactas, mismo criterio que
  // el mirror de backend (child-composition.test.ts): si frontend y backend calculan distinto en
  // el borde, el widget muestra un precio y el servidor cobra otro.
  it('edad exactamente en el límite: maxFreeAge es inclusive (libre)', () => {
    expect(resolveChildComposition(2, [3], POLICY).freeChildren).toBe(1)
    expect(resolveChildComposition(2, [4], POLICY).payingChildren).toBe(1)
  })
  it('edad exactamente en el límite: maxChildAge es inclusive (sigue siendo niño)', () => {
    expect(resolveChildComposition(2, [12], POLICY).payingChildren).toBe(1)
    expect(resolveChildComposition(2, [13], POLICY).effectiveAdults).toBe(3)
  })

  it('2 adultos + niño ≤ maxFreeAge → ocupación efectiva 2', () => {
    expect(resolveChildComposition(2, [2], POLICY).chargeableOccupancy).toBe(2)
  })
  it('1 adulto + niño > maxFreeAge → ocupación efectiva 2', () => {
    expect(resolveChildComposition(1, [8], POLICY).chargeableOccupancy).toBe(2)
  })
  it('2 adultos + niño > maxFreeAge → ocupación efectiva 3', () => {
    expect(resolveChildComposition(2, [8], POLICY).chargeableOccupancy).toBe(3)
  })
})

describe('fitsRoomCapacity', () => {
  it('un niño sin plaza NO cuenta contra la capacidad total', () => {
    const c = resolveChildComposition(2, [2], POLICY)
    expect(fitsRoomCapacity({ capacity: 2 }, c)).toBe(true)
  })

  it('maxAdults/maxChildren se respetan cuando están configurados', () => {
    const c = resolveChildComposition(2, [5, 6, 7], POLICY)
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 4, maxChildren: 2 }, c)).toBe(false)
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 4, maxChildren: 3 }, c)).toBe(true)
  })

  // Requerimiento 8 (2026-09-03) — maxChildren es "niños que CONSUMEN plaza": varios niños libres
  // no deben bloquear por maxChildren aunque el número de libres supere el máximo.
  it('maxChildren NO bloquea por niños LIBRES, aunque haya más libres que el máximo', () => {
    const c = resolveChildComposition(2, [0, 1, 2, 3], POLICY) // 4 niños libres, 0 con plaza
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 4, maxChildren: 1 }, c)).toBe(true)
  })

  // Requerimiento 6 (2026-09-03) — cumplir maxAdults y maxChildren por separado no alcanza si la
  // SUMA (capacity total) no entra.
  it('cumple maxAdults y maxChildren individualmente, pero excede capacity total → rechazada', () => {
    const c = resolveChildComposition(3, [5, 6], POLICY) // chargeableOccupancy=5
    expect(fitsRoomCapacity({ capacity: 10, maxAdults: 3, maxChildren: 2 }, c)).toBe(true)
    expect(fitsRoomCapacity({ capacity: 4, maxAdults: 3, maxChildren: 2 }, c)).toBe(false)
  })
})

describe('DEFAULT_CHILD_POLICY', () => {
  it('default = todo niño consume plaza (comportamiento de siempre)', () => {
    const c = resolveChildComposition(2, [5], DEFAULT_CHILD_POLICY)
    expect(c.freeChildren).toBe(0)
    expect(c.payingChildren).toBe(1)
  })
})
