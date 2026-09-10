// subscriptions/tests/signup-sales-alert-route.test.ts — REQ-PIPE-04 (#145) a nivel de RUTA REAL.
//
// Monta `subscriptions` y `sales-leads` de verdad (Router + HotelAuth reales, ORM en memoria con
// estado), los une con el connector `subscriptions-sales-alert` y pone el `EmailService` REAL
// encima de la misma memoria. Lo que se afirma: al terminar `POST /api/public/signup` ya existe
// la fila en `email_queue` con `relatedType='sales-pipeline:signup'`, `relatedId=<hotelId>` y el
// `wa.me` en E.164 dentro del html — encolado en la MISMA petición, no en un cron. Y con el
// encolador roto, el alta responde igual (201) y el hotel queda creado.
import { describe, it, expect } from 'bun:test'
import { Router, OrmRepository } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { SubscriptionsModule } from '../index'
import { SalesLeadsModule } from '../../sales-leads'
import { subscriptionsSalesAlertConnector } from '../../../connectors/subscriptions-sales-alert'
import { EmailService } from '../../../services/email-service'

/** ORM en memoria con estado por modelo: lo mínimo que usa OrmRepository. */
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

const PLAN = { id: 'plan-starter', name: 'Starter', slug: 'starter', price: 49, isActive: 1 }

/**
 * Levanta los dos módulos + connector sobre la misma memoria. `emailSender` decide qué recibe
 * `sales-leads.setEmailDeps`: por defecto el EmailService real (escribe en `EmailQueue`).
 */
function mount(opts: { emailSender?: { enqueue: (i: any) => Promise<string> } } = {}) {
  const router = new Router()
  const auth = makeAuth()
  const { orm, rows } = memOrm({ Plans: [PLAN] })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const logger = fakeLogger()

  const modules = new Map<string, any>()
  const subs = (SubscriptionsModule() as any).create({ logger, orm, cache, router, auth })
  const sales = (SalesLeadsModule() as any).create({ logger, orm, cache, router, auth })
  modules.set('subscriptions', subs)
  modules.set('sales-leads', sales)

  // Mismo cableado que hace composition-root: connector con resolveModule + email-bootstrap.
  subscriptionsSalesAlertConnector({ resolveModule: (name: string) => modules.get(name) } as any)
  const emailService = opts.emailSender ?? new EmailService(
    new OrmRepository(orm, 'Configuration'), new OrmRepository(orm, 'EmailQueue'), logger,
  )
  sales.setEmailDeps(emailService, 'https://hotel.zx89.site')

  return { router, rows }
}

const SIGNUP = {
  hotelName: 'Hotel Costa Azul',
  email: 'ana@costaazul.com',
  password: 'ClaveSegura2026',
  ownerName: 'Ana Pérez',
  phone: '809-555-0000',
  planId: 'plan-starter',
}

/** Cada test con su IP: el rate-limit del alta es por IP y vive en memoria del proceso. */
const ipHeaders = (ip: string) => ({ 'x-forwarded-for': ip })

describe('POST /api/public/signup — aviso inmediato a ventas (REQ-PIPE-04)', () => {
  it('al terminar el request ya hay fila en email_queue: relatedType sales-pipeline:signup, relatedId=hotelId, wa.me en E.164', async () => {
    const { router, rows } = mount()

    const res = await router.resolve('POST', '/api/public/signup', { body: SIGNUP, headers: ipHeaders('10.0.0.1') })
    expect(res.status).toBe(201)
    const hotelId = (res.body as any).data.hotelId
    expect(hotelId).toBeTruthy()

    // La fila existe ANTES de que el request termine: no depende de ningún cron.
    const alert = rows('EmailQueue').find((r) => r.relatedType === 'sales-pipeline:signup')
    expect(alert).toBeDefined()
    expect(alert.relatedId).toBe(hotelId)
    expect(alert.hotelId).toBe('platform')
    expect(alert.html).toContain('wa.me/18095550000')
    expect(alert.html).toContain('Hotel Costa Azul')
    expect(alert.html).toContain('Ana Pérez')
    expect(alert.html).toContain('Starter')
    expect(alert.html).toContain('https://hotel.zx89.site/admin/leads-ventas')
  })

  it('con el encolador roto (tira), el alta responde igual y el hotel queda creado', async () => {
    const { router, rows } = mount({ emailSender: { enqueue: async () => { throw new Error('cola caída') } } })

    const res = await router.resolve('POST', '/api/public/signup', {
      body: { ...SIGNUP, email: 'beto@costaazul.com' }, headers: ipHeaders('10.0.0.2'),
    })
    // 201 es lo que el alta devuelve hoy (`controller.signup`); lo que importa es que NO es 5xx.
    expect(res.status).toBe(201)
    const hotelId = (res.body as any).data.hotelId
    expect(rows('Hotels').find((h) => h.id === hotelId)).toBeDefined()
    expect(rows('Users').find((u) => u.hotelId === hotelId && u.role === 'hotel_admin')).toBeDefined()
    expect(rows('Subscriptions').find((s) => s.hotelId === hotelId && s.status === 'trialing')).toBeDefined()
    expect(rows('EmailQueue')).toHaveLength(0)
  })
})
