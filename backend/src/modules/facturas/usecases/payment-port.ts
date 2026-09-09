// facturas/usecases/payment-port.ts — Puerto hacia el módulo de pagos.
//
// `payments` es la ÚNICA fuente de verdad del dinero: es la tabla que alimenta el arqueo de caja
// (connector `payments-caja`) y la conciliación bancaria (`payments/usecases/reconciliation.ts`).
//
// Antes, `pay()` escribía un comprobante `type:'payment'` dentro de `invoices` y no avisaba a nadie:
// un cobro en efectivo desde /panel/finanzas/facturacion nunca entraba al turno de caja. Verificado en local —
// ver openspec/changes/billing-money-consolidation/proposal.md.
//
// `facturas` no importa `payments`: declara este puerto y el connector `facturas-payments` inyecta
// la implementación.

import type { Logger } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

export type CanonicalMethod = 'card' | 'cash' | 'transfer' | 'link' | 'deposit' | 'other'

export interface RecordPaymentInput {
  hotelId: string
  invoiceId: string
  guestId?: string | null
  amount: number
  currency: string
  method: CanonicalMethod
  reference?: string
  description?: string
}

export interface RecordedPayment {
  id: string
  status: string
}

export interface PaymentPort {
  recordPayment(input: RecordPaymentInput): Promise<RecordedPayment>
}

/**
 * El método de pago llega con etiquetas heredadas del frontend en español ("Efectivo", "Tarjeta")
 * y de datos viejos. La DB habla inglés y `payments.method` es un enum cerrado: normalizamos acá
 * para que un cobro en efectivo no termine clasificado como `other` y se saltee la caja.
 */
const METHOD_ALIASES: Record<string, CanonicalMethod> = {
  card: 'card', tarjeta: 'card', 'credit card': 'card', credito: 'card', crédito: 'card',
  cash: 'cash', efectivo: 'cash', contado: 'cash',
  transfer: 'transfer', transferencia: 'transfer', wire: 'transfer',
  link: 'link', 'link de pago': 'link', 'payment link': 'link',
  deposit: 'deposit', deposito: 'deposit', depósito: 'deposit',
  other: 'other', otro: 'other',
}

export function normalizePaymentMethod(method: string | null | undefined): CanonicalMethod {
  if (!method) return 'other'
  return METHOD_ALIASES[String(method).trim().toLowerCase()] ?? 'other'
}

/**
 * Registra el cobro. A diferencia del audit log, esto NO es best-effort: si el pago no se puede
 * registrar, el dinero quedaría fuera de caja y de la conciliación. Preferimos fallar el cobro
 * entero — la factura todavía no se tocó — a dejar plata sin asiento.
 *
 * Sin conector es exactamente el mismo daño: antes devolvía `null` con un warning y `payInvoice`
 * seguía adelante marcando la factura `paid` sin fila en `payments`. Plata cobrada en el papel que
 * no existe en la única fuente de verdad, que no entra al arqueo y que no se puede devolver. Ahora
 * falla, y falla antes de tocar la factura.
 */
export async function recordInvoicePayment(
  port: PaymentPort | null,
  logger: Logger,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  if (!port) {
    logger.error('Cobro rechazado: el conector facturas-payments no está registrado', {
      invoiceId: input.invoiceId, amount: input.amount,
    })
    throw new ValidationError(
      'No se puede registrar el cobro: el conector de pagos no está registrado. ' +
      'La factura no fue modificada.',
    )
  }
  const payment = await port.recordPayment(input)
  logger.info('Pago registrado en payments', {
    paymentId: payment.id, invoiceId: input.invoiceId, amount: input.amount,
    method: input.method, status: payment.status,
  })
  return payment
}
