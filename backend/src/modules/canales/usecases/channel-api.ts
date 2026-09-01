// canales/usecases/channel-api.ts — Channel API operations (test connection, mapping, groups, etc.)
import { ChannexUseCase } from './channex'
import type { TestConnectionResultDTO, MappingDetailDTO, GroupDTO, OTAChannelCreateDTO, OTAChannelResultDTO } from '../types'

export class ChannelApiUseCase {
  constructor(private readonly channex: ChannexUseCase) {}

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
