// connectors/pricing-canales.ts — Push automático de tarifas a las OTAs.
// pricing emite onRatesUpdated cuando cambian tarifas; canales las empuja a Channex.
// Antes el push era MANUAL (endpoint POST /api/channels/push-rates): editar tarifas no las
// reflejaba en las OTAs hasta que alguien apretaba el botón → riesgo de vender a precio viejo.
// Fire-and-forget: el push a Channex es una llamada de red; NO debe bloquear el guardado del
// grid ni romperlo. Los errores se loguean en servidor (journalctl): un push fallido no debe
// ser invisible — antes el .catch vacío lo hacía silencioso y nadie se enteraba.

import type { ConnectorContext } from 'arckode-framework'

export function pricingCanalesConnector(ctx: ConnectorContext): void {
  const pricing = ctx.resolveModule<{ setSockets: (s: any) => void }>('pricing')
  pricing.setSockets({
    onRatesUpdated: async (hotelId: string, _count: number, channels?: string[]) => {
      try {
        const canales = ctx.resolveModule<{ pushSeasonalRates: (hotelId: string, channel?: string) => Promise<unknown> }>('canales')
        // Si el guardado trae override de canal(es), se empuja cada canal tocado (el push con canal
        // prefiere el override sobre la base); si no, la base — como siempre. Sin esto, editar desde
        // el editor de un canal persistía el override pero nunca lo publicaba: el push sin canal
        // descarta las filas con canal (push-rates.ts) y "cambiar el precio no hacía nada".
        const targets: Array<string | undefined> = channels?.length ? channels : [undefined]
        for (const channel of targets) {
          // No await: se dispara y sigue.
          void canales.pushSeasonalRates(hotelId, channel).catch((err: unknown) => {
            const scope = channel ? `canal=${channel}` : 'base'
            console.error(`[pricing-canales] push de tarifas falló (hotel=${hotelId} ${scope}):`, err instanceof Error ? err.message : err)
          })
        }
      } catch {
        // canales puede no estar disponible (módulo desactivado). No rompe el guardado de tarifas.
      }
    },
  })
}
