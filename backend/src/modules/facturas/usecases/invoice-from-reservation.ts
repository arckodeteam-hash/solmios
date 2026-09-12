// facturas/usecases/invoice-from-reservation.ts — Factura emitida desde la reserva, sin folio (#253).
//
// Una reserva pagada online por Stripe no tiene folio: el dinero ya entró (`payments`, con
// `reservationId` y `stripeSessionId`) pero el único camino de facturación era
// `POST /api/folios/:id/invoice`, que exige un folio abierto. Resultado: la reserva más simple del
// hotel —la que se cobró sola por la web— era la única que NO se podía facturar.
//
// Reglas (todas heredadas, ninguna nueva):
//   · Importe: `chargeableTotal(reservation, addons)` (`shared/utils/reservation-balance.ts`), la
//     ÚNICA fórmula del total cobrable. `reservations.totalAmount` es BRUTO (el motor público y el
//     alta del panel guardan subtotal + impuestos), y `createInvoice` recibe la BASE NETA y aplica
//     el impuesto encima: por eso acá se desglosa cada línea a neto con la tasa del hotel.
//   · Impuestos: `taxRateFor` (configuration 'taxes' → fallback `hotels.taxRate`). Nada hardcodeado.
//   · Numeración: `createInvoice` (contador atómico + NCF). Acá no se numera nada.
//   · Dinero: `payments` es la única fuente de verdad. Esta factura VINCULA las filas que ya
//     existen (`payments.invoiceId`) y NUNCA crea una — crearla contaría el mismo cobro dos veces.
//   · Idempotencia: una reserva con factura viva no se factura otra vez (409 con el id de la
//     existente). Anular ≠ borrar: una factura `cancelled` (nota de crédito) sí deja emitir otra.
//   · Pagada ⇔ `amountPaid ≥ amount − BALANCE_EPSILON` (`shared/utils/money.ts`): la base neta se
//     redondea a centavos y al reaplicar el impuesto el total puede diferir del bruto en 0.01.

import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { chargeableTotal } from '../../../shared/utils/reservation-balance'
import { BALANCE_EPSILON, round2 } from '../../../shared/utils/money'
import { sumPayments } from '../../../shared/usecases/reservation-paid'
import type { CreateFacturasDTO, CurrentUser, FacturasDTO, InvoiceItem } from '../types'
import { auditSafely, type AuditPort } from './audit'
import { taxRateFor } from './billing'
import { createInvoice } from './create-invoice'
import { invoicesOfReservation } from './reservation-money'
import type { PaymentPort, ReservationPaymentRow } from './payment-port'

export interface InvoiceFromReservationDeps {
  repo: RepositoryAdapter<FacturasDTO>
  configRepo: RepositoryAdapter<any>
  itemRepo: RepositoryAdapter<any>
  logger: Logger
  /** Fallback de taxRateFor a hotels.taxRate — ver billing.ts. */
  hotelsRepo?: RepositoryAdapter<any>
  reservationRepo: Pick<RepositoryAdapter<any>, 'findById'>
  /** `ReservationAddons` (shared/models.ts): `findMany({ hotelId, reservationId })`. */
  addonsRepo: Pick<RepositoryAdapter<any>, 'findMany'>
  paymentPort: PaymentPort | null
  auditPort: AuditPort | null
}

export interface InvoiceFromReservationInput {
  reservationId: string
  notes?: string
}

export interface InvoiceFromReservationResult {
  invoice: FacturasDTO
  invoiceNumber: string
  /** Filas de `payments` que quedaron con `invoiceId` = esta factura. */
  linkedPayments: number
  amountPaid: number
}

/** 409 con el id de la factura viva: el caller lo devuelve para que el frontend la abra en vez de reintentar. */
export class ReservationAlreadyInvoicedError extends ConflictError {
  constructor(invoiceNumber: string, public readonly invoiceId: string) {
    super(`La reserva ya tiene factura ${invoiceNumber}`, { invoiceId })
  }
}

/** Estados de `payments` que cuentan como dinero recibido — mismo criterio que `reservation-paid.ts`. */
const LINKABLE_STATUSES = new Set(['completed', 'refunded'])

