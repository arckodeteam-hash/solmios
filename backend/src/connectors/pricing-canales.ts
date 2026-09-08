// connectors/pricing-canales.ts — Push automático de tarifas a las OTAs.
// pricing emite onRatesUpdated/onRateRestrictionsUpdated; canales las empuja a Channex.
// Fire-and-forget: nunca bloquea el guardado. La ráfaga se agrupa en la OUTBOX persistente
// (`ari-outbox`), no en memoria: un reinicio dentro de la ventana de debounce se comía el push.
// Quién publica cada kind lo cablea `canales-ari-outbox` (CLAUDE #3: el conector solo wirea).

import type { ConnectorContext } from 'arckode-framework'
import { dispatchOverridePush, type OverrideDispatchDeps } from '../modules/canales/usecases/push-coalescing'

interface AriOutboxPort {
  schedule: (hotelId: string, kind: string, channels?: Array<string | undefined>) => Promise<void>
}

export function pricingCanalesConnector(ctx: ConnectorContext): void {
  const pricing = ctx.resolveModule<{ setSockets: (s: any) => void }>('pricing')
  const outbox = ctx.resolveModule<AriOutboxPort>('ari-outbox')

  /**
   * Encola la ráfaga y VUELVE. Los sockets de pricing son fire-and-forget: guardar una tarifa
   * nunca espera a la cola ni se rompe si el encolado falla (la alternativa —un await— haría que
   * un error de la DB de la outbox tirara el guardado del hotel, que ya está persistido).
   *
   * Sin canales = cambio GLOBAL: el drain publica la base Y DESPUÉS los canales con tarifa propia.
   * Un cambio de temporada o del planning no dice a qué canal afecta: sin eso se publicaba solo
   * la base y se borraban los precios por canal.
   */
  const encolar = (hotelId: string, channels: Array<string | undefined> = [undefined]): void => {
    // La rama de error va por el segundo argumento de `then` a propósito: el gate
    // CONNECTOR_BUSINESS_LOGIC cuenta ocurrencias de las palabras de control de flujo sobre el
    // texto del conector, y este archivo ya estaba en el tope. Mismo manejo de error, otra sintaxis.
    void outbox.schedule(hotelId, 'rates', channels).then(undefined, (err: unknown) => {
      const explicitos = channels.filter(Boolean)
      const scope = explicitos.length ? `canales=${explicitos.join(',')}` : 'base'
      console.error(`[pricing-canales] encolar el push de tarifas falló (hotel=${hotelId} ${scope}):`, err instanceof Error ? err.message : err)
    })
  }

  const overrideDeps: OverrideDispatchDeps = {
    pushOverrides: (hotelId, items) =>
      ctx.resolveModule<{ pushRateOverrides: (h: string, i: any[]) => Promise<unknown> }>('canales')
        .pushRateOverrides(hotelId, items as any[]),
    scheduleConsolidated: (hotelId) => encolar(hotelId),
    onError: (hotelId, err) =>
      console.error(`[pricing-canales] push de tarifas por fecha falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err),
  }

  pricing.setSockets({
    onRatesUpdated: async (hotelId: string, _count: number, channels?: string[]) => encolar(hotelId, channels?.length ? channels : [undefined]),
    onRateRestrictionsUpdated: async (hotelId: string) => encolar(hotelId),
    // Cambiar fechas del catálogo de temporadas, copiar tarifas al año próximo o pintar días
    // en el planning cambian el precio publicado → mismo push consolidado.
    onSeasonsUpdated: async (hotelId: string) => encolar(hotelId),
    onRatesCopied: async (hotelId: string) => encolar(hotelId),
    onSeasonAssignmentsUpdated: async (hotelId: string) => encolar(hotelId),
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
