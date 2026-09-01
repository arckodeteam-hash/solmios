// connectors/habitaciones-canales.ts — Conector entre módulos
// Cuando se actualiza una habitación, delega el push de tarifas al módulo canales (Channex).
// Los conectores solo wirean (CLAUDE #3); la decisión de qué empujar vive en canales.
// Bug fix: antes llamaba pushRate (rango fijo 30d con precio plano), que PISABA los precios
// por temporada ya publicados — dos fuentes de verdad. Ahora va por pushSeasonalRates:
// computa por temporada (+overrides de canal) y publica todo en 1 llamada.

import type { ConnectorContext } from 'arckode-framework'

export function habitacionesCanalesConnector(ctx: ConnectorContext): void {
  const habitaciones = ctx.resolveModule<{ setSockets: (s: any) => void }>('habitaciones')
  const canales = ctx.resolveModule<{ pushSeasonalRates: (hotelId: string, channel?: string) => Promise<unknown> }>('canales')

  habitaciones.setSockets({
    onHabitacionesUpdated: async (habitacion: any) => {
      try {
        // No await: no bloquea el guardado de la habitación. El catch loguea — nada silencioso.
        void canales.pushSeasonalRates(habitacion.hotelId).catch((err: unknown) => {
          console.error(`[habitaciones-canales] push de tarifas falló (hotel=${habitacion.hotelId}):`, err instanceof Error ? err.message : err)
        })
      } catch {
        // canales puede no estar disponible (módulo desactivado). No rompe el guardado.
      }
    },
  })
}
