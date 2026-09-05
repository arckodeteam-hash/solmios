// connectors/habitaciones-pricing.ts — El precio base vive en la habitación; `room_rates` lo espeja.
// Cuando cambia `rooms.basePrice`, pricing re-deriva sus filas o el motor de reservas sigue cotizando
// el precio viejo. Qué se re-deriva y por qué vive en `pricing/usecases/resync-base-prices.ts`
// (CLAUDE #3: el conector solo wirea).

import type { ConnectorContext } from 'arckode-framework'
import { PushCoalescer } from '../modules/canales/usecases/push-coalescing'

export function habitacionesPricingConnector(ctx: ConnectorContext, debounceMs?: number): void {
  const habitaciones = ctx.resolveModule<{ setSockets: (s: any) => void }>('habitaciones')
  const pricing = ctx.resolveModule<{ resyncBasePrices: (hotelId: string) => Promise<number> }>('pricing')

  // Cargar el inventario en lote emite un evento POR habitación: sin agrupar, 12 altas serían 12
  // barridos de `room_rates`. El coalescer los junta en uno por hotel — mismo criterio que
  // `habitaciones-canales` usa para el push a las OTAs.
  const resync = new PushCoalescer(
    (hotelId) => pricing.resyncBasePrices(hotelId),
    debounceMs,
    (hotelId, _channel, err) =>
      console.error(`[habitaciones-pricing] resync de precio base falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err),
  )

  // `setTypeBasePrice` (el camino de la grilla de tarifas) escribe con el repo, NO con el service:
  // no emite estos sockets y por eso no hay ciclo con `pricing.updateRates`, que ya deriva al guardar.
  habitaciones.setSockets({
    onHabitacionesCreated: async (habitacion: any) => { if (habitacion?.hotelId) resync.schedule(habitacion.hotelId) },
    onHabitacionesUpdated: async (habitacion: any) => { if (habitacion?.hotelId) resync.schedule(habitacion.hotelId) },
  })
}
