// platform-emails/tests/service.test.ts — sendEvent() nunca debe romper el flujo que lo llama.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { PlatformEmailsService } from '../service'
import type { PlatformEmailTemplateDTO } from '../types'

function makeRepo(rows: PlatformEmailTemplateDTO[]): { repo: RepositoryAdapter<PlatformEmailTemplateDTO>; updates: Array<{ id: string; patch: any }> } {
  const updates: Array<{ id: string; patch: any }> = []
  const repo = {
    findMany: async () => rows,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findOne: async (filters: Record<string, unknown>) =>
      rows.find((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v)) ?? null,
    create: async (d: any) => { rows.push(d); return d },
    update: async (id: string, patch: any) => {
      updates.push({ id, patch })
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
    delete: async () => true,
    count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<PlatformEmailTemplateDTO>
  return { repo, updates }
}

function makeTemplate(overrides: Partial<PlatformEmailTemplateDTO> = {}): PlatformEmailTemplateDTO {
  return {
    id: 'tpl-1',
    event: 'welcome',
    subject: 'Bienvenido {hotel_name}',
    body: '<p>Hola {hotel_name}, entrá acá: {link}</p>',
    variables: '["hotel_name","link"]',
    isActive: true,
    ...overrides,
  }
}

function makeSender() {
  const sent: Array<{ to: string; subject: string; html: string; hotelId: string; relatedType?: string }> = []
  return {
    sender: { enqueue: async (input: any) => { sent.push(input); return 'queued-id' } },
    sent,
  }
}

describe('PlatformEmailsService.sendEvent', () => {
  it('plantilla activa + sender: renderiza y encola, devuelve {sent:true}', async () => {
    const { repo } = makeRepo([makeTemplate()])
    const svc = new PlatformEmailsService(repo)
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel Sol', link: 'https://x.com/panel' })

    expect(result).toEqual({ sent: true })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('dueno@hotel.com')
    expect(sent[0]!.subject).toBe('Bienvenido Hotel Sol')
    expect(sent[0]!.html).toBe('<p>Hola Hotel Sol, entrá acá: https://x.com/panel</p>')
    expect(sent[0]!.hotelId).toBe('h1')
    expect(sent[0]!.relatedType).toBe('platform_email:welcome')
  })

  it('plantilla inactiva: no envía', async () => {
    const { repo } = makeRepo([makeTemplate({ isActive: false })])
    const svc = new PlatformEmailsService(repo)
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', {})
    expect(result).toEqual({ sent: false })
    expect(sent).toHaveLength(0)
  })

  it('evento sin plantilla: no envía ni explota', async () => {
    const { repo } = makeRepo([])
    const svc = new PlatformEmailsService(repo)
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('trial_expired', 'dueno@hotel.com', 'h1', {})
    expect(result).toEqual({ sent: false })
    expect(sent).toHaveLength(0)
  })

  it('sin sender inyectado: no envía ni explota', async () => {
    const { repo } = makeRepo([makeTemplate()])
    const svc = new PlatformEmailsService(repo)

    const result = await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', {})
    expect(result).toEqual({ sent: false })
  })

  it('sin destinatario: no envía ni explota', async () => {
    const { repo } = makeRepo([makeTemplate()])
    const svc = new PlatformEmailsService(repo)
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('welcome', '', 'h1', {})
    expect(result).toEqual({ sent: false })
    expect(sent).toHaveLength(0)
  })
})

function makeConfigRepo(value: unknown): RepositoryAdapter<Record<string, unknown>> {
  const row = value === undefined ? null : { id: 'cfg-1', hotelId: 'platform', key: 'plataforma', value }
  return {
    findMany: async () => (row ? [row] : []),
    findById: async () => row,
    findOne: async (filters: Record<string, unknown>) =>
      row && filters.key === 'plataforma' && filters.hotelId === 'platform' ? row : null,
    create: async (d: any) => d,
    update: async () => row,
    delete: async () => true,
    count: async () => (row ? 1 : 0),
    paginate: async () => ({ data: row ? [row] : [], total: row ? 1 : 0, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<Record<string, unknown>>
}

describe('PlatformEmailsService.sendEvent — identidad de la plataforma (CFG-1)', () => {
  const brandedTemplate = () => makeTemplate({
    subject: 'Bienvenido a {platform_name}, {hotel_name}',
    body: '<p>Hola {hotel_name}. Dudas: {support_email} / {support_phone}. Entrá: {link}</p>',
    variables: '["hotel_name","link","platform_name","support_email","support_phone"]',
  })
  const platformCfg = JSON.stringify({ platformName: 'HotelPro', supportEmail: 'help@hotelpro.com', supportPhone: '+54 11 5555' })

  it('inyecta {platform_name}/{support_email}/{support_phone} desde configuration(plataforma)', async () => {
    const { repo } = makeRepo([brandedTemplate()])
    const svc = new PlatformEmailsService(repo, makeConfigRepo(platformCfg))
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel X', link: 'https://x.com/panel' })

    expect(result).toEqual({ sent: true })
    expect(sent[0]!.subject).toBe('Bienvenido a HotelPro, Hotel X')
    expect(sent[0]!.html).toContain('help@hotelpro.com')
    expect(sent[0]!.html).toContain('+54 11 5555')
    expect(sent[0]!.html).not.toContain('{support_email}')
  })

  it('el caller gana si manda su propia platform_name', async () => {
    const { repo } = makeRepo([brandedTemplate()])
    const svc = new PlatformEmailsService(repo, makeConfigRepo(platformCfg))
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel X', link: 'https://x.com/panel', platform_name: 'Custom' })

    expect(sent[0]!.subject).toBe('Bienvenido a Custom, Hotel X')
    expect(sent[0]!.html).toContain('help@hotelpro.com')
  })

  it('sin configRepo: usa los defaults (SolmiOS) y no explota', async () => {
    const { repo } = makeRepo([brandedTemplate()])
    const svc = new PlatformEmailsService(repo)
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel X', link: 'https://x.com/panel' })

    expect(result).toEqual({ sent: true })
    expect(sent[0]!.subject).toBe('Bienvenido a SolmiOS, Hotel X')
    expect(sent[0]!.html).toContain('soporte@solmios.com')
  })

  it('configRepo sin fila de plataforma: defaults', async () => {
    const { repo } = makeRepo([brandedTemplate()])
    const svc = new PlatformEmailsService(repo, makeConfigRepo(undefined))
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel X', link: 'https://x.com/panel' })
    expect(sent[0]!.subject).toBe('Bienvenido a SolmiOS, Hotel X')
  })

  it('configRepo que rechaza: defaults, el envío sale igual', async () => {
    const { repo } = makeRepo([brandedTemplate()])
    const broken = { findOne: async () => { throw new Error('db down') } } as unknown as RepositoryAdapter<Record<string, unknown>>
    const svc = new PlatformEmailsService(repo, broken)
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    const result = await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel X', link: 'https://x.com/panel' })
    expect(result).toEqual({ sent: true })
    expect(sent[0]!.subject).toBe('Bienvenido a SolmiOS, Hotel X')
  })
})

describe('PlatformEmailsService.update', () => {
  it('actualiza la plantilla existente por evento', async () => {
    const { repo, updates } = makeRepo([makeTemplate()])
    const svc = new PlatformEmailsService(repo)

    const result = await svc.update('welcome', { subject: 'Nuevo asunto' })
    expect(updates).toEqual([{ id: 'tpl-1', patch: { subject: 'Nuevo asunto' } }])
    expect(result.subject).toBe('Nuevo asunto')
  })

  it('evento sin fila: tira NotFoundError', async () => {
    const { repo } = makeRepo([])
    const svc = new PlatformEmailsService(repo)
    await expect(svc.update('welcome', { subject: 'x' })).rejects.toThrow('welcome')
  })
})

describe('PlatformEmailsService.list/get', () => {
  it('list() devuelve todas las filas', async () => {
    const { repo } = makeRepo([makeTemplate(), makeTemplate({ id: 'tpl-2', event: 'trial_ending' })])
    const svc = new PlatformEmailsService(repo)
    expect(await svc.list()).toHaveLength(2)
  })

  it('get() busca por evento, null si no existe', async () => {
    const { repo } = makeRepo([makeTemplate()])
    const svc = new PlatformEmailsService(repo)
    expect(await svc.get('welcome')).toMatchObject({ id: 'tpl-1' })
    expect(await svc.get('payment_failed')).toBeNull()
  })
})
