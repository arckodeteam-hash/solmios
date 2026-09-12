// connectors/facturas-payments.ts — Conector entre módulos
// Cobrar una factura asienta el dinero en `payments`, la única fuente de verdad: es lo que alimenta
// el arqueo de caja (connector `payments-caja`) y la conciliación bancaria.
//
// Antes `facturas.pay()` escribía un comprobante `type:'payment'` dentro de `invoices` y no emitía
// ningún evento: un cobro en efectivo desde /panel/finanzas/facturacion nunca entraba al turno de caja.
// Ver openspec/changes/billing-money-consolidation/proposal.md (reproducido en local).
//
// #253: la factura emitida desde una reserva pagada online (sin folio) VINCULA los pagos que ya
// están en `payments` (`payments.invoiceId = factura.id`); nunca los crea. Por eso el puerto expone
// `paymentsOfReservation` (filas aún sin factura) y `linkPaymentsToInvoice` (sólo escribe el vínculo).

import type { ConnectorContext } from 'arckode-framework'
import type { RecordPaymentInput, RecordedPayment } from '../modules/facturas'
import type { PaymentDTO } from '../modules/payments'

interface PaymentsModule {
  createPayment: (dto: Record<string, unknown>) => Promise<{ id: string; status: string }>
  unbilledPaymentsOfReservation: (hotelId: string, reservationId: string) => Promise<PaymentDTO[]>
  linkPaymentsToInvoice: (hotelId: string, reservationId: string, paymentIds: string[], invoiceId: string) => Promise<number>
}

export function facturasPaymentsConnector(ctx: ConnectorContext): void {
  const facturas = ctx.resolveModule<{ setPaymentDeps: (p: any) => void }>('facturas')
  const payments = ctx.resolveModule<PaymentsModule>('payments')

  facturas.setPaymentDeps({
    recordPayment: async (input: RecordPaymentInput): Promise<RecordedPayment> => {
      const payment = await payments.createPayment({
        hotelId: input.hotelId,
        invoiceId: input.invoiceId,
        guestId: input.guestId ?? undefined,
        type: 'charge',
        method: input.method,
        // Aplicar un pago a una factura es dinero ya recibido en el mostrador.
        status: 'completed',
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        reference: input.reference,
      })
      return { id: payment.id, status: payment.status }
    },
    // #253 — las filas tal cual (id, type, status, amount, stripeSessionId, invoiceId, reservationId, currency):
    // el usecase de facturas decide cuáles cuentan como pagado.
    paymentsOfReservation: (hotelId: string, reservationId: string): Promise<PaymentDTO[]> =>
      payments.unbilledPaymentsOfReservation(hotelId, reservationId),
    linkPaymentsToInvoice: (hotelId: string, reservationId: string, paymentIds: string[], invoiceId: string): Promise<number> =>
      payments.linkPaymentsToInvoice(hotelId, reservationId, paymentIds, invoiceId),
  })
}
