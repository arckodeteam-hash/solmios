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
  getPricingMode: (hotelId: string) => Promise<'per_room' | 'per_person'>
  getRatePlans: (hotelId: string) => Promise<RatePlanDef[]>
  channexSync: (
    hotelId: string, hotel: SyncPropertyHotel, rooms: RoomTypeSummary[], cfg: CanalesDTO | undefined,
    pricingMode: 'per_room' | 'per_person', ratePlans: RatePlanDef[],
  ) => Promise<{ result: SyncResultDTO; newPropertyId: string | null }>
  upsertConfig: (hotelId: string, patch: Partial<CanalesDTO>) => Promise<CanalesDTO>
  pushAllAvailability: (hotelId: string) => Promise<unknown>
  pushRates: (hotelId: string) => Promise<unknown>
  logger: Logger
  syncLogRepo?: RepositoryAdapter<any> | null
}

export async function syncPropertyToChannex(
  deps: SyncPropertyDeps, hotelId: string, hotel: SyncPropertyHotel, rooms: RoomTypeSummary[],
): Promise<SyncResultDTO> {
  const [cfg, pricingMode, ratePlans] = await Promise.all([
    deps.getConfig(hotelId),
    deps.getPricingMode(hotelId),
    // Planes del hotel (BAR + B&B por defecto): un rate plan de Channex por (room type × plan) — P5.
    deps.getRatePlans(hotelId),
  ])
  const { result, newPropertyId } = await deps.channexSync(hotelId, hotel, rooms, cfg, pricingMode, ratePlans)
  const lastSync = new Date().toISOString()
  await deps.upsertConfig(hotelId, newPropertyId
    ? { channexPropertyId: newPropertyId, syncEnabled: 1, lastSync }
    : { lastSync })

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
      details: { roomTypes: result.roomTypes, ratePlans: result.ratePlans, newPropertyId },
      createdAt: new Date().toISOString(),
    })
  } catch { /* el log de auditoría no debe romper el sync */ }
  return result
}
