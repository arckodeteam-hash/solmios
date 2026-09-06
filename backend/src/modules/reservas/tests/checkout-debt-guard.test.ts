// reservas/tests/checkout-debt-guard.test.ts — No se cierra una estadía debiendo sin confirmarlo.
//
// La regla existía sólo en el panel web (el checkbox de `pages/checkin/index.vue`). El endpoint la
// aceptaba igual, así que la app móvil o cualquier integración cerraba con deuda sin aviso.

import { describe, it, expect } from 'bun:test'
import { assertDebtAcknowledged, remainingDebt } from '../usecases/checkout-debt-guard'

const folio = (balance: number) => ({ folioId: 'f1', balance })

describe('remainingDebt', () => {
  it('sin folio abierto no hay deuda', () => {
    expect(remainingDebt(null, null)).toBe(0)
  })

  it('folio saldado no deja deuda', () => {
    expect(remainingDebt(folio(0), null)).toBe(0)
  })

  it('el cobro del checkout se descuenta del saldo', () => {
    expect(remainingDebt(folio(100), { amount: 60, method: 'cash' })).toBe(40)
  })

  it('un cobro que cubre todo deja la cuenta en cero', () => {
    expect(remainingDebt(folio(100), { amount: 100, method: 'cash' })).toBe(0)
  })

  it('pagar de más no genera deuda negativa', () => {
    expect(remainingDebt(folio(100), { amount: 150, method: 'cash' })).toBe(0)
  })

  // El folio arrastra centavos de los impuestos: 0,004 de diferencia no es una deuda.
  it('una diferencia por debajo del epsilon no cuenta como deuda', () => {
    expect(remainingDebt(folio(100), { amount: 99.999, method: 'cash' })).toBe(0)
  })
})

describe('assertDebtAcknowledged', () => {
  it('corta el checkout si queda saldo y nadie lo confirmó', () => {
    expect(() => assertDebtAcknowledged({ folio: folio(250), settle: null, acknowledgeDebt: false }))
      .toThrow(/250\.00/)
  })

  it('el mensaje dice cuánto se debe, para que el cliente pueda mostrarlo', () => {
    expect(() => assertDebtAcknowledged({ folio: folio(87.5), settle: null, acknowledgeDebt: false }))
      .toThrow(/saldo pendiente de \$87\.50/)
  })

  it('con la confirmación explícita deja pasar', () => {
    expect(() => assertDebtAcknowledged({ folio: folio(250), settle: null, acknowledgeDebt: true }))
      .not.toThrow()
  })

  it('con un cobro que salda la cuenta no hace falta confirmar nada', () => {
    expect(() => assertDebtAcknowledged({ folio: folio(250), settle: { amount: 250, method: 'cash' }, acknowledgeDebt: false }))
      .not.toThrow()
  })

  it('un cobro PARCIAL sigue necesitando confirmación por lo que queda', () => {
    expect(() => assertDebtAcknowledged({ folio: folio(250), settle: { amount: 100, method: 'cash' }, acknowledgeDebt: false }))
      .toThrow(/150\.00/)
  })

  it('sin folio abierto el checkout pasa sin fricción', () => {
    expect(() => assertDebtAcknowledged({ folio: null, settle: null, acknowledgeDebt: false })).not.toThrow()
  })

  // El error tiene que ser 409 para que el borde HTTP lo traduzca: un 500 haría que el panel
  // muestre "error del servidor" en vez del saldo.
  it('el corte es un ConflictError (409), no un error genérico', () => {
    try {
      assertDebtAcknowledged({ folio: folio(10), settle: null, acknowledgeDebt: false })
      throw new Error('debió cortar')
    } catch (e: any) {
      expect(e.name).toBe('ConflictError')
    }
  })
})
