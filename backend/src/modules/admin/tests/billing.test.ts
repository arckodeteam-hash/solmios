// billing.test.ts — /api/admin/billing/* (REQ-BIL-04, REQ-BIL-09).
//
// Monta el módulo `admin` REAL sobre un Router y un HotelAuth reales (mismo criterio que
// modules-catalog.test.ts) pero con un ORM en memoria CON DATOS: lo que se verifica no es que
// el handler exista, sino que el filtro, la paginación, la cuenta de las stats y el CSV salgan
// bien de punta a punta, pasando por el guard de plataforma.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { AdminModule } from '../index'

const NOW = new Date()
const ISO = (d: Date) => d.toISOString()
const daysFromNow = (n: number) => ISO(new Date(NOW.getTime() + n * 86_400_000))

/** ORM en memoria con las 4 tablas que toca la facturación. Igualdad estricta, como `buildWhere`. */
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

const HOTELS = [
  { id: 'h1', name: 'Hotel Sol', email: 'sol@hotel.com', plan: 'professional' },
  { id: 'h2', name: 'Posada Luna', email: 'luna@hotel.com', plan: 'starter' },
]
const PLANS = [
  { id: 'plan-pro', name: 'Professional', price: 99, slug: 'professional', isActive: true },
  { id: 'plan-start', name: 'Starter', price: 49, slug: 'starter', isActive: true },
]
const SUBS = [
  { id: 'sub1', hotelId: 'h1', planId: 'plan-pro', status: 'active', isRecurring: true, currentPeriodEnd: daysFromNow(20) },
  { id: 'sub2', hotelId: 'h2', planId: 'plan-start', status: 'past_due', isRecurring: false, currentPeriodEnd: daysFromNow(-5) },
]

/**
 * El escenario del spec (REQ-BIL-04): 2 pagadas (49 y 99), 1 pendiente VENCIDA de 49 y 1 fallida
 * de 99 → collected 148, open 49, overdue 49, failed 99, tasa 50.
 */
const INVOICES = [
  {
    id: 'pi-1', hotelId: 'h1', subscriptionId: 'sub1', stripeInvoiceId: 'in_1', number: 'SOLM-0001',
    status: 'paid', method: 'card', currency: 'USD', amountDue: 99, amountPaid: 99,
    planId: 'plan-pro', planName: 'Professional', issuedAt: '2026-08-01T10:00:00.000Z',
    dueAt: '2026-08-08T10:00:00.000Z', paidAt: '2026-08-01T10:05:00.000Z',
    periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/in_1', invoicePdfUrl: 'https://pay.stripe.com/invoice/in_1/pdf',
  },
  {
    id: 'pi-2', hotelId: 'h2', subscriptionId: 'sub2', stripeInvoiceId: null, number: '',
    status: 'paid', method: 'manual', currency: 'USD', amountDue: 49, amountPaid: 49,
    planId: 'plan-start', planName: 'Starter', issuedAt: '2026-07-15T10:00:00.000Z',
    reference: 'TRF-1234', paidAt: '2026-07-15T10:00:00.000Z', recordedByUserId: 'user-super_admin',
  },
  {
    id: 'pi-3', hotelId: 'h2', subscriptionId: 'sub2', stripeInvoiceId: 'in_3', number: 'SOLM-0003',
    status: 'open', method: 'card', currency: 'USD', amountDue: 49, amountPaid: 0,
    planId: 'plan-start', planName: 'Starter', issuedAt: '2026-09-01T10:00:00.000Z',
    dueAt: daysFromNow(-3), // vencida
  },
  {
    id: 'pi-4', hotelId: 'h1', subscriptionId: 'sub1', stripeInvoiceId: 'in_4', number: 'SOLM-0004',
    status: 'failed', method: 'card', currency: 'USD', amountDue: 99, amountPaid: 0,
    planId: 'plan-pro', planName: 'Professional', issuedAt: '2026-09-05T10:00:00.000Z',
    dueAt: daysFromNow(5),
  },
]

