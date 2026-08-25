// cash/usecases/reconcile.ts — Arqueo de turno (funciones puras, sin side-effects).
//
// El arqueo compara el EFECTIVO esperado contra lo contado en el cajón. Un cobro con tarjeta o
// transferencia NUNCA entra al cajón, así que NO puede contar para el `expected`: si lo hiciera,
// un cobro con tarjeta de 500 haría que el arqueo reclame 500 de más y acuse al cajero de un
// faltante que no existe. Por eso `expected` suma solo `method === 'cash'` (un movimiento sin
// method se asume efectivo). `income`/`expense` siguen siendo los totales de TODOS los métodos,
// para información; el desglose por método va en `byMethod`.

import type { CashMovementDTO, CashShiftDTO, ReconcileResult } from '../types'

const isCash = (m: CashMovementDTO): boolean => (m.method || 'cash') === 'cash'

/** Suma ingresos/egresos (todos los métodos) + solo-efectivo + desglose por método. Pura.
 *
 * `byMethod` es el flujo BRUTO por método (ingresos y egresos suman positivo — sirve para ver
 * movimiento). `byMethodNet` es el NETO firmado (ingreso +, egreso −): es el "esperado" por
 * método que usa el arqueo de cierre de la UI — sumar bruto ahí haría que un egreso en efectivo
 * de $200 inflara el esperado del cajón en $400 (el egreso sale, no entra dos veces). */
export function summarizeMovements(movs: CashMovementDTO[]) {
  let income = 0, expense = 0, cashIncome = 0, cashExpense = 0
  const byMethod: Record<string, number> = {}
  const byMethodNet: Record<string, number> = {}
  for (const m of movs) {
    const isIn = m.type === 'income' || m.type === 'opening'
    const isOut = m.type === 'expense' || m.type === 'closing'
    if (isIn) { income += m.amount; if (isCash(m)) cashIncome += m.amount }
    else if (isOut) { expense += m.amount; if (isCash(m)) cashExpense += m.amount }
    const mk = m.method || 'cash'
    byMethod[mk] = (byMethod[mk] || 0) + m.amount
    byMethodNet[mk] = (byMethodNet[mk] || 0) + (isIn ? m.amount : isOut ? -m.amount : 0)
  }
  return { income, expense, cashIncome, cashExpense, byMethod, byMethodNet }
}

/** Calcula el arqueo completo de un turno. Pura. */
export function reconcileShift(shift: CashShiftDTO, movs: CashMovementDTO[]): ReconcileResult {
  const { income, expense, cashIncome, cashExpense, byMethod, byMethodNet } = summarizeMovements(movs)
  const opening = shift.openingAmount || 0
  // Solo el efectivo está en el cajón físico → solo el efectivo forma el esperado.
  const expected = opening + cashIncome - cashExpense
  const counted = shift.countedAmount ?? 0
  // cashIncome/cashExpense van explícitos para que la UI muestre la cuenta que arma el esperado
  // ("fondo + ingresos efectivo − egresos efectivo") sin derivarla de byMethod/byMethodNet.
  return { shift, opening, income, expense, cashIncome, cashExpense, expected, counted, difference: counted - expected, byMethod, byMethodNet }
}
