// crm/usecases/campaigns.ts — Fachada de campañas (spec crm-campaigns). Repos y email
// se inyectan post-init (index.ts + composition-root) — mismo ciclo de vida que el service.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { CampaignDTO, CampaignSendDTO, CreateCampaignDTO, SendCampaignResult } from '../types'
import { sendCampaign, createCampaign, listCampaigns, type CampaignEnqueuePort } from './send-campaign'

export interface CampaignDepsSource {
  guestsIn: (hotelId: string, segmentId: string) => Promise<any[]>
}

export class CampaignUseCase {
  private campaignsRepo: RepositoryAdapter<CampaignDTO> | null = null
  private sendRepo: RepositoryAdapter<CampaignSendDTO> | null = null
  private enqueue: CampaignEnqueuePort['enqueue'] | null = null

  setRepos(campaigns: RepositoryAdapter<CampaignDTO>, sends: RepositoryAdapter<CampaignSendDTO>): void {
    this.campaignsRepo = campaigns
    this.sendRepo = sends
  }

  /** EmailService.enqueue — inyectado post-init desde composition-root (patrón wallet-pass). */
  setEnqueuePort(enqueue: CampaignEnqueuePort['enqueue']): void { this.enqueue = enqueue }

  private deps(source: CampaignDepsSource) {
    if (!this.campaignsRepo || !this.sendRepo) throw new ValidationError('Repositorio de campañas no configurado')
    return {
      campaignRepo: this.campaignsRepo,
      sendRepo: this.sendRepo,
      guestsIn: source.guestsIn,
      enqueue: this.enqueue,
      now: () => new Date(),
    }
  }

  create(source: CampaignDepsSource, dto: CreateCampaignDTO): Promise<CampaignDTO> {
    return createCampaign(this.deps(source), dto as any)
  }

  list(source: CampaignDepsSource, hotelId: string): Promise<CampaignDTO[]> {
    if (!this.campaignsRepo) return Promise.resolve([])
    return listCampaigns(this.deps(source), hotelId)
  }

  send(source: CampaignDepsSource, hotelId: string, campaignId: string): Promise<SendCampaignResult> {
    if (!this.enqueue) throw new ValidationError('El envío de emails no está disponible')
    return sendCampaign(this.deps(source), hotelId, campaignId)
  }
}
