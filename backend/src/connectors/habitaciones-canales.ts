// connectors/habitaciones-canales.ts — Conector entre módulos
// Las habitaciones son la fuente de los room types, del inventario (`count_of_rooms`) y del precio
// base que se publican al channel manager. Qué se publica ante cada evento vive en
// `canales/usecases/room-events.ts` (CLAUDE #3: el conector solo wirea).

import type { ConnectorContext } from 'arckode-framework'
import { onRoomCreated, onRoomUpdated, onRoomDeleted, type RoomEventDeps } from '../modules/canales/usecases/room-events'

interface AriOutboxPort {
  schedule: (hotelId: string, kind: string, channels?: Array<string | undefined>) => Promise<void>
}

export function habitacionesCanalesConnector(ctx: ConnectorContext): void {
  const habitaciones = ctx.resolveModule<{ setSockets: (s: any) => void }>('habitaciones')
  const canales = ctx.resolveModule<{
    pushSeasonalRates: (hotelId: string, channel?: string) => Promise<unknown>
    autoProvision: (hotelId: string) => Promise<unknown>
    syncHotel: (hotelId: string) => Promise<unknown>
  }>('canales')
  const outbox = ctx.resolveModule<AriOutboxPort>('ari-outbox')

  const deps: RoomEventDeps = {
    autoProvision: (hotelId) => canales.autoProvision(hotelId),
    pushSeasonalRates: (hotelId) => canales.pushSeasonalRates(hotelId),
    // Cargar el inventario en lote emite un evento POR habitación: sin agrupar, 12 altas serían 12
    // syncs completos contra Channex (y contra su límite de 20 llamadas por minuto). La outbox los
    // junta en uno solo por hotel, igual que el push de tarifas, y sobrevive a un reinicio.
    // Sin canales: el inventario es uno solo por hotel, no se publica por canal.
    syncInventory: async (hotelId) => {
      void outbox.schedule(hotelId, 'inventory').catch((err: unknown) =>
        console.error(`[habitaciones-canales] sync de inventario falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err))
    },
    onError: (hotelId, accion, err) =>
      console.error(`[habitaciones-canales] ${accion} falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err),
  }

  habitaciones.setSockets({
    onHabitacionesCreated: async (habitacion: any) => onRoomCreated(deps, habitacion.hotelId),
    onHabitacionesUpdated: async (habitacion: any) => onRoomUpdated(deps, habitacion.hotelId),
    // La baja llega con el hotel de la habitación borrada: sin él no hay a quién republicarle.
    onHabitacionesDeleted: async (_id: string, ctx?: { hotelId?: string }) => {
      if (ctx?.hotelId) onRoomDeleted(deps, ctx.hotelId)
    },
  })
}
