// canales/usecases/provisioning.ts — Alta del hotel en el channel manager.
//
// Dos entradas al MISMO camino, para que no diverjan:
//  - `syncHotel`: el botón "Sincronizar" del panel;
//  - `autoProvision`: la primera habitación que carga un hotel nuevo (connector habitaciones-canales).
//
// Vive fuera del service porque el service es una fachada con límite de tamaño (gate del
// analyzer): acá está el armado de dependencias, allá quedan dos delegaciones de una línea.

import type { Logger } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import type { CanalesDTO, SyncResultDTO, RoomTypeSummary } from '../types'
import { summarizeRoomTypes } from './sync-property'
import { autoProvisionChannex, type AutoProvisionOutcome } from './auto-provision'

export interface ProvisioningDeps {
  getConfig: (hotelId: string) => Promise<CanalesDTO | undefined>
  findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>
  /** El sync de bajo nivel del service (property + room types + rate plans + ARI). */
  syncProperty: (hotelId: string, hotel: any, rooms: RoomTypeSummary[]) => Promise<SyncResultDTO>
  /** ¿La plataforma tiene credencial de Channex? Sin ella no tiene sentido intentar. */
  hasPlatformKey: () => Promise<boolean>
  /** ¿El plan del hotel incluye el channel manager? Sin checker, se asume que sí. */
  isModuleEnabled?: (hotelId: string, moduleKey: string) => Promise<boolean>
  logger: Logger
}

export class ProvisioningUseCase {
  constructor(private readonly deps: ProvisioningDeps) {}

  /** Sync completo del hotel: lee sus datos y sus habitaciones reales y las publica. */
  async syncHotel(hotelId: string): Promise<SyncResultDTO> {
    const hotel = (await this.deps.findMany('Hotels', { id: hotelId }))[0]
    if (!hotel) throw new NotFoundError('Hotel no encontrado')
    const rooms = await this.deps.findMany('Rooms', { hotelId })
    return this.deps.syncProperty(hotelId, hotel, summarizeRoomTypes(rooms))
  }

  /** Alta automática. Best-effort y con guardas — ver `auto-provision.ts`. */
  autoProvision(hotelId: string): Promise<AutoProvisionOutcome> {
    return autoProvisionChannex({
      getConfig: (h) => this.deps.getConfig(h),
      findMany: (m, q) => this.deps.findMany(m, q),
      hasPlatformKey: () => this.deps.hasPlatformKey(),
      isModuleEnabled: (h, k) => this.deps.isModuleEnabled ? this.deps.isModuleEnabled(h, k) : Promise.resolve(true),
      sync: (h) => this.syncHotel(h),
      logger: this.deps.logger,
    }, hotelId)
  }
}
