// connectors/restaurante-reports-payments.ts — POS → payments (#213, cierre del día). SOLO cablea:
// `payments` es la ÚNICA fuente de verdad del dinero (CLAUDE.md), así que las ventas por método, las
// propinas y las devoluciones del cierre salen de los pagos del hotel de cada día contable
// (`paymentsOfBusinessDate`, una consulta por día). El usecase filtra `metadata.source === 'restaurant'`
// y resta los `type:'refund'` — también los hechos desde /api/payments/:id/refund sin tocar la comanda.
// Sin `user`: no es un request sobre un payment ajeno, es la lectura del hotel del token (hotelId obligatorio).
import type { ConnectorContext } from 'arckode-framework'
import type { ReportPorts, ReportPayment } from '../modules/restaurant'

interface PaymentsModule {
  paymentsOfBusinessDate: (hotelId: string, businessDate: string) => Promise<ReportPayment[]>
  paymentOfHotel: (hotelId: string, paymentId: string) => Promise<ReportPayment | null>
}
interface RestaurantModule { setReportPorts: (p: Partial<ReportPorts>) => void }

export function restauranteReportsPaymentsConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<RestaurantModule>('restaurant')
  const payments = () => ctx.resolveModule<PaymentsModule>('payments')
  restaurant.setReportPorts({
    paymentsOfDay: (hotelId: string, businessDate: string) => payments().paymentsOfBusinessDate(hotelId, businessDate),
    // #216: el ticket impreso lee el pago de la comanda (método/monto) del mismo lugar, acotado al hotel.
    paymentById: (hotelId: string, paymentId: string) => payments().paymentOfHotel(hotelId, paymentId),
  })
}
