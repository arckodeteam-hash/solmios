// facturas/usecases/create-invoice.ts — Alta de factura / cargo / comprobante de pago.
// Extraído del service para mantenerlo < 200 líneas.
//
// `dto.amount` es la BASE (subtotal). Solo el tipo `invoice` aplica impuestos y consume el
// numerador fiscal; los demás tipos (payment/folio) llevan número correlativo por timestamp.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { FacturasDTO, CreateFacturasDTO } from '../types'
import { isUniqueViolation } from '../../../shared/utils/db-errors'
import { taxRateFor, applyTax, buildInvoiceRecord } from './billing'
import { nextInvoiceNumber } from './invoice-number'
import { issueNcf } from './fiscal'
import { persistItems, assertItemsSum } from './invoice-items'

const PREFIX_BY_TYPE: Record<string, string> = { payment: 'PAY', folio: 'CHG' }

/**
 * Intentos de numeración ante colisión del UNIQUE (hotelId, invoiceNumber). Cada reintento pide
 * una secuencia estrictamente mayor a la que chocó, así que N recepcionistas facturando a la vez
 * convergen en N intentos. Un tope bajo es suficiente y evita un bucle infinito si el índice
 * rechaza por un motivo que no es la carrera.
 */
const NUMBER_RETRIES = 5

export interface CreateInvoiceDeps {
  repo: RepositoryAdapter<FacturasDTO>
  configRepo: RepositoryAdapter<any>
  itemRepo: RepositoryAdapter<any>
  logger: Logger
  /** Fallback de taxRateFor a hotels.taxRate — ver el comentario en billing.ts. */
  hotelsRepo?: RepositoryAdapter<any>
}

export interface CreateInvoiceResult {
  item: FacturasDTO
  invoiceNumber: string
  amount: number
  currency: string
}

export async function createInvoice(
  deps: CreateInvoiceDeps,
  dto: CreateFacturasDTO,
  hotelId: string,
): Promise<CreateInvoiceResult> {
  const { repo, configRepo, itemRepo, logger, hotelsRepo } = deps
  logger.info('Creando factura/cargo/pago', { type: dto.type, hotelId })

  const type = dto.type ?? 'invoice'
  const base = Number(dto.amount) || 0
  let taxes = 0
  let amount = base

  if (type === 'invoice') {
    const rate = await taxRateFor(configRepo, hotelId, hotelsRepo)
    const t = applyTax(base, rate)
    taxes = t.tax
    amount = t.total
  }

  if (dto.items?.length) assertItemsSum(dto.items, base)

  const buildRecord = (invoiceNumber: string) => {
    const record = buildInvoiceRecord({
      hotelId, type, taxes, amount, invoiceNumber,
      ncf: dto.ncf ?? null, fiscalSent: false, fiscalMessage: null, dto,
    })
    // Una factura que nace con pagos heredados del folio ya puede estar saldada.
    const amountPaid = Number(dto.amountPaid) || 0
    if (amountPaid > 0) {
      ;(record as any).amountPaid = amountPaid
      ;(record as any).status = amountPaid >= amount ? 'paid' : 'pending'
    }
    return record
  }

  // El número correlativo se reserva y se persiste en el mismo paso: el UNIQUE
  // (hotelId, invoiceNumber) es el árbitro de la carrera y el perdedor reintenta con el siguiente.
  // Un `invoiceNumber` provisto por el llamador se respeta tal cual y NO consume el contador.
  let item: FacturasDTO
  let invoiceNumber: string
  if (type === 'invoice' && !dto.invoiceNumber) {
    ;({ item, invoiceNumber } = await createWithReservedNumber(repo, configRepo, hotelId, buildRecord))
  } else {
    invoiceNumber = dto.invoiceNumber ?? `${PREFIX_BY_TYPE[type] ?? 'DOC'}-${Date.now()}`
    item = await repo.create(buildRecord(invoiceNumber) as any)
  }

  const record = buildRecord(invoiceNumber)

  // DT-03: NCF solo si el hotel tiene facturación electrónica activa (config). Si no, queda null.
  // Se emite DESPUÉS de que la fila persistió: issueNcf consume secuencia fiscal, y gastarla en un
  // intento que después pierde la carrera del número dejaría un hueco en el correlativo de la DGII.
  if (type === 'invoice' && !dto.ncf) {
    const fiscal = await issueNcf(configRepo, hotelId, {
      hotelId, invoiceNumber, amount, taxes, currency: dto.currency ?? 'USD', guestId: dto.guestId,
    })
    if (fiscal.ncf || fiscal.fiscalSent || fiscal.fiscalMessage) {
      const patched = await repo.update(item.id, {
        ncf: fiscal.ncf ?? null,
        fiscalSent: fiscal.fiscalSent,
        fiscalMessage: fiscal.fiscalMessage,
      } as any)
      if (patched) item = patched
    }
  }

  if (dto.items?.length) await persistItems(itemRepo, item.id, hotelId, dto.items)

  logger.info('Factura creada', { id: item.id, invoiceNumber, type, amount, taxes, hotelId })
  return { item, invoiceNumber, amount, currency: record.currency }
}

/**
 * Reserva el correlativo y crea la fila, reintentando cuando otra alta se quedó con el número.
 *
 * `minSeq` sube en cada vuelta para no volver a pedir el número que acaba de chocar. Si se agotan
 * los intentos se propaga el último error: no hay número de respaldo por timestamp.
 */
async function createWithReservedNumber(
  repo: RepositoryAdapter<FacturasDTO>,
  configRepo: RepositoryAdapter<any>,
  hotelId: string,
  buildRecord: (invoiceNumber: string) => Record<string, unknown>,
): Promise<{ item: FacturasDTO; invoiceNumber: string }> {
  let minSeq = 0
  let lastError: unknown
  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
    const { invoiceNumber, seq } = await nextInvoiceNumber(configRepo, hotelId, 'INV', minSeq)
    try {
      const item = await repo.create(buildRecord(invoiceNumber) as any)
      return { item, invoiceNumber }
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      lastError = e
      minSeq = seq
    }
  }
  throw lastError
}
