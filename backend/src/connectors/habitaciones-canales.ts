// connectors/habitaciones-canales.ts — Conector entre módulos
// Las habitaciones son la fuente de los room types y del precio base que se publican al channel
// manager. Qué se publica ante cada evento vive en `canales/usecases/room-events.ts`
// (CLAUDE #3: el conector solo wirea).

import type { ConnectorContext } from 'arckode-framework'
import { onRoomCreated, onRoomUpdated, type RoomEventDeps } from '../modules/canales/usecases/room-events'

export function habitacionesCanalesConnector(ctx: ConnectorContext): void {
  const habitaciones = ctx.resolveModule<{ setSockets: (s: any) => void }>('habitaciones')
  const canales = ctx.resolveModule<{
    pushSeasonalRates: (hotelId: string, channel?: string) => Promise<unknown>
    autoProvision: (hotelId: string) => Promise<unknown>
  }>('canales')

  const deps: RoomEventDeps = {
    autoProvision: (hotelId) => canales.autoProvision(hotelId),
    pushSeasonalRates: (hotelId) => canales.pushSeasonalRates(hotelId),
    onError: (hotelId, accion, err) =>
      console.error(`[habitaciones-canales] ${accion} falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err),
  }

  habitaciones.setSockets({
    onHabitacionesCreated: async (habitacion: any) => onRoomCreated(deps, habitacion.hotelId),
    onHabitacionesUpdated: async (habitacion: any) => onRoomUpdated(deps, habitacion.hotelId),
  })
}
