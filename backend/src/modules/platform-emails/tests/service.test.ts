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

// ─── Identidad de la plataforma en los correos ───────────────────────────────
// El "Nombre de la Plataforma" de Configuración → Plataforma se guardaba pero ningún correo lo
// usaba: "SolmiOS" estaba escrito a mano en las 10 plantillas.

function makeConfigRepo(plataforma: Record<string, unknown> | null, asString = false) {
  return {
    findOne: async (f: Record<string, unknown>) =>
      f.hotelId === 'platform' && f.key === 'plataforma' && plataforma
        ? { id: 'c1', hotelId: 'platform', key: 'plataforma', value: asString ? JSON.stringify(plataforma) : plataforma }
        : null,
  }
}

describe('PlatformEmailsService — variables de plataforma', () => {
  const tpl = makeTemplate({
    subject: '{platform_name}: bienvenido {hotel_name}',
    body: '<p>{hotel_name} · soporte {support_email} / {support_phone}</p>',
  })

  it('resuelve {platform_name}/{support_*} desde configuration(platform, plataforma)', async () => {
    const { repo } = makeRepo([tpl])
    const svc = new PlatformEmailsService(repo, makeConfigRepo({ platformName: 'HotelPro', supportEmail: 'ayuda@hotelpro.com', supportPhone: '809-555-0000' }))
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)

    await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'Hotel Sol' })
    expect(sent[0]!.subject).toBe('HotelPro: bienvenido Hotel Sol')
    expect(sent[0]!.html).toBe('<p>Hotel Sol · soporte ayuda@hotelpro.com / 809-555-0000</p>')
  })

  it('value guardado como JSON string también se lee', async () => {
    const { repo } = makeRepo([tpl])
    const svc = new PlatformEmailsService(repo, makeConfigRepo({ platformName: 'HotelPro' }, true))
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)
    await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'X' })
    expect(sent[0]!.subject).toBe('HotelPro: bienvenido X')
  })

  it('sin config o sin configRepo: default "SolmiOS" y soporte vacío, nunca queda {platform_name} crudo', async () => {
    const { repo } = makeRepo([tpl])
    for (const svc of [new PlatformEmailsService(repo), new PlatformEmailsService(repo, makeConfigRepo(null))]) {
      const { sender, sent } = makeSender()
      svc.setEmailDeps(sender)
      await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'X' })
      expect(sent[0]!.subject).toBe('SolmiOS: bienvenido X')
      expect(sent[0]!.html).not.toContain('{')
    }
  })

  it('las variables del evento pisan a las de plataforma', async () => {
    const { repo } = makeRepo([tpl])
    const svc = new PlatformEmailsService(repo, makeConfigRepo({ platformName: 'HotelPro' }))
    const { sender, sent } = makeSender()
    svc.setEmailDeps(sender)
    await svc.sendEvent('welcome', 'dueno@hotel.com', 'h1', { hotel_name: 'X', platform_name: 'Override' })
    expect(sent[0]!.subject).toBe('Override: bienvenido X')
  })

  it('list()/get() agregan las variables globales al hint sin duplicar ni tocar la fila', async () => {
    const rows = [makeTemplate(), makeTemplate({ id: 'tpl-2', event: 'trial_ending', variables: '["hotel_name","platform_name"]' })]
    const { repo } = makeRepo(rows)
    const svc = new PlatformEmailsService(repo)

    const list = await svc.list()
    expect(JSON.parse(list[0]!.variables)).toEqual(['hotel_name', 'link', 'platform_name', 'support_email', 'support_phone'])
    expect(JSON.parse(list[1]!.variables)).toEqual(['hotel_name', 'platform_name', 'support_email', 'support_phone'])
    expect(JSON.parse((await svc.get('welcome'))!.variables)).toContain('support_email')
    // La fila en el repo no cambia: el hint se arma en la respuesta.
    expect(rows[0]!.variables).toBe('["hotel_name","link"]')
  })
})
