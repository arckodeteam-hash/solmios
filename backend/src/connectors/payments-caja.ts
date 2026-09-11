// connectors/payments-caja.ts — Conector payments→caja. SOLO cablea: la regla (solo efectivo, qué
// cajón, dedup) vive en cash/usecases/from-payments.ts + auto-movements.ts.
//   onPaymentCompleted (cobro cash)      → ingreso automático en caja (dedup por paymentId).
//   onRefundProcessed  (devolución cash) → egreso automático en la misma caja (#214 COR-B: sin esto el
//                                          arqueo seguía contando el cobro y el cierre pedía justificar
//                                          un "faltante" que era una devolución en mano).
// Best-effort: si caja no está disponible, no falla el módulo payments.

import type { ConnectorContext } from 'arckode-framework'
import { cashIncomeFromPayment, cashOutflowFromRefund, type CashFromPaymentsPort } from '../modules/cash'

export function paymentsCajaConnector(ctx: ConnectorContext): void {
  const payments = ctx.resolveModule<{ setSockets: (s: any) => void }>('payments')
  const caja = () => ctx.resolveModule<CashFromPaymentsPort>('caja')

  payments.setSockets({
    onPaymentCompleted: (payment: any) => cashIncomeFromPayment(caja, payment),
    onRefundProcessed: (refund: any) => cashOutflowFromRefund(caja, refund),
  })
}
