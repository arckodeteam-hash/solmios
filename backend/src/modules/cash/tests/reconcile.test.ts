// cash/tests/reconcile.test.ts — C2: el arqueo solo cuenta EFECTIVO.
//
// El bug: `expected` sumaba todos los métodos, así que un cobro con tarjeta inflaba el efectivo
// esperado y el sistema acusaba al cajero de un faltante que no existía.

import { describe, it, expect } from 'bun:test'
import { reconcileShift, summarizeMovements } from '../usecases/reconcile'
import type { CashMovementDTO, CashShiftDTO } from '../types'

const mov = (o: Partial<CashMovementDTO>): CashMovementDTO =>
  ({ id: 'm', hotelId: 'h1', shiftId: 's1', type: 'income', amount: 0, method: 'cash', ...o } as CashMovementDTO)

const shift = (openingAmount: number, countedAmount?: number): CashShiftDTO =>
  ({ id: 's1', hotelId: 'h1', openingAmount, countedAmount, status: 'open' } as CashShiftDTO)

describe('reconcileShift — C2: solo efectivo entra al arqueo', () => {
  it('el escenario del auditor: opening 100 + tarjeta 500 + efectivo 200 → esperado 300, no 800', () => {
    const movs = [
      mov({ type: 'income', amount: 500, method: 'card' }),
      mov({ type: 'income', amount: 200, method: 'cash' }),
    ]
    const rec = reconcileShift(shift(100, 300), movs)
    expect(rec.expected).toBe(300)      // 100 opening + 200 efectivo. La tarjeta NO cuenta.
    expect(rec.difference).toBe(0)      // contó 300 y hay 300 → cuadra
    // income total sigue reflejando TODOS los métodos, para información:
    expect(rec.income).toBe(700)
    expect(rec.byMethod.card).toBe(500)
    expect(rec.byMethod.cash).toBe(200)
    // Desglose efectivo explícito (getter de la UI: la cuenta visible del cajón cierra sola).
    expect(rec.cashIncome).toBe(200)
    expect(rec.cashExpense).toBe(0)
  })

  it('un movimiento sin method se asume efectivo (compat datos viejos)', () => {
    const movs = [mov({ type: 'income', amount: 50, method: undefined })]
    const rec = reconcileShift(shift(0, 50), movs)
    expect(rec.expected).toBe(50)
    expect(rec.difference).toBe(0)
  })

  it('egreso en efectivo baja el esperado; egreso por transferencia no', () => {
    const movs = [
      mov({ type: 'income', amount: 300, method: 'cash' }),
      mov({ type: 'expense', amount: 100, method: 'cash' }),
      mov({ type: 'expense', amount: 999, method: 'transfer' }),
    ]
    const rec = reconcileShift(shift(0, 200), movs)
    expect(rec.expected).toBe(200)      // 300 - 100 efectivo; la transferencia de 999 no toca el cajón
    expect(rec.difference).toBe(0)
    expect(rec.cashIncome).toBe(300)    // ingreso efectivo
    expect(rec.cashExpense).toBe(100)   // egreso efectivo (la transferencia de 999 no cuenta)
  })

  it('summarizeMovements separa cash del total', () => {
    const s = summarizeMovements([
      mov({ type: 'income', amount: 500, method: 'card' }),
      mov({ type: 'income', amount: 200, method: 'cash' }),
    ])
    expect(s.income).toBe(700)
    expect(s.cashIncome).toBe(200)
  })
})
