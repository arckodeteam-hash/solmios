// cash/usecases/from-payments.ts — Qué hace la caja con un evento de `payments` (lo cablea connectors/payments-caja.ts).
//
// Solo el EFECTIVO mueve el cajón físico (tarjeta/transferencia ya están bancarizados). El punto de
// venta (`register`) lo decide `payment.metadata.source`, que tagea el módulo que originó el cobro
// (restaurante-payments.ts pone 'restaurant'); todo lo demás (folios, links de pago, cargos de reserva)
// cae en 'reception' — el mostrador, comportamiento histórico. Nunca lo decide el cliente.
//
//   onPaymentCompleted (un COBRO cash entró)      → registerPaymentIncome  (ingreso, dedup por paymentId)
//   onRefundProcessed  (una DEVOLUCIÓN cash salió) → registerRefundOutflow  (egreso, dedup por el id del refund; #214 COR-B)
//
// Best-effort: si caja no está cargada o falla, el cobro/la devolución en payments no se cae.
import type { CashRegister } from '../types'
import type { PaymentIncomeInput, RefundOutflowInput } from './auto-movements'

export interface CashFromPaymentsPort {
  registerPaymentIncome(input: PaymentIncomeInput): Promise<unknown>
  registerRefundOutflow(input: RefundOutflowInput): Promise<unknown>
}

/** Forma mínima del `PaymentDTO` que la caja necesita (no importa el módulo payments). */
export interface PaymentLike {
  id: string
  hotelId: string
  type?: string
  method?: string
  amount: number
  folioId?: string | null
  reference?: string
  description?: string
  metadata?: Record<string, unknown> | null
}

const registerOf = (p: PaymentLike): CashRegister => (p.metadata?.source === 'restaurant' ? 'restaurant' : 'reception')

/** Cobro completado → ingreso en la caja del punto de venta. Un asiento `refund` NUNCA es un ingreso (defensa: payments ya no emite onPaymentCompleted para ellos, COR-D). */
export async function cashIncomeFromPayment(port: () => CashFromPaymentsPort, payment: PaymentLike): Promise<void> {
  if (payment.method !== 'cash' || payment.type === 'refund') return
  try {
    await port().registerPaymentIncome({
      hotelId: payment.hotelId,
      paymentId: payment.id,
      amount: payment.amount,
      method: 'cash',
      folioId: payment.folioId ?? undefined, // V23: PaymentDTO no tiene reservationId
      // #212: el movimiento hereda la referencia (`pos:<orderId>` en el POS → enlace a la comanda
      // desde la caja) y la descripción del cobro como concepto ("Comanda CMD-2026-0007 · Mesa 3").
      reference: payment.reference,
      concept: payment.description,
      register: registerOf(payment),
    })
  } catch { /* best-effort */ }
}

/** Devolución procesada → egreso de la MISMA caja del cobro (`refund-direct.ts` copia `metadata` del cobro y agrega `refundOf`). */
export async function cashOutflowFromRefund(port: () => CashFromPaymentsPort, refund: PaymentLike): Promise<void> {
  // La devolución hereda el método del cobro: solo el efectivo vuelve a salir del cajón.
  if (refund.method !== 'cash') return
  try {
    const refundOf = refund.metadata?.refundOf
    await port().registerRefundOutflow({
      hotelId: refund.hotelId,
      paymentId: refund.id,
      refundOfPaymentId: typeof refundOf === 'string' ? refundOf : undefined,
      amount: refund.amount,
      reference: refund.reference,
      concept: refund.description,
      register: registerOf(refund),
    })
  } catch { /* best-effort */ }
}
