// facturas/usecases/reservation-money.ts — Lectura del camino reserva ↔ factura para otros módulos.
// Gemelo de `folios/usecases/reservation-money.ts`; el porqué completo está en ese encabezado.
// `invoices` es tabla de este módulo: `reservas` la pide por el puerto de `connectors/reservas-money`.

import type { RepositoryAdapter } from 'arckode-framework'
import type { FacturasDTO } from '../types'

/** Facturas de una reserva. `hotelId` obligatorio (multi-tenancy). */
export async function invoicesOfReservation(
  repo: Pick<RepositoryAdapter<FacturasDTO>, 'findMany'>, hotelId: string, reservationId: string,
): Promise<FacturasDTO[]> {
  if (!hotelId) throw new Error('facturas: invoicesOfReservation sin hotelId (multi-tenancy)')
  if (!reservationId) return []
  return await repo.findMany({ hotelId, reservationId } as any)
}

/** Reserva dueña de una factura — camino inverso (COR-1). `null` si no es de este hotel. */
export async function reservationIdOfInvoice(
  repo: Pick<RepositoryAdapter<FacturasDTO>, 'findMany'>, hotelId: string, invoiceId: string,
): Promise<string | null> {
  if (!hotelId || !invoiceId) return null
  const [invoice] = await repo.findMany({ id: invoiceId, hotelId } as any)
  const rid = (invoice as any)?.reservationId
  return rid ? String(rid) : null
}
