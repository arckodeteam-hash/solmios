// sales-leads/tests/signup-alert.test.ts — REQ-PIPE-04 (#145): el aviso a ventas del alta.
//
// Dos cosas se afirman. (a) `buildSignupAlertEmail` es pura y trae lo que el vendedor necesita
// para contactar en 5 minutos: WhatsApp en E.164 con texto en español, email, teléfono, plan y el
// link al pipeline. (b) `notifySignup` encola con `relatedType='sales-pipeline:signup'` y
// `relatedId=hotelId`, y es best-effort de verdad: un sender que tira NO propaga (el alta que lo
// dispara ya devolvió la cuenta creada).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { buildSignupAlertEmail, signupWhatsappText, SALES_PIPELINE_PATH } from '../usecases/emails'
import { SalesLeadsService } from '../service'
import { SIGNUP_ALERT_RELATED_TYPE } from '../usecases/signup-alert'

const HOTEL = { id: 'h-nuevo', name: 'Hotel Costa Azul', email: 'ana@costaazul.com', phone: '809-555-0000', country: '' }
const OWNER = { id: 'u-ana', name: 'Ana Pérez', email: 'ana@costaazul.com' }

describe('buildSignupAlertEmail — función pura', () => {
  const base = {
    hotelId: HOTEL.id, hotelName: HOTEL.name, ownerName: OWNER.name, email: OWNER.email,
    phone: HOTEL.phone, country: null, planName: 'Starter', appUrl: 'https://hotel.zx89.site',
    whatsappUrl: 'https://wa.me/18095550000?text=Hola',
  }

  it('trae hotel, dueño, email, teléfono, plan, el botón de WhatsApp y el link al pipeline', () => {
    const { subject, html } = buildSignupAlertEmail(base)
    expect(subject).toContain('Hotel Costa Azul')
    expect(html).toContain('Hotel Costa Azul')
    expect(html).toContain('Ana Pérez')
    expect(html).toContain('mailto:ana@costaazul.com')
    expect(html).toContain('809-555-0000')
    expect(html).toContain('Starter')
    expect(html).toContain('href="https://wa.me/18095550000?text=Hola"')
    expect(html).toContain(`href="https://hotel.zx89.site${SALES_PIPELINE_PATH}"`)
  })

  it('sin WhatsApp posible lo dice, en vez de un botón que no lleva a nadie', () => {
    const { html } = buildSignupAlertEmail({ ...base, phone: null, whatsappUrl: null })
    expect(html).not.toContain('wa.me')
    expect(html).toContain('sin teléfono válido para WhatsApp')
  })

  it('escapa HTML del input: un nombre de hotel con <script> no ejecuta en la casilla de ventas', () => {
    const { html } = buildSignupAlertEmail({ ...base, hotelName: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('el texto prellenado es en español y nombra al dueño, al hotel y a la plataforma (por parámetro, no hardcodeada)', () => {
    const text = signupWhatsappText('Ana Pérez', 'Hotel Costa Azul', 'SOLMI OS')
    expect(text).toContain('Hola Ana Pérez')
    expect(text).toContain('Hotel Costa Azul')
    expect(text).toContain('le escribo de SOLMI OS')
    // CFG-1: el nombre sale de configuration('plataforma'); otro nombre, otro texto.
    const otro = signupWhatsappText('Ana Pérez', 'Hotel Costa Azul', 'Hotelería Andina')
    expect(otro).toContain('le escribo de Hotelería Andina')
    expect(otro).not.toContain('SOLMI OS')
  })
})

/** Repo mínimo para `plans`: solo `findOne` por id. */
function plansRepo(rows: any[]): RepositoryAdapter<any> {
  return { findOne: async (f: any) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null } as any
}

/** Repo mínimo para `configuration`: `findOne` por (hotelId,key). */
function configRepo(platformName: string): RepositoryAdapter<any> {
  return {
    findOne: async (f: any) => (f.hotelId === 'platform' && f.key === 'plataforma' ? { value: JSON.stringify({ platformName }) } : null),
  } as any
}

function makeService(opts: { plans?: any[]; platformName?: string } = {}) {
  const service = new SalesLeadsService({} as any, silentLogger() as unknown as Logger)
  if (opts.plans || opts.platformName) {
    service.setPipelineDeps({
      subscriptions: {} as any, hotels: {} as any, rooms: {} as any, roomRates: {} as any,
      channelConfig: {} as any, reservations: {} as any, auditlog: {} as any, users: {} as any, salesProspects: {} as any,
      plans: opts.plans ? plansRepo(opts.plans) : undefined,
      configuration: opts.platformName ? configRepo(opts.platformName) : undefined,
    })
  }
  return service
}

describe('SalesLeadsService.notifySignup — encolado en la misma petición', () => {
  it('encola a ventas con relatedType/relatedId del alta y wa.me en E.164 (809-555-0000 → 18095550000, DO por defecto)', async () => {
    const enqueued: any[] = []
    const service = makeService({ plans: [{ id: 'plan-starter', name: 'Starter' }] })
    service.setEmailDeps({ enqueue: async (i) => { enqueued.push(i); return 'q1' } }, 'https://hotel.zx89.site/')

    await service.notifySignup(HOTEL, OWNER, 'plan-starter')

    expect(enqueued).toHaveLength(1)
    const mail = enqueued[0]
    expect(mail.relatedType).toBe(SIGNUP_ALERT_RELATED_TYPE)
    expect(mail.relatedType).toBe('sales-pipeline:signup')
    expect(mail.relatedId).toBe('h-nuevo')
    expect(mail.hotelId).toBe('platform')
    expect(mail.html).toContain('wa.me/18095550000')
    // El texto prellenado viaja URL-encoded dentro del href.
    expect(mail.html).toContain(`?text=${encodeURIComponent(signupWhatsappText(OWNER.name, HOTEL.name, 'SolmiOS'))}`)
    expect(mail.html).toContain('Starter')
    expect(mail.html).toContain('https://hotel.zx89.site/admin/leads-ventas')
  })

  it('respeta el país del hotel: un teléfono español no se arma como dominicano', async () => {
    const enqueued: any[] = []
    const service = makeService()
    service.setEmailDeps({ enqueue: async (i) => { enqueued.push(i); return 'q1' } })
    await service.notifySignup({ ...HOTEL, phone: '612 345 678', country: 'ES' }, OWNER, '')
    expect(enqueued[0].html).toContain('wa.me/34612345678')
  })

  it('CFG-1: el texto de WhatsApp lleva el nombre de configuration(plataforma), no uno escrito en el código', async () => {
    const enqueued: any[] = []
    const service = makeService({ platformName: 'Hotelería Andina' })
    service.setEmailDeps({ enqueue: async (i) => { enqueued.push(i); return 'q1' } })
    await service.notifySignup(HOTEL, OWNER, '')
    const html: string = enqueued[0].html
    expect(html).toContain(encodeURIComponent('le escribo de Hotelería Andina'))
    expect(html).not.toContain(encodeURIComponent('SOLMI OS'))
    expect(html).not.toContain(encodeURIComponent('SolmiOS'))
  })

  it('sin configuration cableada el nombre cae al default del kit (SolmiOS), nunca vacío', async () => {
    const enqueued: any[] = []
    const service = makeService()
    service.setEmailDeps({ enqueue: async (i) => { enqueued.push(i); return 'q1' } })
    await service.notifySignup(HOTEL, OWNER, '')
    expect(enqueued[0].html).toContain(encodeURIComponent('le escribo de SolmiOS'))
  })

  it('sin plansRepo cableado escribe el id del plan, no revienta', async () => {
    const enqueued: any[] = []
    const service = makeService()
    service.setEmailDeps({ enqueue: async (i) => { enqueued.push(i); return 'q1' } })
    await service.notifySignup(HOTEL, OWNER, 'plan-x')
    expect(enqueued[0].html).toContain('plan-x')
  })

  it('best-effort: el sender que tira NO propaga (el alta ya devolvió 201)', async () => {
    const service = makeService()
    service.setEmailDeps({ enqueue: async () => { throw new Error('SMTP caído') } })
    await expect(service.notifySignup(HOTEL, OWNER, 'plan-starter')).resolves.toBeUndefined()
  })

  it('sin emailSender cableado no tira: avisa por log y sigue', async () => {
    const service = makeService()
    await expect(service.notifySignup(HOTEL, OWNER, 'plan-starter')).resolves.toBeUndefined()
  })
})
