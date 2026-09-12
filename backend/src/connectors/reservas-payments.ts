// connectors/reservas-payments.ts — Conector entre módulos (REQ-RWP-06, #249).
// "Registrar pago" manual desde la ficha de la reserva asienta el dinero en `payments`, la única
// fuente de verdad: `reservas` no escribe `deposit` ni sabe cómo se llama la tabla del dinero.
//
// Con la fila en `payments` el resto cae solo, sin código nuevo:
//   · `onPaymentCreated`   (connector `payments-reservas`) resincroniza `pendingAmount` de la reserva.
//   · `onPaymentCompleted` (connector `payments-caja`) lleva el efectivo al turno de caja.
//
// `createdBy` viene del token (lo pone el usecase desde `currentUser.id`), nunca del body: quién
// registró el cobro es dato de auditoría y no lo elige el cliente.

import type { ConnectorContext } from 'arckode-framework'
import type { ManualPaymentInput } from '../modules/reservas/usecases/mark-paid'
import type { ApprovalRefundPort } from '../modules/reservas/usecases/reject'

interface PaymentsModule {
  createPayment: (dto: Record<string, unknown>) => Promise<{ id: string; status: string }>
  refundPayment: (paymentId: string, amount?: number, user?: { id: string; role: string; hotelId?: string }) => Promise<{ id: string; amount: number }>
}

export function reservasPaymentsConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{ setOrchestrationDeps: (deps: any) => void }>('reservas')
  const payments = ctx.resolveModule<PaymentsModule>('payments')

  reservas.setOrchestrationDeps({
    manualPayment: {
      recordManualPayment: async (i: ManualPaymentInput) => {
        const p = await payments.createPayment({
          hotelId: i.hotelId,
          // Columna, no sólo metadata: es el tercer vínculo por el que `reservation-paid.ts`
          // encuentra el cobro (un JSON no se filtra por WHERE).
          reservationId: i.reservationId,
          guestId: i.guestId ?? undefined,
          type: 'charge',
          method: i.method,
          // Registrar un cobro manual es dinero YA recibido en el mostrador.
          status: 'completed',
          amount: i.amount,
          currency: i.currency,
          description: i.description,
          reference: i.reference,
          createdBy: i.createdBy,
          metadata: { reservationId: i.reservationId, source: 'manual' },
        })
        return { id: p.id, status: p.status }
      },
    },
    // #271 MR-06: rechazar una reserva pendiente de aprobación devuelve el 100% de lo cobrado
    // por Stripe. `payments` es quien sabe reembolsar (refund-flows: asiento + audit +
    // `onRefundProcessed`, que resincroniza el saldo de la reserva); reservas sólo dice cuánto.
    approvalRefund: {
      refundPayment: async (paymentId, amount, user) => {
        const r = await payments.refundPayment(paymentId, amount, user)
        return { id: r.id, amount: r.amount }
      },
    } satisfies ApprovalRefundPort,
  })
}
