// dashboard/usecases/payment-status-label.ts — Traduce el estado de pago al vocabulario del
// dashboard. La fórmula NO se recalcula acá: viene de `shared/utils/payment-status`.
//
// El canónico usa 'unpaid' (igual que `reservations.depositStatus`, la columna real). La API del
// dashboard ya publicó 'pending' para ese mismo caso y su frontend lo consume, así que se mapea
// al salir en vez de cambiar el contrato o duplicar la fórmula.

import { paymentStatusOf } from '../../../shared/utils/payment-status'

export type DashboardPaymentStatus = 'paid' | 'partial' | 'pending'

export function dashboardPaymentStatus(totalAmount: unknown, paidAmount: unknown): DashboardPaymentStatus {
  const status = paymentStatusOf(totalAmount, paidAmount)
  return status === 'unpaid' ? 'pending' : status
}
