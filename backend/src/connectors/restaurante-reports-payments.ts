// connectors/restaurante-reports-payments.ts — POS → payments (#213, cierre del día). SOLO cablea:
// el reporte necesita el método (cash/card/transfer) de cada comanda `paid`, y eso vive únicamente en
// `payments` (fuente única del dinero). `getPayment` valida ownership contra el user del request; un
// payment inexistente o de otro hotel devuelve null y el usecase lo cuenta como `other`.
import type { ConnectorContext } from 'arckode-framework'
import type { ReportPorts } from '../modules/restaurant'
import type { CurrentUser } from '../modules/restaurant/types'

interface PaymentsModule {
  getPayment: (id: string, user?: { id?: string; role?: string }) => Promise<{ method?: string } | null>
}
interface RestaurantModule { setReportPorts: (p: Partial<ReportPorts>) => void }

export function restauranteReportsPaymentsConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<RestaurantModule>('restaurant')
  const payments = () => ctx.resolveModule<PaymentsModule>('payments')
  restaurant.setReportPorts({
    paymentMethod: async (paymentId: string, user: CurrentUser) => {
      const p = await payments().getPayment(paymentId, user).catch(() => null)
      return p?.method ?? null
    },
  })
}
