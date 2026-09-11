// cash/tests/auto-movements.test.ts — Movimientos de caja generados por conectores.
//
// Regresión: los egresos vivían en dos silos sin cruzar (`expenses` vs `cash_movements`), así que
// un gasto en efectivo nunca aparecía en el arqueo del turno.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import {
  registerPaymentIncome, registerExpenseOutflow, removeExpenseOutflow, registerRefundOutflow,
  type AutoMovementDeps,
} from '../usecases/auto-movements'
import { reconcileShift } from '../usecases/reconcile'
import type { CashShiftDTO } from '../types'
import type { CashMovementDTO } from '../types'

function makeDeps(rows: Partial<CashMovementDTO>[] = []) {
  const created: Record<string, any>[] = []
  const deleted: string[] = []
  const deps: AutoMovementDeps = {
    repo: {
      findMany: async (f: any) => rows.filter(r => Object.entries(f ?? {}).every(([k, v]) => (r as any)[k] === v)),
      create: async (d: any) => { created.push(d); return { id: 'mov1', ...d } },
      delete: async (id: string) => { deleted.push(id); return true },
    } as unknown as RepositoryAdapter<CashMovementDTO>,
    logger: silentLogger(),
    resolveShift: async () => 'shift1',
  }
  return { deps, created, deleted }
}

const expense = { hotelId: 'h1', expenseId: 'e1', amount: 250, concept: 'Nafta' }

