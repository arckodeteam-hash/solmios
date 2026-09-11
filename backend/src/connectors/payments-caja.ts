// connectors/payments-caja.ts — Conector payments→caja.
// Cuando un pago cash se completa (onPaymentCompleted), registra un ingreso automático en caja.
// Así caja deja de ser módulo isla y concilia con los pagos reales del hotel.
// Dedup por paymentId dentro de CashService.registerPaymentIncome (no duplica en re-entradas).
// Best-effort: si caja no está disponible, no falla el módulo payments.
//
// register: qué cajón físico recibe el efectivo. payment.metadata.source lo tagea el módulo que
// originó el cobro (restaurante-payments.ts pone 'restaurant'); todo lo demás (folios, links de
// pago, cargos de reserva) cae en 'reception' — es el mostrador, comportamiento histórico.

import type { ConnectorContext } from 'arckode-framework'

export function paymentsCajaConnector(ctx: ConnectorContext): void {
  const payments = ctx.resolveModule<{ setSockets: (s: any) => void }>('payments')

  payments.setSockets({
    onPaymentCompleted: async (payment: any) => {
      // Solo los pagos en efectivo impactan la caja física (tarjeta/transfer ya están bancarizados).
      if (payment.method !== 'cash') return
      try {
        const caja = ctx.resolveModule<{ registerPaymentIncome: (i: any) => Promise<any> }>('caja')
        const register = payment.metadata?.source === 'restaurant' ? 'restaurant' : 'reception'
        await caja.registerPaymentIncome({
          hotelId: payment.hotelId,
          paymentId: payment.id,
          amount: payment.amount,
          method: 'cash',
          folioId: payment.folioId, // V23: PaymentDTO no tiene reservationId
          // #212: el movimiento hereda la referencia (`pos:<orderId>` en el POS → enlace a la comanda
          // desde la caja) y la descripción del cobro como concepto ("Comanda CMD-2026-0007 · Mesa 3").
          reference: payment.reference,
          concept: payment.description,
          register,
        })
      } catch {
        // Conector best-effort: no falla el módulo principal si caja no resuelve.
      }
    },
  })
}
