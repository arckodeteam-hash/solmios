// reservas/usecases/mark-paid.ts — Registrar un pago MANUAL sobre una reserva (REQ-RWP-06, #249).
//
// El huésped pagó fuera de Stripe (efectivo en mostrador, transferencia, POS) y el hotel necesita
// que la reserva refleje esa plata. Antes la única forma era tocar `deposit` a mano en el alta o
// pasar por folio/factura — y `deposit` NO es el libro del dinero (ver
// `shared/usecases/reservation-paid.ts`): un cobro anotado ahí es invisible para caja y reportes.
//
// Por eso acá NO se escribe `deposit`. El cobro se asienta en `payments` a través del puerto
// `ManualPaymentPort` (lo cablea `connectors/reservas-payments.ts`), que es la única fuente de
// verdad del dinero. `pendingAmount` se recalcula con `pendingBalance` sobre lo ya cobrado + este
// cobro, con la misma fórmula que usa el resto del módulo — nunca una resta a mano.
//
// Orden importante (mismo criterio que `facturas/usecases/pay-invoice.ts`): PRIMERO la plata,
// después la reserva. Si el asiento en `payments` falla, la reserva queda intacta; al revés
// quedaría una reserva "pagada" sin ninguna fila de dinero que lo respalde.
//
// Fail-closed sin puerto: devolver "ok" sin asentar nada sería exactamente el bug que este usecase
// cierra. Mismo criterio que `requireMoneyPort` (usecases/money-port.ts).

import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, Logger, RepositoryAdapter } from 'arckode-framework'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import type { AddonSource } from '../../../shared/usecases/sync-reservation-pending'
import { auditSafely, type AuditPort } from '../../../shared/usecases/audit'
import { pendingBalance, paymentState } from '../../../shared/utils/reservation-balance'
import { BALANCE_EPSILON, round2 } from '../../../shared/utils/money'
import type { ReservationChangedNotifier } from './reservation-changed'

export type ManualPaymentMethod = 'cash' | 'transfer' | 'card' | 'other'

/** Lo que el puerto necesita para asentar UNA fila `charge`/`completed` en `payments`. */
export interface ManualPaymentInput {
  hotelId: string
  reservationId: string
  guestId?: string | null
  amount: number
  currency: string
  method: ManualPaymentMethod
  reference?: string
  description: string
  /** Del token, nunca del body: quién registró el cobro es dato de auditoría. */
  createdBy: string
  note?: string
}

/** Puerto de ESCRITURA del cobro manual. Lo cablea `connectors/reservas-payments.ts`. */
export interface ManualPaymentPort {
  recordManualPayment(input: ManualPaymentInput): Promise<{ id: string; status: string }>
}

export interface MarkPaidDTO {
  method: ManualPaymentMethod
  amount: number
  reference?: string
  note?: string
}

export interface MarkPaidDeps {
  repo: RepositoryAdapter<any>
  addonsOf: AddonSource
  paidOf: PaidSource
  port: ManualPaymentPort | undefined
  auditPort: AuditPort | null
  logger: Logger
  notifyChanged: ReservationChangedNotifier
}

/** Sin puerto no hay dónde asentar la plata: se rompe fuerte en vez de "confirmar" en el aire. */
function requireManualPaymentPort(port: ManualPaymentPort | undefined | null): ManualPaymentPort {
  if (!port) throw new Error('reservas: falta el puerto de cobro manual (connectors/reservas-payments no cableado)')
  return port
}

/** Transferencia y tarjeta dejan rastro externo: sin referencia no hay con qué conciliar. */
const METHODS_WITH_REFERENCE = new Set<ManualPaymentMethod>(['transfer', 'card'])

/**
 * Registra un cobro manual sobre una reserva.
 * 404 si no existe o es de otro hotel (ownership). 409 si la reserva está cancelada / no-show.
 * 400 si el monto no es positivo, falta la referencia (transfer/card) o excede el saldo pendiente.
 */
export async function markReservationPaid(
  deps: MarkPaidDeps,
  id: string,
  dto: MarkPaidDTO,
  currentUser: { id: string; role: string; hotelId?: string },
  auth: Auth,
): Promise<any> {
  const amount = round2(Number(dto.amount) || 0)
  if (amount <= 0) throw new ValidationError('El monto del cobro debe ser mayor a cero')
  const method = dto.method
  const reference = String(dto.reference ?? '').trim() || undefined
  const note = String(dto.note ?? '').trim() || undefined
  if (METHODS_WITH_REFERENCE.has(method) && !reference) {
    throw new ValidationError('La referencia es obligatoria para transferencia y tarjeta')
  }

  const item = await deps.repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings (mem
  // ownership-bug). Post-findById obligatorio (regla CLAUDE.md + analyzer).
  auth.assertOwnership(item.hotelId, currentUser.hotelId ?? '', currentUser.role, 'super_admin')

  if (item.status === 'cancelled' || item.status === 'no_show') {
    throw new ConflictError('No se puede registrar un cobro sobre una reserva cancelada')
  }

  const addons = await deps.addonsOf(id, item.hotelId)
  const paid = await deps.paidOf(id, item)
  const pending = pendingBalance(item, addons, paid)
  // Sobrepago: igual que en facturas, el excedente no se absorbe en silencio — va por depósito o
  // nota de crédito, no escondido en un `pendingAmount` recortado a 0.
  if (amount > pending + BALANCE_EPSILON) {
    throw new ValidationError(`El cobro ($${amount}) excede el saldo pendiente ($${pending})`)
  }

  // PRIMERO la plata. Si esto falla, la reserva no se toca.
  const port = requireManualPaymentPort(deps.port)
  const payment = await port.recordManualPayment({
    hotelId: item.hotelId,
    reservationId: id,
    guestId: item.guestId ?? null,
    amount,
    currency: item.currency ?? 'USD',
    method,
    reference,
    description: `Cobro manual · ${method}${note ? ` · ${note}` : ''}`,
    createdBy: currentUser.id,
    note,
  })

  const paidAmount = round2(paid + amount)
  const pendingAmount = pendingBalance(item, addons, paidAmount)
  // Sólo `pending → confirmed` (state-machine.ts lo permite): un cobro sobre una reserva ya
  // confirmada o con check-in no la mueve de estado.
  const updated = await deps.repo.update(id, {
    ...(item.status === 'pending' ? { status: 'confirmed' } : {}),
    pendingAmount,
  })
  await deps.notifyChanged(updated)

  await auditSafely(deps.auditPort, deps.logger, {
    hotelId: item.hotelId,
    userId: currentUser.id,
    action: 'reservation.marked_paid',
    entity: 'reservation',
    entityId: id,
    detail: `Cobro manual ${method} $${amount}${reference ? ` ref ${reference}` : ''} — payment ${payment.id}`,
  })

  return {
    ...updated,
    paymentId: payment.id,
    paidAmount,
    pendingAmount,
    paymentState: paymentState(item, addons, paidAmount),
  }
}
