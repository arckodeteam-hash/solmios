// canales/usecases/channel-api.ts — Channel API operations (test connection, mapping, groups, etc.)
import type { Logger } from 'arckode-framework'
import { ChannexUseCase } from './channex'
import type { CanalesDTO, TestConnectionResultDTO, MappingDetailDTO, GroupDTO, OTAChannelCreateDTO, OTAChannelResultDTO } from '../types'
import { syncOpenChannelMapping } from './open-channel-connect'
import { readRatePlans } from './rate-plans'

/** Lo que el re-mapeo automático necesita del hotel. Lo inyecta el service (que es una fachada). */
export interface OpenChannelPorts {
  config: { getConfig: (hotelId: string) => Promise<CanalesDTO | undefined> }
  queries: {
    findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>
    readChannelMappings: (hotelId: string) => Promise<any[]>
  }
  logger: Logger
}

export class ChannelApiUseCase {
  constructor(
    private readonly channex: ChannexUseCase,
    private readonly ports?: OpenChannelPorts,
  ) {}

  /**
   * Deja el canal propio del hotel mapeado contra la estructura recién publicada.
   * Se llama al final de cada sync: un tipo de habitación nuevo quedaba si no "Sin mapear".
   */
  async syncOpenChannelMapping(hotelId: string): Promise<number | null> {
    const p = this.ports
    if (!p) return null
    return syncOpenChannelMapping({
      findOpenChannel: async (h) => this.channex.findChannelByType(await p.config.getConfig(h), 'OpenChannel'),
      readMappings: (h) => p.queries.readChannelMappings(h),
      readRatePlans: (h) => readRatePlans((m, q) => p.queries.findMany(m, q), h),
      readRooms: (h) => p.queries.findMany('Rooms', { hotelId: h }),
      updateMapping: async (h, c, rps) => this.channex.updateChannelMapping(await p.config.getConfig(h), c, rps),
      logger: p.logger,
    }, hotelId)
  }

  async testConnection(cfg: any, channel: string, otaHotelId: string): Promise<TestConnectionResultDTO> {
    return this.channex.testConnection(cfg, { channel, hotel_id: otaHotelId })
  }

  async getMappingDetails(cfg: any, channel: string, otaHotelId: string): Promise<{ success: boolean; rooms: MappingDetailDTO[]; error?: string }> {
    return this.channex.getMappingDetails(cfg, channel, otaHotelId)
  }

  async listGroups(cfg: any): Promise<GroupDTO[]> {
    return this.channex.listGroups(cfg)
  }

  async createOTAChannel(cfg: any, dto: OTAChannelCreateDTO): Promise<OTAChannelResultDTO> {
    return this.channex.createOTAChannel(cfg, dto)
  }

  async deactivateChannel(cfg: any, channelId: string): Promise<{ success: boolean; message: string }> {
    return this.channex.deactivateChannel(cfg, channelId)
  }

  async getChannelDetail(cfg: any, channelId: string): Promise<any | null> {
    return this.channex.getChannelDetail(cfg, channelId)
  }

  /** Reemplaza el mapeo de rate plans de un canal existente. Semántica de REEMPLAZO — ver channex.ts. */
  async updateChannelMapping(cfg: any, channelId: string, ratePlans: any[]): Promise<{ success: boolean; mapped: number; message: string }> {
    return this.channex.updateChannelMapping(cfg, channelId, ratePlans)
  }

  /** Qué falta para poder activar el canal. */
  async checkChannelReadiness(cfg: any, channelId: string): Promise<{ ready: boolean; issues: string[] }> {
    return this.channex.checkChannelReadiness(cfg, channelId)
  }

  /** Verifica y activa. */
  async activateChannel(cfg: any, channelId: string): Promise<{ success: boolean; message: string; issues: string[] }> {
    return this.channex.activateChannel(cfg, channelId)
  }
}
