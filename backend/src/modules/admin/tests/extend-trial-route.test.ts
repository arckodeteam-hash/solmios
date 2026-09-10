// admin/tests/extend-trial-route.test.ts — REQ-PIPE-05 (#146) a nivel de RUTA REAL.
//
// Monta `admin`, `subscriptions`, `auditlog` y `platform-emails` de verdad (Router + HotelAuth
// reales, ORM en memoria con estado), los une con los connectors `admin-subscriptions-trial` y
// `admin-auditlog`, y pone el `EmailService` REAL encima de la misma memoria — el mismo cableado
// que hace composition-root + email-bootstrap. Lo que se afirma: tras
// `POST /api/admin/subscriptions/:hotelId/extend-trial {days:7}` sobre un trial vencido hace 5
// días, la fila queda `trialing` con `trialEndsAt = now+7d`, los dos dedup del cron en null, hay
// fila en `audit_log` y en `email_queue` con `relatedType='platform_email:trial_extended'`.
// `days:31`/`days:0` → 400, `merchant` → 403.
import { describe, it, expect } from 'bun:test'
import { Router, OrmRepository } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'
import { SubscriptionsModule } from '../../subscriptions'
import { AuditlogModule } from '../../auditlog'
import { PlatformEmailsModule } from '../../platform-emails'
import { adminSubscriptionsTrialConnector } from '../../../connectors/admin-subscriptions-trial'
import { adminAuditlogConnector } from '../../../connectors/admin-auditlog'
import { EmailService } from '../../../services/email-service'

const DAY = 24 * 60 * 60 * 1000
const MINUTE = 60 * 1000

/** ORM en memoria con estado por modelo (mismo que subscriptions/tests/signup-sales-alert-route.test.ts). */
function memOrm(seed: Record<string, any[]> = {}) {
  const tables = new Map<string, any[]>()
  const rows = (m: string) => { if (!tables.has(m)) tables.set(m, []); return tables.get(m)! }
  for (const [m, list] of Object.entries(seed)) tables.set(m, list.map((r) => ({ ...r })))
  const match = (r: any, f: Record<string, unknown> = {}) => Object.entries(f).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    async findMany(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)) },
    async findOne(m: string, f: any) { return rows(m).find((r) => match(r, f)) ?? null },
    async findById(m: string, id: string) { return rows(m).find((r) => r.id === id) ?? null },
    async create(m: string, data: any) {
      const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data }
      rows(m).push(row)
      return row
    },
    async update(m: string, id: string, data: any) {
      const list = rows(m)
      const i = list.findIndex((r) => r.id === id)
      if (i < 0) return null
      list[i] = { ...list[i], ...data, updatedAt: new Date().toISOString() }
      return list[i]
    },
    async delete(m: string, id: string) { const list = rows(m); const i = list.findIndex((r) => r.id === id); if (i >= 0) list.splice(i, 1); return i >= 0 },
    async count(m: string, f: any = {}) { return rows(m).filter((r) => match(r, f)).length },
    async paginate(m: string) { return { data: rows(m), total: rows(m).length, limit: 20, offset: 0 } },
    transaction: async (fn: any) => fn(orm),
  }
  return { orm, rows }
}

const HOTEL = { id: 'h1', name: 'Hotel Sol', email: 'dueno@hotelsol.com', plan: 'starter' }
const TEMPLATE = {
  id: 'tpl-ext', event: 'trial_extended', isActive: true,
  subject: 'Extendimos su prueba en {platform_name}: {days_left} días más',
  body: '<p>{hotel_name}: {days_left} días más en {platform_name}. {link}</p>',
  variables: '["hotel_name","days_left","platform_name","link"]',
}

function expiredSub(now: Date) {
  return {
    id: 'sub1', hotelId: 'h1', planId: 'plan-starter', status: 'trialing',
    trialEndsAt: new Date(now.getTime() - 5 * DAY).toISOString(),
    trialReminderSentAt: '2026-09-03T10:00:00.000Z',
    trialExpiredEmailSentAt: '2026-09-06T10:00:00.000Z',
  }
}

