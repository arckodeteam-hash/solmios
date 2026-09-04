import type { ConnectorContext } from 'arckode-framework'
import { settleFolioAtCheckout, type SettleFolioParams, type SettleFolioResult } from '../shared/usecases/settle-folio-at-checkout'

export function reservasFoliosSettlementConnector(ctx: ConnectorContext): void {
  const folios = ctx.resolveModule<any>('folios')
  const reservas = ctx.resolveModule<any>('reservas')

  reservas.setOrchestrationDeps({
    // `paidOf` viene de reservas (tiene los repos): al cerrar la cuenta, lo que el hotel ya cobró
    // y el folio todavía no refleja se acredita antes de facturar. Ver settle-folio-at-checkout.
    settleFolio: async (params: SettleFolioParams, user: any): Promise<SettleFolioResult> =>
      settleFolioAtCheckout(folios, params, user, {
        // La reserva se lee entera a propósito: `paidSource` necesita su `hotelId` (multi-tenancy)
        // y su `deposit` — un anticipo cargado a mano vive SOLO en esa columna, y pasar un stub
        // sin ella devolvía "pagado 0" y volvía a cobrarle al huésped.
        paidOf: async (rid: string) => reservas.paidSource()(rid, await reservas.getById(rid, user)),
      }),
  })
}