function mount(invoices: any[] = INVOICES) {
  const router = new Router()
  const auth = makeAuth()
  const orm = ormWith({ PlatformInvoices: invoices, Hotels: HOTELS, Subscriptions: SUBS, Plans: PLANS })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
  // `as any` igual que `mountModule` del helper: acá se inyectan solo los deps que el módulo usa,
  // no el `ModuleDependencies` completo del framework.
  ;(AdminModule() as any).create({ logger: fakeLogger(), orm, cache, router, auth })
  const headers = { authorization: `Bearer ${auth.createToken({ id: 'user-super_admin', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
  const merchant = { authorization: `Bearer ${auth.createToken({ id: 'user-hotel_admin', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}` }
  return { router, orm, headers, merchant }
}

/** `router.resolve` NO parsea el query string del path (`extras.query`), así que se separa acá. */
const get = (router: Router, url: string, headers?: Record<string, string>) => {
  const [path, qs] = url.split('?')
  const query = Object.fromEntries(new URLSearchParams(qs ?? '')) as Record<string, string>
  return router.resolve('GET', path!, { ...(headers ? { headers } : {}), query })
}

describe('GET /api/admin/billing/* — guard de plataforma (REQ-BIL-09)', () => {
  const { router, merchant } = mount()

  // Mapeo del framework: ForbiddenError (rol) → 403; AuthError (sin token / userType) → 401.
  it('un merchant autenticado NO entra a ninguna de las 4 rutas', async () => {
    for (const path of ['/api/admin/billing/invoices', '/api/admin/billing/stats', '/api/admin/billing/export.csv', '/api/admin/billing/invoices/pi-1']) {
      const res = await get(router, path, merchant)
      expect(res.status).toBe(403)
    }
  })

  it('sin token → 401', async () => {
    expect((await get(router, '/api/admin/billing/invoices')).status).toBe(401)
  })
})

describe('GET /api/admin/billing/invoices — listado, filtros y paginación', () => {
  it('devuelve {data,total,page,limit} ordenado por emisión descendente con el hotel resuelto', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices', headers)

    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.total).toBe(4)
    expect(body.page).toBe(1)
    expect(body.limit).toBe(20)
    expect(body.data.map((r: any) => r.id)).toEqual(['pi-4', 'pi-3', 'pi-1', 'pi-2'])
    expect(body.data[0].hotelName).toBe('Hotel Sol')
    expect(body.data[0].planName).toBe('Professional')
    // La vencida viene marcada: la UI no tiene que recalcular la fecha.
    expect(body.data.find((r: any) => r.id === 'pi-3').overdue).toBe(true)
    expect(body.data.find((r: any) => r.id === 'pi-4').overdue).toBe(false)
  })

  it('filtra por estado', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices?status=paid', headers)
    expect((res.body as any).total).toBe(2)
    expect((res.body as any).data.every((r: any) => r.status === 'paid')).toBe(true)
  })

  it('filtra por plan', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices?planId=plan-start', headers)
    expect((res.body as any).data.map((r: any) => r.id)).toEqual(['pi-3', 'pi-2'])
  })

  it('filtra por rango de emisión (ambas puntas inclusive)', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices?from=2026-08-01&to=2026-09-01', headers)
    expect((res.body as any).data.map((r: any) => r.id)).toEqual(['pi-3', 'pi-1'])
  })

  it('`q` busca por número, por nombre de hotel y por referencia', async () => {
    const { router, headers } = mount()
    const porNumero = await get(router, '/api/admin/billing/invoices?q=SOLM-0003', headers)
    expect((porNumero.body as any).data.map((r: any) => r.id)).toEqual(['pi-3'])

    const porHotel = await get(router, '/api/admin/billing/invoices?q=posada', headers)
    expect((porHotel.body as any).data.map((r: any) => r.id)).toEqual(['pi-3', 'pi-2'])

    const porReferencia = await get(router, '/api/admin/billing/invoices?q=TRF-1234', headers)
    expect((porReferencia.body as any).data.map((r: any) => r.id)).toEqual(['pi-2'])
  })

  it('pagina: `total` es el set filtrado completo, `data` solo la página pedida', async () => {
    const { router, headers } = mount()
    const p1 = await get(router, '/api/admin/billing/invoices?page=1&limit=2', headers)
    const p2 = await get(router, '/api/admin/billing/invoices?page=2&limit=2', headers)

    expect((p1.body as any).total).toBe(4)
    expect((p1.body as any).data.map((r: any) => r.id)).toEqual(['pi-4', 'pi-3'])
    expect((p2.body as any).data.map((r: any) => r.id)).toEqual(['pi-1', 'pi-2'])
  })

  it('sin facturas devuelve la lista vacía, no un error', async () => {
    const { router, headers } = mount([])
    const res = await get(router, '/api/admin/billing/invoices', headers)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ data: [], total: 0 })
  })
})

describe('GET /api/admin/billing/invoices/:id — detalle', () => {
  it('trae la factura con los datos del hotel y de su suscripción', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices/pi-1', headers)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: 'pi-1', number: 'SOLM-0001', hotelName: 'Hotel Sol', hotelEmail: 'sol@hotel.com',
      planName: 'Professional', status: 'paid', method: 'card', amountDue: 99, amountPaid: 99,
      subscriptionStatus: 'active', isRecurring: true,
      invoicePdfUrl: 'https://pay.stripe.com/invoice/in_1/pdf',
    })
    expect((res.body as any).currentPeriodEnd).toBe(SUBS[0]!.currentPeriodEnd)
    expect((res.body as any).issuedAt).toBe('2026-08-01T10:00:00.000Z')
  })

  it('la manual trae la referencia y `isRecurring` de su suscripción (false: paga a mano)', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices/pi-2', headers)
    expect(res.body).toMatchObject({ method: 'manual', reference: 'TRF-1234', isRecurring: false, subscriptionStatus: 'past_due' })
  })

  it('id que no existe → 404', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/invoices/pi-inexistente', headers)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/admin/billing/stats — el escenario del spec', () => {
  it('2 pagadas (49+99), 1 pendiente vencida (49) y 1 fallida (99) → 148 / 49 / 49 / 99 / 50%', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/stats', headers)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ collected: 148, open: 49, overdue: 49, failed: 99, collectionRate: 50 })
  })

  it('`mrr` sale de las suscripciones `active` (la misma cuenta que /admin/subscriptions), no de las facturas', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/stats', headers)
    // sub1 (h1) está `active` con plan-pro (99); sub2 está `past_due` y no suma.
    expect((res.body as any).mrr).toBe(99)
  })

  it('respeta el rango de fechas', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/stats?from=2026-09-01', headers)
    // Solo pi-3 (open 49) y pi-4 (failed 99) caen en septiembre.
    expect(res.body).toMatchObject({ collected: 0, open: 49, failed: 99, collectionRate: 0 })
  })

  it('sin facturas no divide por cero', async () => {
    const { router, headers } = mount([])
    const res = await get(router, '/api/admin/billing/stats', headers)
    expect(res.body).toMatchObject({ collected: 0, open: 0, overdue: 0, failed: 0, collectionRate: 0 })
  })
})

describe('GET /api/admin/billing/export.csv', () => {
  it('devuelve text/csv con BOM, separador `;`, encabezados y una fila por factura filtrada', async () => {
    const { router, headers } = mount()
    const res = await get(router, '/api/admin/billing/export.csv?status=paid', headers)

    expect(res.status).toBe(200)
    expect(String((res.headers as any)['Content-Type'])).toContain('text/csv')
    expect(String((res.headers as any)['Content-Disposition'])).toContain('.csv')
    // Buffer, NO string: un body no-Buffer lo envuelve el framework en el envelope JSON.
    expect(Buffer.isBuffer(res.body)).toBe(true)

    const csv = (res.body as Buffer).toString('utf-8')
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('Número;Hotel;Plan;Estado;Método;Moneda;Monto;Pagado;Emisión;Vencimiento;Fecha de pago;Referencia;Período')
    expect(lines).toHaveLength(3) // encabezado + las 2 pagadas

    const pro = lines.find((l) => l.includes('Hotel Sol'))!
    expect(pro.split(';')).toEqual([
      'SOLM-0001', 'Hotel Sol', 'Professional', 'Pagada', 'Tarjeta', 'USD', '99', '99',
      '2026-08-01', '2026-08-08', '2026-08-01', '', '2026-08-01 → 2026-09-01',
    ])
    // La manual no tiene número de Stripe: se identifica por su referencia.
    expect(lines.find((l) => l.includes('Posada Luna'))).toContain('Manual · TRF-1234')
  })

  it('una celda que empieza con `=` se neutraliza (inyección de fórmula en Excel)', async () => {
    const { router, headers } = mount([{ ...INVOICES[0], id: 'pi-x', hotelId: 'h3', number: '=1+1' }])
    const res = await get(router, '/api/admin/billing/export.csv', headers)
    const csv = (res.body as Buffer).toString('utf-8')
    expect(csv).toContain("'=1+1")
  })
})
