// payment-state.test.ts — el badge de pago del listado y del modal sale de `paymentState` del
// backend; acá se fija el mapeo estado → etiqueta/color para que ambos lugares pinten lo mismo.
import { describe, it, expect } from 'vitest'
import { paymentStateBadge } from './payment-state'

describe('paymentStateBadge — estado de pago → badge', () => {
  it('pending → "Pendiente" en coral', () => {
    const b = paymentStateBadge('pending')
    expect(b.label).toBe('Pendiente')
    expect(b.cls).toBe('bg-coral/10 text-coral')
  })

  it('partial → "Parcial" en dorado', () => {
    const b = paymentStateBadge('partial')
    expect(b.label).toBe('Parcial')
    expect(b.cls).toBe('bg-gold/10 text-gold')
  })

  it('paid → "Pagada" en teal', () => {
    const b = paymentStateBadge('paid')
    expect(b.label).toBe('Pagada')
    expect(b.cls).toBe('bg-teal/10 text-teal')
  })

  it('desconocido/vacío → "—" en gris (respuestas sin paymentState no inventan estado)', () => {
    for (const s of ['otro', '', null, undefined]) {
      const b = paymentStateBadge(s)
      expect(b.label).toBe('—')
      expect(b.cls).toBe('bg-gray-100 text-gray-500')
    }
  })
})
