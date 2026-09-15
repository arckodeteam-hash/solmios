// payment-state.ts — badge de estado de pago de una reserva (pendiente/parcial/pagada).
//
// Requerimiento 14 (Administración | Pago realizado, 2026-09-04) / REQ-RWP-04 (listado): el estado
// viene SIEMPRE de `paymentState` del backend (`shared/utils/reservation-balance.ts`), que lo calcula
// desde `payments`. NUNCA se deriva acá de `deposit`/`totalAmount`: esa fórmula vieja podía decir
// "Pendiente" en rojo sobre una reserva ya cobrada por folio/factura en efectivo —ese cobro mueve
// `payments`, nunca `deposit`— contradiciendo al renglón "Pendiente de cobro" de la MISMA tarjeta,
// que sí sale de `payments`. Con el estado del backend, ambos SIEMPRE cierran.
export type PaymentState = 'pending' | 'partial' | 'paid'

export function paymentStateBadge(state?: string | null): { label: string; cls: string } {
  const m: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pendiente', cls: 'bg-coral/10 text-coral' },
    partial: { label: 'Parcial', cls: 'bg-gold/10 text-gold' },
    paid: { label: 'Pagada', cls: 'bg-teal/10 text-teal' },
  }
  return m[state || ''] || { label: '—', cls: 'bg-gray-100 text-gray-500' }
}

/** Lo mínimo de una reserva para decidir el badge de pago. */
export interface PaymentBadgeReservation {
  status?: string | null
  paymentState?: string | null
  cancellationFee?: number | null
  refundAmount?: number | null
  refundStatus?: string | null
}

/**
 * Badge de pago de una reserva, con el caso CANCELADA resuelto.
 *
 * `paymentState` sólo conoce pendiente/parcial/pagada, y en una cancelada lo cobrable es la
 * penalidad: "0 cobrado de 0 a cobrar" sale `pending`. El listado de producción mostraba
 * "Cancelada · Pendiente" en rojo en 11 de 13 canceladas del hotel demo (verificado 2026-09-15),
 * incluso las que nunca se cobraron o ya se devolvieron. En una cancelada lo que importa es qué
 * pasa con la plata:
 *   · hay dinero para devolver y no se devolvió → "A devolver"
 *   · ya se devolvió → "Devuelto"
 *   · el huésped debe la penalidad y no la pagó → "Penalidad pendiente"
 *   · nada que cobrar ni devolver → "Sin saldo"
 */
export function reservationPaymentBadge(r: PaymentBadgeReservation | null | undefined): { label: string; cls: string } {
  if (r?.status !== 'cancelled') return paymentStateBadge(r?.paymentState)
  const refund = Number(r.refundAmount) || 0
  if (refund > 0 && r.refundStatus === 'done') return { label: 'Devuelto', cls: 'bg-purple/10 text-purple' }
  if (refund > 0) return { label: 'A devolver', cls: 'bg-gold/10 text-gold' }
  if ((Number(r.cancellationFee) || 0) > 0 && r.paymentState !== 'paid') return { label: 'Penalidad pendiente', cls: 'bg-coral/10 text-coral' }
  return { label: 'Sin saldo', cls: 'bg-gray-100 text-gray-500' }
}
