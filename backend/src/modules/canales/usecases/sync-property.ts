// canales/usecases/sync-property.ts — Orquestación del sync de estructura + ARI inicial.
//
// Sale del service para que no sea un God Object (gate del analyzer): el service solo inyecta sus
// dependencias. Lo que pasa acá, en orden, es lo que Channex espera de un PMS que se conecta por
// primera vez (o que se re-sincroniza):
//   1. leer config, modo de tarificación y planes del hotel;
//   2. crear/actualizar property → room types → rate plans en Channex y persistir el mapping;
//   3. empujar el ARI completo en EXACTAMENTE 2 llamadas (test 1 de la certificación);
//   4. dejar rastro en sync_log.

import type { Logger, RepositoryAdapter } from 'arckode-framework'
import type { CanalesDTO, RoomTypeSummary, SyncResultDTO } from '../types'
import type { RatePlanDef } from './rate-plans'
import { pushFullSyncAri } from './full-sync'

export interface SyncPropertyHotel {
  name: string
  currency?: string
  email?: string
  address?: string
  timezone?: string
}

export interface SyncPropertyDeps {
  getConfig: (hotelId: string) => Promise<CanalesDTO | undefined>
  getRatePlans: (hotelId: string) => Promise<RatePlanDef[]>
  channexSync: (
    hotelId: string, hotel: SyncPropertyHotel, rooms: RoomTypeSummary[], cfg: CanalesDTO | undefined,
    ratePlans: RatePlanDef[],
  ) => Promise<{ result: SyncResultDTO; newPropertyId: string | null; newGroupId: string | null }>
  upsertConfig: (hotelId: string, patch: Partial<CanalesDTO>) => Promise<CanalesDTO>
  pushAllAvailability: (hotelId: string) => Promise<unknown>
  pushRates: (hotelId: string) => Promise<unknown>
  logger: Logger
  syncLogRepo?: RepositoryAdapter<any> | null
}

export async function syncPropertyToChannex(
  deps: SyncPropertyDeps, hotelId: string, hotel: SyncPropertyHotel, rooms: RoomTypeSummary[],
): Promise<SyncResultDTO> {
  const [cfg, ratePlans] = await Promise.all([
    deps.getConfig(hotelId),
    // Planes del hotel (BAR + B&B por defecto): un rate plan de Channex por (room type × plan) — P5.
    deps.getRatePlans(hotelId),
  ])
  const { result, newPropertyId, newGroupId } = await deps.channexSync(hotelId, hotel, rooms, cfg, ratePlans)
  const lastSync = new Date().toISOString()
  // El grupo se persiste junto con la property: es la frontera de aislamiento del hotel dentro de
  // la cuenta de plataforma, y el token del iframe lo necesita para acotar lo que el hotel ve.
  // `syncEnabled: 1` SIEMPRE, no solo al crear la propiedad: sincronizar a mano es pedir publicar,
  // así que reactiva un hotel que había pausado la sincronización desde el panel. Sin esto, el
  // botón "Forzar Sync Ahora" publicaría una vez y los cambios siguientes volverían a quedar mudos.
  await deps.upsertConfig(hotelId, newPropertyId
    ? { channexPropertyId: newPropertyId, syncEnabled: 1, lastSync, ...(newGroupId ? { channexGroupId: newGroupId } : {}) }
    : { syncEnabled: 1, lastSync })

  // ARI del full sync en exactamente 2 llamadas (test 1 de certificación) — ver usecases/full-sync.ts.
  await pushFullSyncAri({
    pushAll: () => deps.pushAllAvailability(hotelId),
    pushRates: () => deps.pushRates(hotelId),
    logger: deps.logger,
  }, hotelId)

  if (deps.syncLogRepo) try {
    await deps.syncLogRepo.create({
      id: crypto.randomUUID(), hotelId, channel: 'channex', action: 'sync_property',
      status: result.success ? 'success' : 'error',
      details: { roomTypes: result.roomTypes, ratePlans: result.ratePlans, newPropertyId, newGroupId },
      createdAt: new Date().toISOString(),
    })
  } catch { /* el log de auditoría no debe romper el sync */ }
  return result
}

/**
 * Agrupa las habitaciones FÍSICAS del hotel en los room types que entiende Channex.
 *
 * Channex vende TIPOS con un `count_of_rooms`, no unidades sueltas. Vive acá para que la ruta
 * manual (`POST /api/channels/sync`) y el aprovisionamiento automático de un hotel nuevo armen
 * exactamente el mismo payload — si divergen, un hotel termina con un catálogo distinto según
 * por dónde se sincronizó.
 */
export function summarizeRoomTypes(rooms: Array<{ type?: string; basePrice?: number; capacity?: number }>): RoomTypeSummary[] {
  const seen = new Map<string, RoomTypeSummary>()
  for (const r of rooms) {
    const type = String(r?.type || '').trim()
    if (!type) continue
    const current = seen.get(type)
    if (current) {
      current.cnt++
      // Capacidad MÁXIMA y precio MÍNIMO positivo entre las unidades del tipo — mismo criterio
      // que usa el motor público para publicar "desde $X" (bookingengine/availability.ts).
      current.capacity = Math.max(current.capacity, Number(r.capacity) || 0)
      const price = Number(r.basePrice) || 0
      if (price > 0 && (current.basePrice <= 0 || price < current.basePrice)) current.basePrice = price
    } else {
      seen.set(type, { type, basePrice: Number(r.basePrice) || 0, capacity: Number(r.capacity) || 2, cnt: 1 })
    }
  }
  return [...seen.values()]
}
