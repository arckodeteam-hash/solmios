// payments/usecases/refund-direct.ts — Devolución de un cobro en EFECTIVO o TRANSFERENCIA.
//
// Espejo de `refund.ts` (tarjeta vía Stripe) para los cobros que no pasaron por una pasarela: no hay
// a quién pedirle el dinero, la devolución la hace el hotel en el mostrador. Lo que se asienta es lo
// mismo: un `payment` nuevo de tipo `refund`, con el mismo método y `completed` (los reportes restan
// `type:'refund'` de lo cobrado), y el cobro original pasa a `refunded`. Idempotente por referencia:
// `<reference del cobro>:refund` cuando el cobro tiene idempotency key `pos:*` (el UNIQUE parcial de
// payments devuelve el asiento ya hecho en vez de duplicarlo); si no, `refund:<paymentId>`.
//
// #214 (COR-5): antes una parte cash/transfer de una cuenta dividida no se podía devolver — el único
// puerto de reembolso era el de Stripe y rechazaba todo lo que no fuera tarjeta.
//
// `recordDirectRefund` es la variante SIN cobro de origen: una devolución por caja de un monto que no
// corresponde a un payment puntual (el excedente de una reserva reprogramada, shared/usecases/
// settle-reschedule-credit.ts). Asienta el mismo `refund` `completed` y deja que el service emita
// `onRefundProcessed` — el evento que la caja escucha para el egreso. Antes ese camino creaba la fila con
// `createPayment` a secas: con COR-D (`createPayment` ya no emite `onPaymentCompleted` para un refund)
// nadie avisaba a caja y la devolución en efectivo no descontaba del cajón.
import { ValidationError, ConflictError } from 'arckode-framework'
import type { PaymentDTO, CreatePaymentDTO } from '../types'
import type { PaymentCrudUseCase } from './payment-crud'

export interface RefundDirectDeps {
  crud: PaymentCrudUseCase
  createPayment(dto: CreatePaymentDTO): Promise<PaymentDTO>
}

export const DIRECT_REFUNDABLE_METHODS = ['cash', 'transfer'] as const

export function directRefundReference(payment: Pick<PaymentDTO, 'id' | 'reference'>): string {
  return payment.reference && payment.reference.startsWith('pos:') ? `${payment.reference}:refund` : `refund:${payment.id}`
}

export async function refundDirectPayment(
  deps: RefundDirectDeps,
  paymentId: string,
  user?: { id?: string; role?: string },
): Promise<PaymentDTO> {
  const payment = await deps.crud.getById(paymentId, user?.id, user?.role)
  if (!(DIRECT_REFUNDABLE_METHODS as readonly string[]).includes(payment.method)) {
    throw new ValidationError('Solo los cobros en efectivo o transferencia se devuelven por acá; la tarjeta se devuelve por Stripe')
  }
  if (payment.type !== 'charge') throw new ValidationError('Solo se devuelve un cobro')
  const reference = directRefundReference(payment)
  if (payment.status === 'refunded') {
    // Ya devuelto: se devuelve el asiento existente (idempotencia por referencia) en vez de repetirlo.
    const existing = await deps.crud.findByReference(payment.hotelId, reference)
    if (existing) return existing
    throw new ConflictError('El cobro ya figura devuelto')
  }
  if (payment.status !== 'completed') throw new ValidationError('Payment not completed')

  const refund = await deps.createPayment({
    hotelId: payment.hotelId,
    type: 'refund',
    method: payment.method,
    status: 'completed',
    amount: payment.amount,
    currency: payment.currency,
    description: `Refund for payment ${paymentId}`,
    reference,
    folioId: payment.folioId,
    invoiceId: payment.invoiceId,
    reservationId: payment.reservationId,
    guestId: payment.guestId,
    metadata: { ...(payment.metadata ?? {}), refundOf: paymentId },
    createdBy: user?.id ?? '',
  } as CreatePaymentDTO)
  await deps.crud.updateStatus(paymentId, 'refunded')
  return refund
}

export interface DirectRefundInput {
  hotelId: string
  method: (typeof DIRECT_REFUNDABLE_METHODS)[number]
  amount: number
  currency?: string
  description?: string
  reservationId?: string
  guestId?: string
  folioId?: string
  invoiceId?: string
  /** Idempotency key (`pos:*` la reclama el UNIQUE parcial de payments); sin ella, asiento liso. */
  reference?: string
  metadata?: Record<string, unknown>
  createdBy?: string
}

/** Asiento `refund` `completed` en efectivo/transferencia sin un cobro de origen (devolución por caja de un monto suelto). */
export async function recordDirectRefund(deps: Pick<RefundDirectDeps, 'createPayment'>, input: DirectRefundInput): Promise<PaymentDTO> {
  if (!(DIRECT_REFUNDABLE_METHODS as readonly string[]).includes(input.method)) {
    throw new ValidationError('Solo se registra por acá una devolución en efectivo o transferencia; la tarjeta se devuelve por Stripe')
  }
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('El monto a devolver debe ser mayor a 0')
  return deps.createPayment({
    hotelId: input.hotelId,
    type: 'refund',
    method: input.method,
    status: 'completed',
    amount,
    currency: input.currency,
    description: input.description,
    reference: input.reference,
    reservationId: input.reservationId,
    guestId: input.guestId,
    folioId: input.folioId,
    invoiceId: input.invoiceId,
    metadata: input.metadata,
    createdBy: input.createdBy ?? '',
  } as CreatePaymentDTO)
}
