// crm/tests/send-campaign.test.ts — Spec crm-campaigns: envío completo, sin email,
// reenvío 409, dedupe por huésped, y variables del cuerpo.
import { describe, it, expect } from 'bun:test'
import { sendCampaign, renderBody } from '../usecases/send-campaign'

function makeCampaignRepo(campaign: any) {
  const updated: any[] = []
  return {
    updated,
    findById: async (id: string) => (id === campaign.id ? campaign : null),
    findMany: async () => [campaign],
    create: async (d: any) => d,
    update: async (id: string, d: any) => { updated.push({ id, d }); return { ...campaign, ...d } },
  } as any
}

function makeSendRepo(existing: any[] = []) {
  const created: any[] = []
  return {
    created,
    findMany: async (f: any) => existing.filter((s) => !f.campaignId || s.campaignId === f.campaignId),
    create: async (d: any) => { created.push(d); return d },
  } as any
}

const baseCampaign = { id: 'c1', hotelId: 'h1', segmentId: 'seg1', subject: 'Hola {{nombre}}', body: 'Tienes {{puntos}} puntos en {{hotel}}', status: 'draft' }

function deps(members: any[], opts: { existing?: any[]; enqueue?: any } = {}) {
  return {
    campaignRepo: makeCampaignRepo({ ...baseCampaign }),
    sendRepo: makeSendRepo(opts.existing ?? []),
    guestsIn: async () => members,
    getHotelName: async () => 'Hotel Palma',
    enqueue: opts.enqueue ?? (async () => 'queued-id'),
    now: () => new Date('2026-08-18T12:00:00Z'),
  }
}

describe('sendCampaign (spec crm-campaigns)', () => {
  it('envío completo: encola por miembro, loguea, y marca sent con sentCount', async () => {
    const enqueued: any[] = []
    const d = deps([
      { id: 'g1', name: 'Carlos', email: 'c@x.com', loyaltyPoints: 5400 },
      { id: 'g2', name: 'Ana', email: 'a@x.com', loyaltyPoints: 100 },
    ], { enqueue: async (h: string, to: string, subject: string, html: string) => { enqueued.push({ h, to, subject, html }); return 'q' } })

    const res = await sendCampaign(d, 'h1', 'c1')
    expect(res).toEqual({ queued: 2, skipped: 0 })
    expect(enqueued).toHaveLength(2)
    // Variables resueltas por destinatario (spec)
    expect(enqueued[0].html).toContain('5400 puntos en Hotel Palma')
    expect(enqueued[1].html).toContain('100 puntos')
    expect(d.sendRepo.created).toHaveLength(2)
    expect(d.campaignRepo.updated[0].d.status).toBe('sent')
    expect(d.campaignRepo.updated[0].d.sentCount).toBe(2)
  })

  it('miembro sin email se omite sin abortar (spec)', async () => {
    const d = deps([
      { id: 'g1', name: 'Con', email: 'c@x.com' },
      { id: 'g2', name: 'Sin', email: '' },
      { id: 'g3', name: 'Otro', email: null },
    ])
    const res = await sendCampaign(d, 'h1', 'c1')
    expect(res).toEqual({ queued: 1, skipped: 2 })
  })

  it('campaña ya enviada → 409 Conflict sin efectos (spec)', async () => {
    const d = deps([{ id: 'g1', email: 'c@x.com' }])
    ;(d.campaignRepo as any).findById = async () => ({ ...baseCampaign, status: 'sent' })
    await expect(sendCampaign(d, 'h1', 'c1')).rejects.toThrow('ya fue enviada')
    expect(d.sendRepo.created).toHaveLength(0)
  })

  it('dedupe: huésped ya en el log no recibe dos veces (spec)', async () => {
    const d = deps([
      { id: 'g1', name: 'Carlos', email: 'c@x.com' },
      { id: 'g1', name: 'Carlos DUPLICADO por data sucia', email: 'c@x.com' },
    ], { existing: [{ campaignId: 'c1', guestId: 'g1', email: 'c@x.com' }] })
    const res = await sendCampaign(d, 'h1', 'c1')
    expect(res.queued).toBe(0) // ya estaba en el log → ni el duplicado entra
  })

  it('ownership: campaña de otro hotel → not found (opacidad, no fuga)', async () => {
    const d = deps([])
    await expect(sendCampaign(d, 'h-OTRO', 'c1')).rejects.toThrow('no encontrada')
  })

  it('renderBody: variable desconocida queda literal', () => {
    expect(renderBody('Hola {{nombre}} {{cosa}}', { name: 'Ana' }, 'H')).toBe('Hola Ana {{cosa}}')
  })
})
