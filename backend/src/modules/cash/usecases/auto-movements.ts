// cash/usecases/auto-movements.ts — Movimientos de caja generados por conectores, no por un humano.
//
// Solo el EFECTIVO mueve el cajón físico. Un cobro o un gasto por tarjeta/transferencia ya está
// bancarizado: entra a `payments` y a la conciliación, pero no al arqueo del turno.
//
//   payments-caja → registerPaymentIncome  (dedup por paymentId)
//   gastos-caja   → registerExpenseOutflow (dedup por expenseId) / removeExpenseOutflow
//
// El arqueo calcula `expected = opening + income - expense`, así que un egreso se asienta con
// `type: 'expense'` y monto POSITIVO (ver usecases/reconcile.ts).
//
// La dedup no es opcional: los conectores reaccionan a create Y update, y una entidad se edita
// varias veces. Sin ella, cada edición movería plata de nuevo.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { CashMovementDTO, CashRegister } from '../types'

export interface AutoMovementDeps {
  repo: RepositoryAdapter<CashMovementDTO>
  logger: Logger
  resolveShift(hotelId: string, register?: CashRegister): Promise<string | null>
  onCreated?(movement: CashMovementDTO): Promise<void>
  onDeleted?(id: string): Promise<void>
}

export interface PaymentIncomeInput {
  hotelId: string
  paymentId: string
  amount: number
  reservationId?: string
  folioId?: string
  method?: string
  reference?: string
  /** Concepto legible del cobro (la `description` del payment: "Comanda CMD-2026-0007 · Mesa 3").
   *  #212: sin esto el movimiento decía "Pago automático" y desde la caja no se sabía qué mesa fue. */
  concept?: string
  /** De qué punto de venta vino el cobro (default reception). Lo decide el conector según el origen del payment, nunca el cliente. */
  register?: CashRegister
}

/** Ingreso por un pago en efectivo ya cobrado. Idempotente por `paymentId`. */
export async function registerPaymentIncome(
  deps: AutoMovementDeps,
  input: PaymentIncomeInput,
): Promise<CashMovementDTO | null> {
  const existing = await deps.repo.findMany({ hotelId: input.hotelId, paymentId: input.paymentId } as any)
  if (existing.length > 0) {
    deps.logger.info('registerPaymentIncome: ya registrado (dedup)', { paymentId: input.paymentId })
    return null
  }

  const register = input.register || 'reception'
  const shiftId = await deps.resolveShift(input.hotelId, register)
  const item = await deps.repo.create({
    hotelId: input.hotelId, shiftId: shiftId || null, register,
    type: 'income', amount: input.amount, method: (input.method as any) || 'cash',
    concept: input.concept?.trim() || 'Pago automático', category: 'payment', source: 'payment_connector',
    reservationId: input.reservationId, folioId: input.folioId,
    paymentId: input.paymentId, reference: input.reference,
  } as Omit<CashMovementDTO, 'id'>)

  await deps.onCreated?.(item)
  deps.logger.info('registerPaymentIncome: ingreso creado', { paymentId: input.paymentId, amount: input.amount })
  return item
}

export interface ExpenseOutflowInput {
  hotelId: string
  expenseId: string
  amount: number
  concept?: string
  category?: string
  reference?: string
}

/** Movimiento de caja generado por un gasto, si existe. Búsqueda por expenseId (UUID, único). */
async function findByExpense(deps: AutoMovementDeps, expenseId: string): Promise<CashMovementDTO | null> {
  if (!expenseId) return null
  const rows = await deps.repo.findMany({ expenseId } as any)
  return rows[0] ?? null
}

/** Egreso por un gasto pagado en efectivo. Idempotente por `expenseId`. */
export async function registerExpenseOutflow(
  deps: AutoMovementDeps,
  input: ExpenseOutflowInput,
): Promise<CashMovementDTO | null> {
  if (input.amount <= 0) return null

  const existing = await findByExpense(deps, input.expenseId)
  if (existing) {
    deps.logger.info('registerExpenseOutflow: ya registrado (dedup)', { expenseId: input.expenseId })
    return null
  }

  const shiftId = await deps.resolveShift(input.hotelId)
  const item = await deps.repo.create({
    hotelId: input.hotelId, shiftId: shiftId || null,
    type: 'expense', amount: input.amount, method: 'cash',
    concept: input.concept || 'Gasto en efectivo',
    category: input.category || 'expense',
    source: 'expense_connector',
    expenseId: input.expenseId, reference: input.reference,
  } as Omit<CashMovementDTO, 'id'>)

  await deps.onCreated?.(item)
  deps.logger.info('registerExpenseOutflow: egreso creado', { expenseId: input.expenseId, amount: input.amount })
  return item
}

/**
 * Revierte el egreso: el gasto se borró, se marcó como impago, o cambió a un método bancarizado.
 * Sin esto, editar un gasto de efectivo a transferencia dejaría plata saliendo del cajón para siempre.
 */
export async function removeExpenseOutflow(deps: AutoMovementDeps, expenseId: string): Promise<boolean> {
  const existing = await findByExpense(deps, expenseId)
  if (!existing) return false

  const deleted = await deps.repo.delete(existing.id)
  if (!deleted) return false

  await deps.onDeleted?.(existing.id)
  deps.logger.info('removeExpenseOutflow: egreso revertido', { expenseId, movementId: existing.id })
  return true
}