describe('registerExpenseOutflow', () => {
  it('asienta un egreso de efectivo en el turno abierto', async () => {
    const { deps, created } = makeDeps()

    const mov = await registerExpenseOutflow(deps, expense)

    expect(mov).not.toBeNull()
    expect(created[0].type).toBe('expense')
    expect(created[0].method).toBe('cash')
    expect(created[0].source).toBe('expense_connector')
    expect(created[0].expenseId).toBe('e1')
    expect(created[0].shiftId).toBe('shift1')
  })

  // El arqueo hace `expected = opening + income - expense`: si el monto fuese negativo, sumaría.
  it('guarda el monto POSITIVO, porque el arqueo lo resta', async () => {
    const { deps, created } = makeDeps()

    await registerExpenseOutflow(deps, expense)

    expect(created[0].amount).toBe(250)
  })

  it('no duplica el egreso si el gasto se edita (dedup por expenseId)', async () => {
    const { deps, created } = makeDeps([{ id: 'mov1', expenseId: 'e1' }])

    const mov = await registerExpenseOutflow(deps, expense)

    expect(mov).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('ignora montos no positivos', async () => {
    const { deps, created } = makeDeps()

    expect(await registerExpenseOutflow(deps, { ...expense, amount: 0 })).toBeNull()
    expect(await registerExpenseOutflow(deps, { ...expense, amount: -10 })).toBeNull()
    expect(created).toHaveLength(0)
  })
})

describe('removeExpenseOutflow', () => {
  it('revierte el egreso cuando el gasto deja de ser efectivo', async () => {
    const { deps, deleted } = makeDeps([{ id: 'mov1', expenseId: 'e1' }])

    expect(await removeExpenseOutflow(deps, 'e1')).toBe(true)
    expect(deleted).toEqual(['mov1'])
  })

  it('es idempotente: revertir dos veces no explota', async () => {
    const { deps, deleted } = makeDeps()

    expect(await removeExpenseOutflow(deps, 'e1')).toBe(false)
    expect(deleted).toHaveLength(0)
  })
})

describe('registerPaymentIncome', () => {
  it('asienta el ingreso y lo marca como automático', async () => {
    const { deps, created } = makeDeps()

    await registerPaymentIncome(deps, { hotelId: 'h1', paymentId: 'p1', amount: 100 })

    expect(created[0].type).toBe('income')
    expect(created[0].source).toBe('payment_connector')
    expect(created[0].paymentId).toBe('p1')
  })

  it('no duplica el ingreso si el conector reentra (dedup por paymentId)', async () => {
    const { deps, created } = makeDeps([{ id: 'mov1', hotelId: 'h1', paymentId: 'p1' }])

    expect(await registerPaymentIncome(deps, { hotelId: 'h1', paymentId: 'p1', amount: 100 })).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('no cruza hoteles al deduplicar', async () => {
    const { deps, created } = makeDeps([{ id: 'mov1', hotelId: 'h2', paymentId: 'p1' }])

    expect(await registerPaymentIncome(deps, { hotelId: 'h1', paymentId: 'p1', amount: 100 })).not.toBeNull()
    expect(created).toHaveLength(1)
  })

  // #212: desde la caja del restaurante tiene que verse QUÉ comanda y mesa fue, y poder abrirla.
  it('hereda la referencia y el concepto del cobro (comanda + mesa), en el register del POS', async () => {
    const { deps, created } = makeDeps()

    await registerPaymentIncome(deps, {
      hotelId: 'h1', paymentId: 'p1', amount: 100, register: 'restaurant',
      reference: 'pos:o1', concept: 'Comanda CMD-2026-0007 · Mesa 3',
    })

    expect(created[0].reference).toBe('pos:o1')
    expect(created[0].concept).toBe('Comanda CMD-2026-0007 · Mesa 3')
    expect(created[0].register).toBe('restaurant')
  })

  it('sin descripción del cobro, el concepto cae a "Pago automático" (nunca vacío)', async () => {
    const { deps, created } = makeDeps()

    await registerPaymentIncome(deps, { hotelId: 'h1', paymentId: 'p1', amount: 100, concept: '   ' })

    expect(created[0].concept).toBe('Pago automático')
  })
})

// #214 (COR-B): la devolución en efectivo de una parte (o de cualquier cobro) sale del cajón. Sin el
// egreso, `reconcileShift` seguía contando el ingreso original y el cierre pedía justificar un faltante.
describe('registerRefundOutflow', () => {
  const income = { id: 'mov-in', hotelId: 'h1', paymentId: 'p1', type: 'income', amount: 60, method: 'cash', register: 'restaurant', shiftId: 'shift0', reference: 'pos:o1:2', concept: 'Comanda CMD-2026-0007 · Mesa 3 · parte 2' } as Partial<CashMovementDTO>
  const refund = { hotelId: 'h1', paymentId: 'r1', refundOfPaymentId: 'p1', amount: 60, reference: 'pos:o1:2:refund', register: 'reception' as const }

  it('asienta un egreso cash en la caja del ingreso, con "Devolución" + el concepto del cobro y la referencia del cobro original', async () => {
    const { deps, created } = makeDeps([income])
    const mov = await registerRefundOutflow(deps, refund)
    expect(mov).not.toBeNull()
    expect(created[0]).toMatchObject({
      type: 'expense', method: 'cash', amount: 60, source: 'payment_connector', category: 'refund',
      paymentId: 'r1', reference: 'pos:o1:2', register: 'restaurant', shiftId: 'shift1',
      concept: 'Devolución · Comanda CMD-2026-0007 · Mesa 3 · parte 2',
    })
  })

  it('sin el ingreso original (caja caída al cobrar), usa el register y la referencia que manda el conector', async () => {
    const { deps, created } = makeDeps()
    await registerRefundOutflow(deps, { ...refund, concept: 'Refund for payment p1' })
    expect(created[0]).toMatchObject({ type: 'expense', register: 'reception', reference: 'pos:o1:2:refund', concept: 'Devolución · Refund for payment p1' })
  })

  it('dedup por el payment de la devolución: el mismo refund dos veces no saca plata dos veces', async () => {
    const { deps, created } = makeDeps([income, { id: 'mov-out', hotelId: 'h1', paymentId: 'r1' }])
    expect(await registerRefundOutflow(deps, refund)).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('monto ≤ 0 → no asienta nada', async () => {
    const { deps, created } = makeDeps([income])
    expect(await registerRefundOutflow(deps, { ...refund, amount: 0 })).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('el arqueo con ingreso 100 + devolución 60 espera opening + 40 (no + 100)', () => {
    const shift = { id: 's1', hotelId: 'h1', openingAmount: 500, countedAmount: 540, status: 'open' } as CashShiftDTO
    const movs = [
      { id: 'a', hotelId: 'h1', shiftId: 's1', type: 'income', amount: 100, method: 'cash', paymentId: 'p1' },
      { id: 'b', hotelId: 'h1', shiftId: 's1', type: 'expense', amount: 60, method: 'cash', paymentId: 'r1', category: 'refund' },
    ] as CashMovementDTO[]
    const rec = reconcileShift(shift, movs)
    expect(rec.expected).toBe(540)
    expect(rec.difference).toBe(0)
    expect(rec.cashExpense).toBe(60)
  })
})
