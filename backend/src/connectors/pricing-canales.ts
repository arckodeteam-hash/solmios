// connectors/pricing-canales.ts — Push automático de tarifas a las OTAs.
// pricing emite onRatesUpdated/onRateRestrictionsUpdated; canales las empuja a Channex.
// Fire-and-forget: nunca bloquea el guardado; la lógica de coalescing vive en
// canales/usecases/push-coalescing.ts (CLAUDE #3: el conector solo wirea).

import type { ConnectorContext } from 'arckode-framework'
import { PushCoalescer, dispatchOverridePush, type OverrideDispatchDeps } from '../modules/canales/usecases/push-coalescing'

export function pricingCanalesConnector(ctx: ConnectorContext, debounceMs?: number): void {
  const pricing = ctx.resolveModule<{ setSockets: (s: any) => void }>('pricing')
  const coalescer = new PushCoalescer(
    (hotelId, channel) => {
      const canales = ctx.resolveModule<{ pushSeasonalRates: (hotelId: string, channel?: string) => Promise<unknown> }>('canales')
      return canales.pushSeasonalRates(hotelId, channel)
    },
    debounceMs,
    (hotelId, channel, err) => {
      const scope = channel ? `canal=${channel}` : 'base'
      console.error(`[pricing-canales] push de tarifas falló (hotel=${hotelId} ${scope}):`, err instanceof Error ? err.message : err)
    },
    // Un cambio de temporada o del planning no dice a qué canal afecta: sin esto se publicaba solo
    // la base y se borraban los precios por canal.
    (hotelId) => ctx.resolveModule<{ overrideChannels: (h: string) => Promise<string[]> }>('canales').overrideChannels(hotelId),
  )

  const overrideDeps: OverrideDispatchDeps = {
    pushOverrides: (hotelId, items) =>
      ctx.resolveModule<{ pushRateOverrides: (h: string, i: any[]) => Promise<unknown> }>('canales')
        .pushRateOverrides(hotelId, items as any[]),
    scheduleConsolidated: (hotelId) => coalescer.schedule(hotelId),
    onError: (hotelId, err) =>
      console.error(`[pricing-canales] push de tarifas por fecha falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err),
  }

  pricing.setSockets({
    onRatesUpdated: async (hotelId: string, _count: number, channels?: string[]) => coalescer.schedule(hotelId, channels?.length ? channels : [undefined]),
    onRateRestrictionsUpdated: async (hotelId: string) => coalescer.schedule(hotelId),
    // Cambiar fechas del catálogo de temporadas, copiar tarifas al año próximo o pintar días
    // en el planning cambian el precio publicado → mismo push consolidado.
    onSeasonsUpdated: async (hotelId: string) => coalescer.schedule(hotelId),
    onRatesCopied: async (hotelId: string) => coalescer.schedule(hotelId),
    onSeasonAssignmentsUpdated: async (hotelId: string) => coalescer.schedule(hotelId),
    // Grilla de tarifas por fecha → push delta / consolidado. La regla vive en el usecase.
    onRateOverridesUpdated: async (hotelId: string, saved: Array<Record<string, unknown>>, removed: number) =>
      dispatchOverridePush(overrideDeps, hotelId, saved, removed),
    // Bloqueos: cambian DISPONIBILIDAD (no precio) → push de availability por habitación.
    onBlocksChanged: async (hotelId: string, roomIds: string[]) => {
      try {
        const canales = ctx.resolveModule<{ pushAvailabilityByRoom: (hotelId: string, roomId: string) => Promise<unknown> }>('canales')
        for (const roomId of roomIds) {
          void canales.pushAvailabilityByRoom(hotelId, roomId).catch((err: unknown) => {
            console.error(`[pricing-canales] push de availability falló (hotel=${hotelId} room=${roomId}):`, err instanceof Error ? err.message : err)
          })
        }
      } catch {
        // canales puede no estar disponible (módulo desactivado).
      }
    },
  })
}
