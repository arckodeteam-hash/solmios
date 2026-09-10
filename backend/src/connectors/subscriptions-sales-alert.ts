// connectors/subscriptions-sales-alert.ts — REQ-PIPE-04 (#145): ventas se entera del alta.
//
// Hasta acá, cuando un hotel se registraba solo salía el correo de bienvenida AL HOTEL: nadie
// del equipo lo sabía y el trial se enfriaba solo (prod 2026-09-10: 15 de 19 trials vencidos sin
// una llamada). `subscriptions` emite `onHotelSignedUp` con hotel + dueño + plan y `sales-leads`
// encola el aviso con WhatsApp prellenado en la MISMA petición.
// Conecta: subscriptions → sales-leads. Ninguno de los dos se importa entre sí.
// Best-effort: `notifySignup` ya traga sus errores; el `try` de `completeSignup` cubre el resto.
import type { ConnectorContext } from 'arckode-framework'

interface SignedUpHotel { id: string; name: string; email: string; phone: string; country: string }
interface SignedUpOwner { id: string; name: string; email: string }

interface SalesLeadsModule {
  notifySignup: (hotel: SignedUpHotel, owner: SignedUpOwner, planId: string) => Promise<void>
}

export function subscriptionsSalesAlertConnector(ctx: ConnectorContext): void {
  const salesLeads = ctx.resolveModule<SalesLeadsModule>('sales-leads')
  const subscriptions = ctx.resolveModule<{ setSockets: (s: any) => void }>('subscriptions')

  subscriptions.setSockets({
    onHotelSignedUp: async (hotel: SignedUpHotel, owner: SignedUpOwner, planId: string) => {
      await salesLeads.notifySignup(hotel, owner, planId)
    },
  })
}
