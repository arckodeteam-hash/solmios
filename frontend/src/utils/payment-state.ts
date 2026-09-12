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
