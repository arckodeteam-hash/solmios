// connectors/ai-facturas.ts — Conector entre módulos
//
// Le da al recepcionista IA la capacidad de emitir una factura SIN importar el módulo `facturas`
// y sin escribir contra el repositorio `Invoices` a mano.
//
// Antes, la tool `generate_invoice` (`ai-recepcionista/usecases/llm-pipeline.ts`) hacía
// `invoiceRepo.create(...)` directo, salteándose `facturas/usecases/create-invoice.ts`. Lo que
// grababa era inválido en cinco puntos: `type:'stay'` y `status:'issued'` (ninguno existe en los
// enums de `facturas/validators/schema.ts`), impuesto clavado en 0,16 ignorando
// `configuration(key='taxes')`, `invoiceNumber` por `Date.now()` sin consumir el correlativo, y
// `amount` sin impuestos contra la convención del resto (`facturas/types.ts:4`). Encima no emitía
// `onFacturasCreated`, así que la factura no devengaba en contabilidad ni invalidaba la caché.
//
// Pasando por `facturas.create` hereda todo eso gratis. Ver openspec/changes/finanzas-consolidacion
// (tarea 1.1).

import type { ConnectorContext } from 'arckode-framework'

interface CreatedInvoice {
  id: string
  invoiceNumber?: string
  amount?: number
  taxes?: number
  currency?: string
}

interface FacturasModule {
  create: (dto: Record<string, unknown>, user: unknown) => Promise<CreatedInvoice>
}

interface AiModule {
  invoicingPort: unknown
}

export interface AiInvoiceInput {
  hotelId: string
  reservationId?: string | null
  guestId?: string | null
  /** BASE imponible (sin impuestos): `createInvoice` aplica la tasa del hotel encima. */
  amount: number
  currency?: string
  notes?: string
}

export function aiFacturasConnector(ctx: ConnectorContext): void {
  const ai = ctx.resolveModule<AiModule>('ai-recepcionista')
  const facturas = ctx.resolveModule<FacturasModule>('facturas')

  ai.invoicingPort = async (input: AiInvoiceInput): Promise<CreatedInvoice> =>
    facturas.create(
      {
        hotelId: input.hotelId,
        reservationId: input.reservationId || undefined,
        guestId: input.guestId || undefined,
        type: 'invoice',
        amount: input.amount,
        currency: input.currency ?? 'USD',
        notes: input.notes,
      },
      // Actor de sistema: la IA no tiene JWT. `resolveInvoiceHotelId` acepta `super_admin` con
      // hotelId explícito; el hotel sale de la conversación, que ya está acotada a un solo hotel
      // (el webhook de WhatsApp lo lleva en la ruta y su firma lo autentica).
      { id: 'ai-recepcionista', role: 'super_admin', hotelId: input.hotelId },
    )
}
