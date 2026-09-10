// billing-actions.test.ts — POST /api/admin/billing/invoices/:id/remind y /manual-payment
// (REQ-BIL-05, REQ-BIL-06, REQ-BIL-09).
//
// Las dos acciones eran, hasta BIL-3, un toast y un cambio en memoria. Lo que se verifica acá es
// que pasen de verdad: qué plantilla sale según el estado, que no salgan dos correos en 24 h, que
// el pago manual escriba la fila Y reactive la suscripción, y que las dos dejen audit log.
// Se monta el módulo `admin` REAL con un ORM en memoria; los puertos tardíos (correo, audit log,
// suscripciones) se inyectan por los mismos setters que usan el bootstrap y los connectors.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'

const HOUR = 3_600_000

function ormWith(tables: Record<string, any[]>): any {
  const store: Record<string, any[]> = JSON.parse(JSON.stringify(tables))
  const match = (row: any, filters: Record<string, unknown> = {}) =>
    Object.entries(filters).every(([k, v]) => row[k] === v)
  const orm: any = {
    define() { return orm },
    findMany: async (table: string, filters?: any) => (store[table] ?? []).filter((r) => match(r, filters)),
    findById: async (table: string, id: string) => (store[table] ?? []).find((r) => r.id === id) ?? null,
    findOne: async (table: string, filters?: any) => (store[table] ?? []).find((r) => match(r, filters)) ?? null,
    create: async (table: string, data: any) => { const row = { ...data }; store[table] = [...(store[table] ?? []), row]; return row },
    update: async (table: string, id: string, data: any) => {
      const row = (store[table] ?? []).find((r) => r.id === id)
      if (row) Object.assign(row, data)
      return row ?? null
    },
    delete: async () => true,
    count: async (table: string) => (store[table] ?? []).length,
    paginate: async (table: string) => ({ data: store[table] ?? [], total: (store[table] ?? []).length, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
    store,
  }
  return orm
}

const HOTELS = [{ id: 'h1', name: 'Hotel Sol', email: 'sol@hotel.com' }]

const invoice = (over: Record<string, any> = {}) => ({
  id: 'pi-1', hotelId: 'h1', subscriptionId: 'sub1', number: 'SOLM-0001',
  status: 'open', method: 'card', currency: 'USD', amountDue: 99, amountPaid: 0,
  planId: 'plan-pro', planName: 'Professional',
  issuedAt: '2026-09-01T10:00:00.000Z', dueAt: '2026-09-30T10:00:00.000Z',
  ...over,
})

const subscription = (over: Record<string, any> = {}) => ({
  id: 'sub1', hotelId: 'h1', planId: 'plan-pro', status: 'past_due', isRecurring: false,
  currentPeriodEnd: '2026-09-01T00:00:00.000Z', graceEndsAt: '2026-09-06T00:00:00.000Z',
  suspendedAt: '2026-09-11T00:00:00.000Z', suspendedReason: 'grace_period_expired',
  ...over,
})

/**
 * Monta el módulo y devuelve, además del router, lo que los tests necesitan mirar: los correos
 * que salieron, las entradas de auditoría y las llamadas al puerto de suscripciones.
 */
function mount(opts: { invoices?: any[]; subs?: any[]; sent?: boolean; wireEmail?: boolean; wireSubs?: boolean; activated?: boolean } = {}) {
  const router = new Router()
  const auth = makeAuth()
  const orm = ormWith({
    PlatformInvoices: opts.invoices ?? [invoice()],
    Hotels: HOTELS,
    Subscriptions: opts.subs ?? [subscription()],
    Plans: [{ id: 'plan-pro', name: 'Professional', price: 99 }],
  })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
  const service = (AdminModule() as any).create({ logger: fakeLogger(), orm, cache, router, auth })

  const emails: Array<{ event: string; to: string; hotelId: string; vars: Record<string, string> }> = []
  const audits: any[] = []
  const activations: Array<{ hotelId: string; periodEnd: string }> = []

  service.setAuditDeps({ record: async (entry: any) => { audits.push(entry) } })
  if (opts.wireEmail !== false) {
    service.setPlatformEmailSender(async (event: string, to: string, hotelId: string, vars: Record<string, string>) => {
      emails.push({ event, to, hotelId, vars })
      return { sent: opts.sent ?? true }
    })
  }
  if (opts.wireSubs !== false) {
    service.setBillingSubscriptionDeps({
      activateAfterManualPayment: async (hotelId: string, periodEnd: string) => {
        activations.push({ hotelId, periodEnd })
        const sub = orm.store.Subscriptions.find((s: any) => s.hotelId === hotelId)
        if (!sub || opts.activated === false) return { activated: false }
        Object.assign(sub, { status: 'active', currentPeriodEnd: periodEnd, graceEndsAt: null, suspendedAt: null, suspendedReason: null })
        return { activated: true, previousStatus: 'past_due' }
      },
    })
  }

  const headers = { authorization: `Bearer ${auth.createToken({ id: 'user-super_admin', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
  const merchant = { authorization: `Bearer ${auth.createToken({ id: 'user-hotel_admin', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}` }
  const post = (path: string, body?: any, h = headers) => router.resolve('POST', path, { headers: h, body, query: {} })
  return { router, orm, post, headers, merchant, emails, audits, activations }
}

describe('POST /api/admin/billing/invoices/:id/remind — REQ-BIL-05', () => {
  it('`open` sin tarjeta usa la plantilla de renovación MANUAL, con monto, plan y link', async () => {
    const { post, emails } = mount()
    const res = await post('/api/admin/billing/invoices/pi-1/remind')

    expect(res.status).toBe(200)
    expect((res.body as any).template).toBe('subscription_renewal_manual')
    expect(emails).toHaveLength(1)
    expect(emails[0]!.to).toBe('sol@hotel.com')
    expect(emails[0]!.vars).toMatchObject({ hotel_name: 'Hotel Sol', plan_name: 'Professional', amount: 'USD 99' })
    // `days_left` es la variable que REALMENTE renderizan las plantillas de renovación: sin ella
    // el correo sale con "{days_left}" literal.
    expect(Number(emails[0]!.vars.days_left)).toBeGreaterThanOrEqual(0)
    expect(emails[0]!.vars.link).toContain('/panel/suscripcion')
  })

  it('`open` CON tarjeta usa la plantilla automática (decirle "pagá vos" a quien tiene débito automático confunde)', async () => {
    const { post, emails } = mount({ subs: [subscription({ isRecurring: true })] })
    const res = await post('/api/admin/billing/invoices/pi-1/remind')
    expect((res.body as any).template).toBe('subscription_renewal_auto')
    expect(emails[0]!.event).toBe('subscription_renewal_auto')
  })

  it('`failed` usa `payment_failed`', async () => {
    const { post, emails } = mount({ invoices: [invoice({ status: 'failed' })] })
    const res = await post('/api/admin/billing/invoices/pi-1/remind')
    expect((res.body as any).template).toBe('payment_failed')
    expect(emails[0]!.event).toBe('payment_failed')
  })

  it('una factura PAGADA no se recuerda → 409 y no manda nada', async () => {
    const { post, emails } = mount({ invoices: [invoice({ status: 'paid', amountPaid: 99 })] })
    const res = await post('/api/admin/billing/invoices/pi-1/remind')
    expect(res.status).toBe(409)
    expect(emails).toHaveLength(0)
  })

  it('una anulada tampoco → 409', async () => {
    const { post } = mount({ invoices: [invoice({ status: 'void' })] })
    expect((await post('/api/admin/billing/invoices/pi-1/remind')).status).toBe(409)
  })

  it('segundo recordatorio a las 2 h → 409 con la hora del primero, y NO manda el correo', async () => {
    const dosHorasAtras = new Date(Date.now() - 2 * HOUR).toISOString()
    const { post, emails } = mount({ invoices: [invoice({ lastReminderAt: dosHorasAtras })] })

    const res = await post('/api/admin/billing/invoices/pi-1/remind')

    expect(res.status).toBe(409)
    expect(emails).toHaveLength(0)
    const hora = `${String(new Date(dosHorasAtras).getHours()).padStart(2, '0')}:${String(new Date(dosHorasAtras).getMinutes()).padStart(2, '0')}`
    expect((res.body as any).error).toContain(hora)
  })

  it('pasadas las 24 h sí se puede volver a recordar', async () => {
    const ayer = new Date(Date.now() - 25 * HOUR).toISOString()
    const { post, emails } = mount({ invoices: [invoice({ lastReminderAt: ayer })] })
    expect((await post('/api/admin/billing/invoices/pi-1/remind')).status).toBe(200)
    expect(emails).toHaveLength(1)
  })

  it('deja `lastReminderAt` y una entrada de auditoría con el usuario', async () => {
    const { post, orm, audits } = mount()
    const res = await post('/api/admin/billing/invoices/pi-1/remind')

    expect(orm.store.PlatformInvoices[0].lastReminderAt).toBe((res.body as any).sentAt)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'platform_invoice.remind', entity: 'platform_invoice', entityId: 'pi-1', userId: 'user-super_admin', hotelId: 'h1' })
    expect(audits[0].detail).toContain('subscription_renewal_manual')
  })

  it('si la plantilla está desactivada NO se marca el envío: el admin no queda bloqueado 24 h por un correo que no salió', async () => {
    const { post, orm } = mount({ sent: false })
    const res = await post('/api/admin/billing/invoices/pi-1/remind')
    expect(res.status).toBe(400)
    expect(orm.store.PlatformInvoices[0].lastReminderAt).toBeUndefined()
  })

  it('sin el envío de correos cableado → 503, no un 200 que no mandó nada', async () => {
    const { post } = mount({ wireEmail: false })
    expect((await post('/api/admin/billing/invoices/pi-1/remind')).status).toBe(503)
  })

  it('factura inexistente → 404 · merchant → 403', async () => {
    const { post, merchant } = mount()
    expect((await post('/api/admin/billing/invoices/nope/remind')).status).toBe(404)
    expect((await post('/api/admin/billing/invoices/pi-1/remind', undefined, merchant)).status).toBe(403)
  })
})

describe('POST /api/admin/billing/manual-payment — REQ-BIL-06', () => {
  const body = (over: Record<string, any> = {}) => ({
    hotelId: 'h1', amount: 49, currency: 'USD',
    paidAt: new Date(Date.now() - HOUR).toISOString(),
    reference: 'TRF-1234',
    periodEnd: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
    ...over,
  })

  it('caso feliz: fila manual/paid, suscripción `active` con el período nuevo y audit con el usuario', async () => {
    const { post, orm, audits, activations } = mount({ invoices: [] })
    const input = body()
    const res = await post('/api/admin/billing/manual-payment', input)

    expect(res.status).toBe(201)
    expect(orm.store.PlatformInvoices).toHaveLength(1)
    const row = orm.store.PlatformInvoices[0]
    expect(row).toMatchObject({
      hotelId: 'h1', status: 'paid', method: 'manual', currency: 'USD',
      amountDue: 49, amountPaid: 49, reference: 'TRF-1234', recordedByUserId: 'user-super_admin',
    })
    // Sin `stripeInvoiceId`: si guardara '' el UNIQUE INDEX chocaría con el segundo pago manual.
    expect(row.stripeInvoiceId).toBeUndefined()

    expect(activations).toEqual([{ hotelId: 'h1', periodEnd: input.periodEnd }])
    expect(orm.store.Subscriptions[0]).toMatchObject({
      status: 'active', currentPeriodEnd: input.periodEnd,
      graceEndsAt: null, suspendedAt: null, suspendedReason: null,
    })
    expect((res.body as any).subscriptionActivated).toBe(true)
    expect((res.body as any).invoice).toMatchObject({ method: 'manual', status: 'paid', hotelName: 'Hotel Sol' })

    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'platform_invoice.manual_payment', userId: 'user-super_admin', hotelId: 'h1' })
    expect(audits[0].detail).toContain('TRF-1234')
  })

  it('con `invoiceId` de una pendiente: la marca PAGADA en vez de crear otra', async () => {
    const { post, orm } = mount({ invoices: [invoice()] })
    const res = await post('/api/admin/billing/manual-payment', body({ invoiceId: 'pi-1', amount: 99 }))

    expect(res.status).toBe(201)
    expect(orm.store.PlatformInvoices).toHaveLength(1)
    expect(orm.store.PlatformInvoices[0]).toMatchObject({
      id: 'pi-1', status: 'paid', method: 'manual', amountPaid: 99, reference: 'TRF-1234',
      number: 'SOLM-0001', // sigue siendo la MISMA factura: conserva su número
      amountDue: 99,
    })
  })

  it('con `invoiceId` de una factura ya pagada → 409', async () => {
    const { post } = mount({ invoices: [invoice({ status: 'paid', amountPaid: 99 })] })
    expect((await post('/api/admin/billing/manual-payment', body({ invoiceId: 'pi-1' }))).status).toBe(409)
  })

  it('con `invoiceId` de OTRO hotel → 400 (no se cierra la factura ajena por un id mal copiado)', async () => {
    const { post } = mount({ invoices: [invoice({ hotelId: 'h2' })] })
    expect((await post('/api/admin/billing/manual-payment', body({ invoiceId: 'pi-1' }))).status).toBe(400)
  })

  it('monto 0 → 400 · sin referencia → 400 · fecha de pago futura → 400', async () => {
    const { post, orm } = mount({ invoices: [] })
    expect((await post('/api/admin/billing/manual-payment', body({ amount: 0 }))).status).toBe(400)
    const sinRef = { ...body() } as any
    delete sinRef.reference
    expect((await post('/api/admin/billing/manual-payment', sinRef)).status).toBe(400)
    const futuro = await post('/api/admin/billing/manual-payment', body({ paidAt: new Date(Date.now() + 48 * HOUR).toISOString() }))
    expect(futuro.status).toBe(400)
    expect((futuro.body as any).error).toContain('futura')
    // Ninguno de los tres escribió nada.
    expect(orm.store.PlatformInvoices).toHaveLength(0)
  })

  it('hotel inexistente → 404', async () => {
    const { post } = mount({ invoices: [] })
    expect((await post('/api/admin/billing/manual-payment', body({ hotelId: 'h-fantasma' }))).status).toBe(404)
  })

  it('si la suscripción no se puede activar, el pago IGUAL queda registrado y la respuesta lo dice', async () => {
    const { post, orm } = mount({ invoices: [], activated: false })
    const res = await post('/api/admin/billing/manual-payment', body())

    expect(res.status).toBe(201)
    expect(orm.store.PlatformInvoices).toHaveLength(1) // la plata entró: eso no se pierde
    expect((res.body as any).subscriptionActivated).toBe(false)
    expect((res.body as any).warning).toContain('registrado')
  })

  it('merchant → 403', async () => {
    const { post, merchant } = mount({ invoices: [] })
    expect((await post('/api/admin/billing/manual-payment', body(), merchant)).status).toBe(403)
  })
})
