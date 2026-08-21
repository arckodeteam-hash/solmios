// facturas/usecases/pay-invoice.ts — Aplicación de un pago sobre una factura.
// Extraído del service para mantenerlo < 200 líneas.
//
// Soporta pagos parciales: acumula `amountPaid` y solo pasa a `paid` cuando cubre el total.
//
// El movimiento de dinero se asienta en la tabla `payments` (única fuente de verdad: alimenta el
// arqueo de caja y la conciliación bancaria). Antes se escribía un comprobante `type:'payment'`
// dentro de `invoices` que no llegaba a ningún lado: un cobro en efectivo desde /panel/finanzas/facturacion
// nunca entraba al turno. Ver openspec/changes/billing-money-consolidation.
//
// Orden importante: primero el asiento del dinero, después la factura. Si falla el asiento, el cobro
// entero falla y la factura queda intacta. Al revés dejaría una factura "cobrada" sin plata asociada.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { FacturasDTO, PayFacturasDTO } from '../types'
import { recordInvoicePayment, normalizePaymentMethod, type PaymentPort } from './payment-port'
// Tolerancia de centavos: UNA sola en todo el dominio de dinero (shared/utils/money.ts).
import { BALANCE_EPSILON } from '../../../shared/utils/money'

export interface PayInvoiceResult {
  updated: FacturasDTO
  applied: number
  amountPaid: number
  balance: number
  status: string
  paymentId: string | null
}

export async function payInvoice(
  repo: RepositoryAdapter<FacturasDTO>,
  logger: Logger,
  paymentPort: PaymentPort | null,
  invoice: FacturasDTO,
  dto: PayFacturasDTO,
): Promise<PayInvoiceResult> {
  const total = Number(invoice.amount) || 0
  const applied = Number(dto.amount) || total
  const alreadyPaid = Number(invoice.amountPaid) || 0
  // Sobrepago: cobrar más del saldo pendiente descuenta caja vs saldo sin vuelto ni alerta (el
  // excedente se asienta en payments y la factura queda paid con balance 0). Se rechaza — un
  // excedente va por depósito o nota de crédito, no absorbido en la factura. (folios ya lo valida.)
  const outstanding = total - alreadyPaid
  if (applied > outstanding + BALANCE_EPSILON) {
    throw new ValidationError(`El pago ($${applied}) excede el saldo pendiente ($${outstanding})`)
  }
  const amountPaid = alreadyPaid + applied
  const status = amountPaid >= total ? 'paid' : 'pending'
  const balance = Math.max(0, total - amountPaid)
  const method = normalizePaymentMethod(dto.method)

  // Aplicar un pago a una factura significa que el dinero YA se recibió (el recepcionista registra
  // lo que cobró en el mostrador). Por eso entra `completed`: un cobro pendiente no debería marcar
  // la factura como pagada. Los cobros que esperan confirmación externa nacen en `payments`
  // (chargeCard / payment links), no acá.
  const payment = await recordInvoicePayment(paymentPort, logger, {
    hotelId: invoice.hotelId,
    invoiceId: invoice.id,
    guestId: invoice.guestId ?? null,
    amount: applied,
    currency: invoice.currency,
    method,
    reference: dto.reference,
    description: `Pago de ${invoice.invoiceNumber}`,
  })

  const updated = await repo.update(invoice.id, {
    status,
    amountPaid,
    paymentMethod: method,
    notes: dto.notes ? `${invoice.notes ?? ''}\n${dto.notes}`.trim() : invoice.notes,
    updatedAt: new Date().toISOString(),
  } as any)
  if (!updated) throw new NotFoundError('Factura no encontrada')

  logger.info('Pago aplicado a factura', {
    id: invoice.id, invoiceNumber: invoice.invoiceNumber, applied, amountPaid, total, balance,
    status, method, paymentId: payment?.id ?? null,
  })

  return { updated, applied, amountPaid, balance, status, paymentId: payment?.id ?? null }
}