export async function invoiceFromReservation(
  deps: InvoiceFromReservationDeps,
  hotelId: string,
  input: InvoiceFromReservationInput,
  user: CurrentUser,
): Promise<InvoiceFromReservationResult> {
  const { repo, configRepo, itemRepo, logger, hotelsRepo, paymentPort } = deps
  const reservationId = String(input.reservationId ?? '')

  // Multi-tenancy: `hotelId` es el del usuario (ya validado aguas arriba); el id de la reserva
  // viene del path y no se confía en él — una reserva de otro hotel es "no existe".
  const reservation = reservationId ? await deps.reservationRepo.findById(reservationId) : null
  if (!reservation || String(reservation.hotelId) !== hotelId) throw new NotFoundError('Reserva no encontrada')
  if (reservation.status === 'cancelled') throw new ConflictError('La reserva está cancelada: no se puede facturar')

  const existing = (await invoicesOfReservation(repo, hotelId, reservationId))
    .find((inv) => inv.type === 'invoice' && inv.status !== 'cancelled')
  if (existing) throw new ReservationAlreadyInvoicedError(existing.invoiceNumber, existing.id)

  // Fail-closed, como `folios/usecases/close-and-create-invoice.ts`: sin puerto no hay forma de
  // vincular el dinero, y una factura "pagada" sin sus pagos es exactamente lo que se evita.
  if (!paymentPort?.paymentsOfReservation || !paymentPort.linkPaymentsToInvoice) {
    throw new ValidationError(
      'Facturación desde la reserva no disponible: el conector facturas-payments no expone los pagos de la reserva',
    )
  }

  const addons = await deps.addonsRepo.findMany({ hotelId, reservationId } as any)
  const rate = await taxRateFor(configRepo, hotelId, hotelsRepo)
  const gross = chargeableTotal(reservation, addons as any[])
  if (gross <= 0) throw new ValidationError('La reserva no tiene importe facturable')

  const items = buildItems(reservation, addons as any[], rate)
  const net = round2(items.reduce((s, it) => s + it.amount, 0))

  const rows = await paymentPort.paymentsOfReservation(hotelId, reservationId)
  const linkable = rows.filter((r) => !r.invoiceId && LINKABLE_STATUSES.has(String(r.status ?? '')))
  const amountPaid = Math.max(0, sumPayments(linkable))

  const created = await createInvoice({ repo, configRepo, itemRepo, logger, hotelsRepo }, {
    hotelId,
    guestId: reservation.guestId ?? undefined,
    reservationId,
    type: 'invoice',
    amount: net,
    currency: reservation.currency ?? 'USD',
    status: 'pending',
    notes: input.notes ?? undefined,
    items,
    amountPaid,
    paymentMethod: singleMethodOf(linkable),
  } as CreateFacturasDTO, hotelId)

  // `createInvoice` compara `amountPaid >= amount` sin tolerancia; el criterio del dominio es con
  // BALANCE_EPSILON (ver encabezado). Se corrige sólo si el redondeo dejó la factura en `pending`.
  let invoice = created.item
  const paid = amountPaid >= created.amount - BALANCE_EPSILON
  if (paid && invoice.status !== 'paid') {
    const patched = await repo.update(invoice.id, { status: 'paid', amountPaid } as any)
    if (patched) invoice = patched
  }

  // La factura YA existe y consumió numerador: si el vínculo falla no se puede deshacer sin dejar
  // un hueco en el correlativo. Se avisa con el id y se propaga (reconciliación manual), mismo
  // criterio que `close-and-create-invoice.ts`.
  let linkedPayments = 0
  if (linkable.length) {
    try {
      linkedPayments = await paymentPort.linkPaymentsToInvoice(hotelId, reservationId, linkable.map((r) => r.id), invoice.id)
    } catch (e: any) {
      logger.warn('Factura emitida desde la reserva pero SIN vincular sus pagos — reconciliar a mano', {
        invoiceId: invoice.id, reservationId, paymentIds: linkable.map((r) => r.id), error: e?.message,
      })
      throw e
    }
  }

  await auditSafely(deps.auditPort, logger, {
    hotelId, userId: user.id, action: 'invoice.issued_from_reservation', entityId: invoice.id,
    detail: `${created.invoiceNumber} · reserva ${reservationId} · ${created.amount} ${created.currency}` +
      ` · pagado ${amountPaid} · ${linkedPayments} pago(s) vinculado(s) · ${paid ? 'paid' : 'pending'}`,
  })
  logger.info('Factura emitida desde la reserva', {
    invoiceId: invoice.id, invoiceNumber: created.invoiceNumber, reservationId, hotelId,
    gross, net, rate, amount: created.amount, amountPaid, linkedPayments, status: invoice.status,
  })
  return { invoice, invoiceNumber: created.invoiceNumber, linkedPayments, amountPaid }
}

/**
 * Líneas NETAS de la factura: alojamiento, extras (con signo, como `addonsTotal`) y otros cobros.
 * Cada importe bruto se lleva a neto con la tasa del hotel; `createInvoice` vuelve a aplicar el
 * impuesto sobre la suma. Sólo entran líneas con importe distinto de cero.
 */
function buildItems(reservation: any, addons: readonly any[], rate: number): InvoiceItem[] {
  const toNet = (grossAmount: number) => round2(grossAmount / (1 + rate / 100))
  const items: InvoiceItem[] = []
  const push = (description: string, amount: number) => { if (amount !== 0) items.push({ description, amount }) }

  push(`Alojamiento ${stayLabel(reservation)}`, toNet(Number(reservation.totalAmount) || 0))
  for (const a of addons ?? []) {
    const sign = a?.kind === 'discount' ? -1 : 1
    const qty = Number(a?.quantity ?? 1) || 0
    push(String(a?.description ?? 'Extra'), sign * toNet((Number(a?.amount) || 0) * qty))
  }
  push('Otros cobros', toNet(Number(reservation.otherCharges) || 0))
  return items
}

/** "2026-03-01 → 2026-03-04 (3 noches)"; sin fechas válidas, sólo lo que haya. */
function stayLabel(reservation: any): string {
  const checkIn = String(reservation.checkIn ?? '').slice(0, 10)
  const checkOut = String(reservation.checkOut ?? '').slice(0, 10)
  const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)
  const range = `${checkIn} → ${checkOut}`
  if (!Number.isFinite(nights) || nights <= 0) return range
  return `${range} (${nights} ${nights === 1 ? 'noche' : 'noches'})`
}

/** Método de pago de la factura: el de los cobros vinculados si todos coinciden; si no, ninguno. */
function singleMethodOf(rows: readonly ReservationPaymentRow[]): string | undefined {
  const methods = new Set(rows.filter((r) => r.type !== 'refund' && r.method).map((r) => String(r.method)))
  return methods.size === 1 ? [...methods][0] : undefined
}
