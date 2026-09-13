// facturas/usecases/credit-note.ts — Generación de notas de crédito.
// Cuando se cancela una factura, se genera una nota de crédito por el monto total.

import type { RepositoryAdapter } from 'arckode-framework'
import type { FacturasDTO } from '../types'

export interface CreditNoteResult {
  creditNote: FacturasDTO
  originalInvoice: FacturasDTO
}

/**
 * Genera una nota de crédito para cancelar una factura.
 * La nota de crédito tiene tipo 'credit_note' y monto negativo (crédito al huésped).
 */
export async function generateCreditNote(
  repo: RepositoryAdapter<FacturasDTO>,
  invoice: FacturasDTO,
  reason: string,
  userId: string,
): Promise<CreditNoteResult> {
  const now = new Date().toISOString()

  const creditNote = await repo.create({
    hotelId: invoice.hotelId,
    reservationId: invoice.reservationId ?? null,
    guestId: invoice.guestId ?? null,
    invoiceNumber: `CN-${invoice.invoiceNumber}`,
    type: 'credit_note',
    amount: Number(invoice.amount) || 0,
    taxes: Number(invoice.taxes) || 0,
    currency: invoice.currency,
    status: 'paid',
    issueDate: now.split('T')[0],
    ncf: invoice.ncf ? `NCF-CN-${invoice.invoiceNumber}` : null,
    notes: `Nota de crédito por cancelación de ${invoice.invoiceNumber}. Razón: ${reason}`,
    amountPaid: 0,
    issuedBy: userId ?? null, // CA 24 de #298: quién emitió la nota de crédito
    createdAt: now,
    updatedAt: now,
  } as any)

  const originalInvoice = await repo.update(invoice.id, {
    status: 'cancelled',
    notes: `${invoice.notes ?? ''}\nCancelado por ${userId}. Nota de crédito: ${creditNote.invoiceNumber}`.trim(),
    updatedAt: now,
  } as any) ?? invoice

  return { creditNote, originalInvoice }
}