function mount(now = new Date(), subOverride: Record<string, unknown> = {}) {
  const router = new Router()
  const auth = makeAuth()
  const { orm, rows } = memOrm({
    Hotels: [HOTEL],
    Subscriptions: [{ ...expiredSub(now), ...subOverride }],
    PlatformEmailTemplate: [TEMPLATE],
    Configuration: [{ id: 'cfg-1', hotelId: 'platform', key: 'plataforma', value: JSON.stringify({ platformName: 'SOLMI OS' }) }],
  })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const logger = fakeLogger()

  const modules = new Map<string, any>()
  modules.set('admin', (AdminModule() as any).create({ logger, orm, cache, router, auth }))
  modules.set('subscriptions', (SubscriptionsModule() as any).create({ logger, orm, cache, router, auth }))
  modules.set('auditlog', (AuditlogModule() as any).create({ logger, orm, cache, router, auth }))
  modules.set('platform-emails', (PlatformEmailsModule() as any).create({ logger, orm, cache, router, auth }))
  const ctx = { resolveModule: (name: string) => modules.get(name) } as any

  adminSubscriptionsTrialConnector(ctx)
  adminAuditlogConnector(ctx)

  // Mismo cableado que email-bootstrap: EmailService real sobre la memoria + sendEvent de platform-emails.
  const emailService = new EmailService(new OrmRepository(orm, 'Configuration'), new OrmRepository(orm, 'EmailQueue'), logger)
  modules.get('platform-emails').setEmailDeps(emailService)
  process.env.PUBLIC_URL = 'https://hotel.zx89.site'
  modules.get('subscriptions').setPlatformEmailSender((event: string, to: string, hotelId: string, vars: Record<string, string>) =>
    modules.get('platform-emails').sendEvent(event, to, hotelId, vars))

  const superAdmin = { authorization: `Bearer ${auth.createToken({ id: 'sa-1', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
  const merchant = { authorization: `Bearer ${auth.createToken({ id: 'u-1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}` }
  return { router, rows, superAdmin, merchant }
}

const URL = '/api/admin/subscriptions/h1/extend-trial'

describe('POST /api/admin/subscriptions/:hotelId/extend-trial — REQ-PIPE-05 (#146)', () => {
  it('vencido hace 5 días + 7 → trialing, trialEndsAt=now+7d (±1 min), dedup en null, audit_log y email_queue', async () => {
    const now = new Date()
    const { router, rows, superAdmin } = mount(now)

    const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: superAdmin })
    expect(res.status).toBe(200)
    const body = (res.body as any).data ?? res.body
    expect(body.daysLeft).toBe(7)
    expect(body.emailSent).toBe(true)

    const sub = rows('Subscriptions').find((s) => s.hotelId === 'h1')
    expect(sub.status).toBe('trialing')
    expect(Math.abs(new Date(sub.trialEndsAt).getTime() - (now.getTime() + 7 * DAY))).toBeLessThanOrEqual(MINUTE)
    expect(sub.trialReminderSentAt).toBeNull()
    expect(sub.trialExpiredEmailSentAt).toBeNull()

    const audit = rows('Auditlog').find((a) => a.action === 'subscription.extend_trial')
    expect(audit).toBeDefined()
    expect(audit.hotelId).toBe('h1')
    expect(audit.userId).toBe('sa-1')
    expect(audit.detail).toContain('7 días')

    const mail = rows('EmailQueue').find((m) => m.relatedType === 'platform_email:trial_extended')
    expect(mail).toBeDefined()
    expect(mail.recipient).toBe('dueno@hotelsol.com')
    expect(mail.hotelId).toBe('h1')
    expect(mail.subject).toBe('Extendimos su prueba en SOLMI OS: 7 días más')
    expect(mail.html).toContain('Hotel Sol: 7 días más en SOLMI OS. https://hotel.zx89.site/panel/suscripcion')
    expect(mail.html).not.toContain('{platform_name}')
  })

  it('days: 31 → 400 y no toca la fila', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { days: 31 }, headers: superAdmin })
    expect(res.status).toBe(400)
    expect(rows('Subscriptions')[0]!.trialReminderSentAt).toBe('2026-09-03T10:00:00.000Z')
    expect(rows('EmailQueue')).toHaveLength(0)
  })

  it('days: 0 → 400', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { days: 0 }, headers: superAdmin })
    expect(res.status).toBe(400)
  })

  it('sin days → 400', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: {}, headers: superAdmin })
    expect(res.status).toBe(400)
  })

  it('merchant (hotel_admin del propio hotel) → 403', async () => {
    const { router, rows, merchant } = mount()
    const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: merchant })
    expect(res.status).toBe(403)
    expect(rows('Subscriptions')[0]!.status).toBe('trialing')
    expect(rows('Auditlog')).toHaveLength(0)
  })

  it('hotel sin suscripción → 404', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('POST', '/api/admin/subscriptions/h-nope/extend-trial', { body: { days: 7 }, headers: superAdmin })
    expect(res.status).toBe(404)
  })

  // COR-1/SEC-1: extender solo aplica a una PRUEBA. Una sub `active` con Stripe no puede volver a
  // `trialing` (access.ts la bloquearía al vencer; create-checkout-session dejaría de verla viva).
  describe('solo pruebas: cualquier otro estado → 409 sin tocar la fila', () => {
    it('active con stripeSubscriptionId → 409, status sigue active, sin audit ni correo', async () => {
      const { router, rows, superAdmin } = mount(new Date(), {
        status: 'active', stripeSubscriptionId: 'sub_stripe_1', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 20 * DAY).toISOString(),
      })
      const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: superAdmin })
      expect(res.status).toBe(409)
      expect(String((res.body as any).error)).toMatch(/reactivar|condiciones especiales/)
      const sub = rows('Subscriptions')[0]!
      expect(sub.status).toBe('active')
      expect(sub.stripeSubscriptionId).toBe('sub_stripe_1')
      expect(sub.trialEndsAt).toBeNull()
      expect(sub.trialReminderSentAt).toBe('2026-09-03T10:00:00.000Z')
      expect(rows('Auditlog')).toHaveLength(0)
      expect(rows('EmailQueue')).toHaveLength(0)
    })

    it('suspended → 409', async () => {
      const { router, rows, superAdmin } = mount(new Date(), { status: 'suspended' })
      const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: superAdmin })
      expect(res.status).toBe(409)
      expect(rows('Subscriptions')[0]!.status).toBe('suspended')
    })

    it('canceled → 409', async () => {
      const { router, rows, superAdmin } = mount(new Date(), { status: 'canceled' })
      const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: superAdmin })
      expect(res.status).toBe(409)
      expect(rows('Subscriptions')[0]!.status).toBe('canceled')
    })

    it('expired (marcado por access.ts, sin Stripe) → 200 y vuelve a trialing', async () => {
      const now = new Date()
      const { router, rows, superAdmin } = mount(now, { status: 'expired' })
      const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: superAdmin })
      expect(res.status).toBe(200)
      const sub = rows('Subscriptions')[0]!
      expect(sub.status).toBe('trialing')
      expect(Math.abs(new Date(sub.trialEndsAt).getTime() - (now.getTime() + 7 * DAY))).toBeLessThanOrEqual(MINUTE)
    })
  })

  // SEC-2: `days:"7"` (string) se coercionaba a número. El contrato es un entero JSON.
  it('days: "7" (string) → 400 y no toca la fila', async () => {
    const { router, rows, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { days: '7' }, headers: superAdmin })
    expect(res.status).toBe(400)
    expect(rows('Subscriptions')[0]!.trialReminderSentAt).toBe('2026-09-03T10:00:00.000Z')
  })

  it('days: 7.5 → 400', async () => {
    const { router, superAdmin } = mount()
    const res = await router.resolve('POST', URL, { body: { days: 7.5 }, headers: superAdmin })
    expect(res.status).toBe(400)
  })

  // El "sin connector" se mapea por TIPO de error (TrialPortUnavailableError), no por regex del mensaje.
  it('sin connector cableado → 503', async () => {
    const router = new Router()
    const auth = makeAuth()
    const { orm } = memOrm({ Hotels: [HOTEL], Subscriptions: [expiredSub(new Date())] })
    const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
    ;(AdminModule() as any).create({ logger: fakeLogger(), orm, cache, router, auth })
    const superAdmin = { authorization: `Bearer ${auth.createToken({ id: 'sa-1', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
    const res = await router.resolve('POST', URL, { body: { days: 7 }, headers: superAdmin })
    expect(res.status).toBe(503)
  })
})
