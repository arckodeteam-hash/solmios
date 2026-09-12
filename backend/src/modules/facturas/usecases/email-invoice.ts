// facturas/usecases/email-invoice.ts — Envío de factura por email.
// Delega al EmailService.transaccional (cola persistente + reintentos con backoff + SMTP/Resend).
// Usa un puerto mínimo (InvoiceEmailPort) por duck typing — no acopla al service concreto ni
// al puerto EmailSender (orientado a eventos). EmailService.enqueue cumple este contrato.

import type { RepositoryAdapter } from 'arckode-framework'
import type { FacturasDTO } from '../types'
import { renderInvoiceHtml } from './invoice-template'
import { hotelHeaderOf } from './hotel-header'

export interface EmailInvoiceResult {
  sent: boolean
  to: string
  subject: string
  messageId: string
  configured: boolean
}

/** Puerto mínimo: lo único que facturas necesita del EmailService. EmailService lo cumple. */
export interface InvoiceEmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string }): Promise<string>
  /** ¿El hotel tiene SMTP o Resend configurado? Si no, el email se encolaría pero nunca se entregaría. */
  isConfigured(hotelId: string): Promise<boolean>
}

const TYPE_LABEL: Record<string, string> = {
  invoice: 'Factura', credit_note: 'Nota de crédito', receipt: 'Recibo', folio: 'Cargo', payment: 'Comprobante de pago',
}

/** Encola el envío de una factura por email. Resuelve los datos del hotel (nombre, dirección, teléfono, email) para el asunto/template. */
export async function sendInvoiceByEmail(args: {
  invoice: FacturasDTO
  to: string
  hotelRepo?: RepositoryAdapter<any>
  emailPort: InvoiceEmailPort
}): Promise<EmailInvoiceResult> {
  const { invoice, to, hotelRepo, emailPort } = args

  const header = await hotelHeaderOf(hotelRepo, invoice.hotelId)

  const html = renderInvoiceHtml({ invoice, ...header })
  const subject = `${TYPE_LABEL[invoice.type] ?? 'Documento'} ${invoice.invoiceNumber} — ${header.hotelName}`
  const messageId = await emailPort.enqueue({ to, subject, html, hotelId: invoice.hotelId })

  return { sent: true, to, subject, messageId, configured: true }
}
