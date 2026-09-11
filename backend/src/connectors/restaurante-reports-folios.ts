// connectors/restaurante-reports-folios.ts — POS → folios (#213, cierre del día). SOLO cablea: el
// importe de un cargo a habitación es lo que el folio asentó (`folio_charges` por `'pos:' + orderId`:
// neto + el impuesto que aplicó el folio), no los totales de la comanda. Una consulta por comanda
// cargada del rango, sobre el índice parcial `folio_charges_pos_ref`.
import type { ConnectorContext } from 'arckode-framework'
import type { ReportPorts, ReportFolioCharge } from '../modules/restaurant'

interface FoliosModule {
  chargeByReference: (hotelId: string, reference: string) => Promise<ReportFolioCharge | null>
}
interface RestaurantModule { setReportPorts: (p: Partial<ReportPorts>) => void }

export function restauranteReportsFoliosConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<RestaurantModule>('restaurant')
  const folios = () => ctx.resolveModule<FoliosModule>('folios')
  restaurant.setReportPorts({
    folioCharge: (hotelId: string, reference: string) => folios().chargeByReference(hotelId, reference),
  })
}
