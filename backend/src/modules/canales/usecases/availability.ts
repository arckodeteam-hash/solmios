// canales/usecases/availability.ts — Cálculo de availability por room type
// Lógica PURA (sin DB, sin HTTP): filtra rooms/reservas/bloqueos de un room type y
// produce los rangos comprimidos listos para POST /availability de Channex.
// El service lee la DB y le pasa los arrays crudos; este usecase solo computa.
//
// El cómputo día-a-día se movió a `shared/utils/daily-availability.ts` porque el calendario
// público del motor de reservas (`bookingengine`) necesita exactamente la misma cuenta y los
// módulos no se importan entre sí. Acá se re-exporta para no tocar callers ni tests: el
// comportamiento de canales es idéntico (default `isBlockingStatus` = status !== 'cancelled').

export {
  MS_PER_DAY,
  AVAILABILITY_HORIZON_DAYS,
  computeAvailabilityRanges,
  buildAvailabilityRanges,
} from '../../../shared/utils/daily-availability'
export type { AvailabilityRange } from '../../../shared/utils/daily-availability'

import { buildAvailabilityRanges } from '../../../shared/utils/daily-availability'
import type { AvailabilityRange } from '../../../shared/utils/daily-availability'

/** Dependencias que el service inyecta al usecase (ORM + config + push a Channex). */
export interface AvailabilityDeps {
  findMany: (model: string, query: any) => Promise<any[]>
  getConfig: (hotelId: string) => Promise<{ channexPropertyId?: string | null } | undefined>
  pushToChannex: (cfg: any, roomType: string, ranges: AvailabilityRange[]) => Promise<{ pushed: boolean }>
  /** Full sync (test 1 de certificación): TODOS los room types en UNA sola llamada. */
  pushAllToChannex: (cfg: any, list: Array<{ roomType: string; ranges: AvailabilityRange[] }>) => Promise<{ pushed: number }>
}

/** Horizonte del full sync: la certificación PMS de Channex exige 500 días de ARI. */
export const FULL_SYNC_HORIZON_DAYS = 500

/** Lee DB del hotel, recalcula availability del roomType y empuja a Channex. */
export async function pushAvailabilityForRoomType(deps: AvailabilityDeps, hotelId: string, roomType: string): Promise<{ pushed: boolean }> {
  const cfg = await deps.getConfig(hotelId)
  if (!cfg?.channexPropertyId) return { pushed: false }
  const [rooms, reservations, blocks] = await Promise.all([
    deps.findMany('Rooms', { hotelId }),
    deps.findMany('Reservations', { hotelId }),
    deps.findMany('RoomBlocks', { hotelId }),
  ])
  const ranges = buildAvailabilityRanges(roomType, rooms, reservations, blocks)
  if (!ranges?.length) return { pushed: false }
  return deps.pushToChannex(cfg, roomType, ranges)
}

/**
 * Full sync de availability (test 1): computa los rangos de TODOS los room types del hotel
 * (500 días, reservas/bloques descontados, rangos comprimidos) y los empuja en UNA llamada.
 * Cada push por evento sigue siendo delta (90 días del tipo tocado); esto es el arranque
 * y la recuperación de desincronización.
 */
export async function pushAllRoomTypesAvailability(deps: AvailabilityDeps, hotelId: string): Promise<{ pushed: number }> {
  const cfg = await deps.getConfig(hotelId)
  if (!cfg?.channexPropertyId) return { pushed: 0 }
  const [rooms, reservations, blocks] = await Promise.all([
    deps.findMany('Rooms', { hotelId }),
    deps.findMany('Reservations', { hotelId }),
    deps.findMany('RoomBlocks', { hotelId }),
  ])
  const types = [...new Set(rooms.map((r: any) => String(r.type || '').toLowerCase()).filter(Boolean))]
  const list = types
    .map((roomType) => {
      // buildAvailabilityRanges matchea case-insensitive: el título original del primer room del tipo.
      const original = rooms.find((r: any) => String(r.type).toLowerCase() === roomType)
      const ranges = buildAvailabilityRanges(roomType, rooms, reservations, blocks, undefined, FULL_SYNC_HORIZON_DAYS)
      return ranges?.length ? { roomType: original?.type ?? roomType, ranges } : null
    })
    .filter((x): x is { roomType: string; ranges: AvailabilityRange[] } => x !== null)
  if (!list.length) return { pushed: 0 }
  return deps.pushAllToChannex(cfg, list)
}

/** Atajo: resuelve el roomType desde roomId y empuja availability de ese tipo. */
export async function pushAvailabilityForRoom(deps: AvailabilityDeps, hotelId: string, roomId: string): Promise<{ pushed: boolean }> {
  const room = (await deps.findMany('Rooms', { id: roomId }))[0]
  if (!room) return { pushed: false }
  return pushAvailabilityForRoomType(deps, hotelId, room.type)
}
