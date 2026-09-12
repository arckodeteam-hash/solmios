// facturas/model.ts — Schema de base de datos
import type { ModelDefinition, ORM } from 'arckode-framework'

export const FacturasModel: ModelDefinition = {
  table: 'invoices',
  fields: {
    id: { type: 'string', required: true },
    reservationId: { type: 'string' },
    folioId: { type: 'string' },
    hotelId: { type: 'string', required: true, indexed: true },
    guestId: { type: 'string' },
    invoiceNumber: { type: 'string', required: true },
    type: { type: 'string', default: "invoice" },
    amount: { type: 'number', required: true },
    taxes: { type: 'number', default: 0 },
    currency: { type: 'string', default: "USD" },
    status: { type: 'string', default: "pending" },
    issueDate: { type: 'string', required: true },
    dueDate: { type: 'string' },
    notes: { type: 'text' },
    ncf: { type: 'string' },
    paymentMethod: { type: 'string' },
    amountPaid: { type: 'number', default: 0 },
    fileUrl: { type: 'string' },
    fiscalSent: { type: 'boolean', default: false },
    fiscalMessage: { type: 'string' },
    issuedBy: { type: 'string' }, // usuario que emitió la factura (nullable; CA 24 de #298)
  },
  timestamps: true,
}

export function registerFacturasModels(orm: ORM): void {
  orm.define('Invoices', FacturasModel)
  orm.define('InvoiceItem', InvoiceItemModel)
}

// Líneas de factura (desglose). Antes los items vivían embebidos en `invoices.notes` como
// string y el template solo podía renderizar 1 línea con el total. Ahora son filas propias.
export const InvoiceItemModel: ModelDefinition = {
  table: 'invoice_items',
  fields: {
    id: { type: 'string', required: true },
    invoiceId: { type: 'string', required: true, indexed: true },
    hotelId: { type: 'string', required: true, indexed: true },
    description: { type: 'string', required: true },
    quantity: { type: 'number', default: 1 },
    unitPrice: { type: 'number', default: 0 },
    amount: { type: 'number', required: true },
    sortOrder: { type: 'number', default: 0 },
  },
  timestamps: true,
}
