// reservas/usecases/issue-invoice.ts — Emitir la factura DESDE la reserva (#253, REQ-FDR-02).
//
// Hasta acá la única forma de facturar una estadía era pasar por el folio: abrirlo en el check-in,
// cerrarlo y recién ahí `folios.closeAndCreateInvoice`. Una reserva que nunca abrió cuenta (pago
// anticipado, cancelación con cargo, no-show cobrado) no tenía cómo terminar en una factura sin que
// alguien la armara a mano en facturas — y ahí se perdía el vínculo con la reserva y con los
// `payments` que ya estaban cobrados.
//
// Este usecase decide UN solo camino según el estado real de la cuenta:
//   - folio ABIERTO → el camino que ya existe (`folios.closeAndCreateInvoice`): una sola operación
//     del servidor que cierra el folio con `invoiceId` y arma la factura con los cargos del folio.
//     No se duplica esa lógica acá; se delega por puerto.
//   - sin folio (o folio ya cerrado) → `facturas.invoiceFromReservation`: factura directa por el
//     total de la reserva, vinculando los pagos existentes (409 idempotente si ya tiene factura).
//
// `reservas` NO importa `facturas` ni `folios` (CLAUDE #3): declara `ReservationInvoicingPort` y el
// connector `connectors/reservas-facturas.ts` lo inyecta por `setOrchestrationDeps`. Fail-closed sin
// puerto — mismo criterio que `requireManualPaymentPort` (mark-paid.ts): "emitir" sin nadie que
// emita sería confirmar una factura en el aire.

import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { Auth, Logger, RepositoryAdapter } from 'arckode-framework'
import type { FolioReaderPort } from '../../../shared/usecases/open-folio-balance'

/** Actor del JWT. Compatible con el `CurrentUser` de folios y facturas (`hotelId` opcional). */
export interface CurrentUser { id: string; role: string; hotelId?: string }

export interface ReservationInvoicingPort {
  /** Sin folio: `facturas.invoiceFromReservation` (connectors/reservas-facturas). */
  issueFromReservation(
    hotelId: string,
    input: { reservationId: string; notes?: string },
    user: CurrentUser,
  ): Promise<{ invoice: { id: string; invoiceNumber?: string; amount?: number; status?: string }; invoiceNumber: string; linkedPayments: number; amountPaid: number }>
  /** Con folio abierto: `folios.closeAndCreateInvoice` (camino folios-facturas ya existente). */
  closeFolioAndInvoice(
    folioId: string,
    user: CurrentUser,
  ): Promise<{ folio: { id: string; status?: string; invoiceId?: string | null }; invoice: { id: string; invoiceNumber?: string; amount?: number } }>
}

export interface IssueInvoiceDeps {
  repo: RepositoryAdapter<any>
  auth: Auth
  invoicing?: ReservationInvoicingPort
  folioReader?: FolioReaderPort
  logger: Logger
}

export interface IssueInvoiceResult {
  invoiceId: string
  invoiceNumber?: string
  /** Por dónde salió: `folio` (cerró el folio abierto) o `reservation` (factura directa). */
  source: 'folio' | 'reservation'
  folioId?: string
  linkedPayments?: number
  amountPaid?: number
}

/** Sin puerto no hay quién emita: se rompe fuerte en vez de devolver "ok" sin factura. */
function requireInvoicingPort(port: ReservationInvoicingPort | undefined): ReservationInvoicingPort {
  if (!port) throw new ValidationError('Facturación desde la reserva no disponible: el conector reservas-facturas no está registrado')
  return port
}

/**
 * Folio ABIERTO de la reserva, o `null`. Mismo criterio que `shared/usecases/open-folio-balance.ts`
 * (`list({ status: 'open' })` + match por `reservationId`). Si el lector no está cableado se cae a
 * `reservation.folioId` sólo para descartar un folio ya cerrado; sin lector y sin `folioId` no hay
 * cuenta que cerrar → camino directo. A diferencia de la guarda de deuda, acá un error de lectura
 * SÍ se propaga: facturar "directo" con un folio abierto que no pudimos ver dejaría cargos afuera.
 */
async function findOpenFolio(
  folios: FolioReaderPort | undefined, reservation: { id: string; folioId?: string | null }, user: CurrentUser,
): Promise<{ id: string } | null> {
  if (!folios) return null
  const res = await folios.list({ status: 'open' }, user)
  const rows: any[] = Array.isArray(res) ? res : (res?.data ?? [])
  const match = rows.find((f) => f?.reservationId === reservation.id)
  if (match?.id) return { id: String(match.id) }
  if (!reservation.folioId) return null
  const detail = await folios.getById(String(reservation.folioId), user)
  return detail?.status === 'open' && detail?.id ? { id: String(detail.id) } : null
}

/**
 * Emite la factura de la reserva `id`.
 * 404 si no existe; 403 si es de otro hotel (ownership); 409 si está cancelada o (desde el puerto)
 * si ya tiene factura — ese 409 llega con `invoiceId` y se propaga tal cual al borde HTTP.
 */
export async function issueInvoiceForReservation(
  deps: IssueInvoiceDeps,
  id: string,
  input: { notes?: string },
  user: CurrentUser,
): Promise<IssueInvoiceResult> {
  const port = requireInvoicingPort(deps.invoicing)
  const reservation = await deps.repo.findById(id)
  if (!reservation) throw new NotFoundError('Reserva no encontrada')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings (mem
  // ownership-bug). Post-findById obligatorio (regla CLAUDE.md + analyzer).
  deps.auth.assertOwnership(String(reservation.hotelId), user.hotelId ?? '', user.role, 'super_admin')

  if (reservation.status === 'cancelled') {
    throw new ConflictError('No se puede emitir factura sobre una reserva cancelada')
  }

  const openFolio = await findOpenFolio(deps.folioReader, reservation, user)
  if (openFolio) {
    // `notes` se ignora en este camino: el folio arma sus propias notas al cerrar (cargos, saldo).
    deps.logger.info('Factura desde reserva: folio abierto, se cierra y factura', { reservationId: id, folioId: openFolio.id, userId: user.id })
    const r = await port.closeFolioAndInvoice(openFolio.id, user)
    return { invoiceId: r.invoice.id, invoiceNumber: r.invoice.invoiceNumber, source: 'folio', folioId: openFolio.id }
  }

  deps.logger.info('Factura desde reserva: sin folio abierto, factura directa', { reservationId: id, userId: user.id })
  const notes = String(input.notes ?? '').trim() || undefined
  const r = await port.issueFromReservation(String(reservation.hotelId), { reservationId: id, notes }, user)
  return { invoiceId: r.invoice.id, invoiceNumber: r.invoiceNumber, source: 'reservation', linkedPayments: r.linkedPayments, amountPaid: r.amountPaid }
}
