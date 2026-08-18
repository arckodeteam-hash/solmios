// crm/usecases/send-campaign.ts — Envío de una campaña a su segmento (spec crm-campaigns).
//
// Piezas que reusa (no duplica): los miembros los resuelve `SegmentUseCase.guestsIn`
// (la MISMA definición que ve la vista), y el envío físico va a `email_queue` vía el
// puerto `enqueue` (connector crm-emailqueue). Este usecase solo orquesta: filtrar los
// sin-email, deduplicar contra el log, resolver variables y dejar todo registrado.
import type { RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, ConflictError, ValidationError } from 'arckode-framework'
import type { CampaignDTO, CampaignSendDTO, SendCampaignResult } from '../types'

/** Puerto hacia email-queue. Lo cablea el connector `crm-emailqueue` (solo wirea). */
export interface CampaignEnqueuePort {
  enqueue(hotelId: string, to: string, subject: string, html: string): Promise<unknown>
}

export interface SendCampaignDeps {
  campaignRepo: RepositoryAdapter<CampaignDTO>
  sendRepo: RepositoryAdapter<CampaignSendDTO>
  /** Miembros del segmento — misma fuente que la vista (single source of truth). */
  guestsIn: (hotelId: string, segmentId: string) => Promise<any[]>
  /** Nombre del hotel para {{hotel}} — inyectable para no acoplar el CRM a Hotels. */
  getHotelName?: (hotelId: string) => Promise<string>
  enqueue: CampaignEnqueuePort['enqueue'] | null
  now: () => Date
}

/** Variables del cuerpo. La desconocida queda literal (no rompe el envío). */
export function renderBody(body: string, guest: any, hotelName: string): string {
  return String(body ?? '')
    .replace(/\{\{\s*nombre\s*\}\}/g, String(guest?.name ?? ''))
    .replace(/\{\{\s*hotel\s*\}\}/g, hotelName)
    .replace(/\{\{\s*puntos\s*\}\}/g, String(Number(guest?.loyaltyPoints ?? 0)))
}

/** Alta: nace draft con contadores en cero (spec crm-campaigns). */
export async function createCampaign(deps: Pick<SendCampaignDeps, 'campaignRepo'>, dto: { hotelId: string; name: string; segmentId: string; subject: string; body: string }): Promise<CampaignDTO> {
  return deps.campaignRepo.create({ ...dto, status: 'draft', sentCount: 0, sentAt: null } as any)
}

export async function listCampaigns(deps: Pick<SendCampaignDeps, 'campaignRepo'>, hotelId: string): Promise<CampaignDTO[]> {
  return deps.campaignRepo.findMany({ hotelId })
}

export async function sendCampaign(
  deps: SendCampaignDeps,
  hotelId: string, campaignId: string,
): Promise<SendCampaignResult> {
  const campaign = await deps.campaignRepo.findById(campaignId)
  if (!campaign) throw new NotFoundError('Campaña no encontrada')
  if (campaign.hotelId !== hotelId) throw new NotFoundError('Campaña no encontrada') // ownership por opacidad
  if (campaign.status === 'sent') throw new ConflictError('La campaña ya fue enviada')

  if (!String(campaign.subject ?? '').trim()) throw new ValidationError('La campaña necesita asunto')

  const members = await deps.guestsIn(hotelId, campaign.segmentId)
  // Anti-reenvío: el log manda — aunque el segmento reevalúe distinto, quien ya recibió no recibe.
  const previous = await deps.sendRepo.findMany({ campaignId })
  const alreadySent = new Set(previous.map((s) => s.guestId))

  const hotelName = deps.getHotelName ? await deps.getHotelName(hotelId).catch(() => '') : ''
  const sentAt = deps.now().toISOString()
  let queued = 0
  let skipped = 0

  for (const guest of members) {
    if (!guest?.id || alreadySent.has(guest.id)) { skipped++; continue }
    const email = String(guest.email ?? '').trim()
    if (!email) { skipped++; continue } // sin email: se omite sin abortar a los demás (spec)

    if (deps.enqueue) {
      try {
        await deps.enqueue(hotelId, email, campaign.subject, renderBody(campaign.body, guest, hotelName))
        queued++
      } catch {
        skipped++ // un destinatario roto no aborta la campaña; el log refleja lo real
        continue
      }
    } else {
      throw new ValidationError('El envío de emails no está disponible (cola no conectada)')
    }

    await deps.sendRepo.create({ hotelId, campaignId, guestId: guest.id, email, sentAt } as any)
    alreadySent.add(guest.id)
  }

  await deps.campaignRepo.update(campaignId, {
    status: 'sent', sentCount: queued, sentAt,
  } as any)

  return { queued, skipped }
}
