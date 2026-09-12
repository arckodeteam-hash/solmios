// connectors/reservas-facturas.ts — Conector entre módulos (REQ-FDR-02, #253).
// "Emitir factura" desde la ficha de la reserva (`POST /api/reservas/:id/invoice`). `reservas` no
// importa `facturas` ni `folios`: declara `ReservationInvoicingPort` (usecases/issue-invoice.ts) y
// acá se le inyectan las dos salidas posibles:
//   · con folio ABIERTO → `folios.closeAndCreateInvoice`: el MISMO camino que ya recorre
//     `POST /api/folios/:id/invoice` (cierra el folio con `invoiceId` y arma la factura con sus
//     cargos). No se duplica esa lógica: se delega.
//   · sin folio (o ya cerrado) → `facturas.invoiceFromReservation`: factura directa por el total de
//     la reserva, vinculando los `payments` existentes (409 idempotente si ya tiene factura).
// Quién decide el camino es el usecase de reservas; este conector sólo cablea.
//
// FDR-01 (#252) ampliará este mismo puerto con `listInvoicesOfReservation` para la pestaña de
// facturas de la ficha.

import type { ConnectorContext } from 'arckode-framework'
import type { ReservationInvoicingPort } from '../modules/reservas/usecases/issue-invoice'

type IssueFromReservation = ReservationInvoicingPort['issueFromReservation']
type CloseFolioAndInvoice = ReservationInvoicingPort['closeFolioAndInvoice']

interface FacturasModule {
  invoiceFromReservation: (...args: Parameters<IssueFromReservation>) => ReturnType<IssueFromReservation>
}

interface FoliosModule {
  closeAndCreateInvoice: (...args: Parameters<CloseFolioAndInvoice>) => ReturnType<CloseFolioAndInvoice>
}

export function reservasFacturasConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{ setOrchestrationDeps: (deps: { invoicing: ReservationInvoicingPort }) => void }>('reservas')
  const facturas = ctx.resolveModule<FacturasModule>('facturas')
  const folios = ctx.resolveModule<FoliosModule>('folios')

  const invoicing: ReservationInvoicingPort = {
    issueFromReservation: (hotelId, input, user) => facturas.invoiceFromReservation(hotelId, input, user),
    closeFolioAndInvoice: (folioId, user) => folios.closeAndCreateInvoice(folioId, user),
  }

  reservas.setOrchestrationDeps({ invoicing })
}
