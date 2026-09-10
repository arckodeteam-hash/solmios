// messages-route.test.ts — POST /api/tickets/:id/messages a nivel de RUTA REAL (REQ-SOP-02/03).
// Mismo patrón que plan-gate.test.ts: módulo real montado sobre Router/HotelAuth reales con un
// ORM fake con datos, para probar los guards (permiso + módulo + denyImpersonation) de punta a
// punta, sin necesitar una DB real.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { TicketsModule } from '../index'
import type { HotelAuth } from '../../../infrastructure/auth/hotel-auth'

const ESSENTIAL_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests', 'settings.rooms', 'channel', 'finance.billing', 'finance.payments', 'operations.maintenance', 'site-pages', 'settings.rates', 'settings.audit']

/** ORM fake con una tabla Tickets mutable por id — necesario para el findById dentro del handler. */
function mount() {
  const ticketsById = new Map<string, any>([
    ['t1', { id: 't1', hotelId: 'h1', userId: 'u1', subject: 'Issue', status: 'open', messages: [] }],
  ])
  const rows: Record<string, any[]> = {
    Roles: [],
    Users: [{ id: 'user-hotel_admin', name: 'Hotel Admin', hotelId: 'h1', role: 'hotel_admin', active: 1 }],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', plan: 'host' }],
    Plans: [{ id: 'plan-host', slug: 'host', modules: ESSENTIAL_MODULES, isActive: 1 }],
    Subscriptions: [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }],
    Configuration: [],
    HotelModuleOverrides: [],
  }
  const orm: any = {
    define() { return orm },
    findMany: async (table: string, filters?: any) =>
      (rows[table] ?? []).filter((r) => Object.entries(filters ?? {}).every(([k, v]) => r[k] === v)),
    findById: async (table: string, id: string) => {
      if (table === 'Tickets') return ticketsById.get(id) ?? null
      return (rows[table] ?? []).find((r) => r.id === id) ?? null
    },
    findOne: async () => null,
    create: async (_t: string, d: any) => d,
    update: async (table: string, id: string, d: any) => {
      if (table !== 'Tickets') return d
      const cur = ticketsById.get(id)
      if (!cur) return null
      const next = { ...cur, ...d }
      ticketsById.set(id, next)
      return next
    },
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
  }

  const router = new Router()
  const auth = makeAuth()
  const mod = TicketsModule() as any
  mod.create({
    logger: fakeLogger(), orm, router, auth,
    cache: { get: async () => null, set: async () => {}, delete: async () => {} },
  })
  return { router, auth }
}

const hotelAdmin = (auth: HotelAuth, extra: Record<string, unknown> = {}) => ({
  authorization: `Bearer ${auth.createToken({ id: 'user-hotel_admin', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant', ...extra })}`,
})

describe('POST /api/tickets/:id/messages', () => {
  it('token con impersonatedBy → 403', async () => {
    const { router, auth } = mount()
    const headers = hotelAdmin(auth, { impersonatedBy: 'super-admin-1' })
    const res = await router.resolve('POST', '/api/tickets/t1/messages', { headers, body: { message: 'Hola' } })
    expect(res.status).toBe(403)
  })

  it('sesión normal (sin impersonar) → 201 con el ticket enriquecido y el mensaje incluido', async () => {
    const { router, auth } = mount()
    const headers = hotelAdmin(auth)
    const res = await router.resolve('POST', '/api/tickets/t1/messages', { headers, body: { message: 'Hola, tengo un problema' } })
    expect(res.status).toBe(201)
    const body = res.body as any
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].message).toBe('Hola, tengo un problema')
    expect(body.messages[0].authorKind).toBe('hotel')
    expect(body.messages[0].authorName).toBe('Hotel Admin')
    expect(body.requester).toBeDefined()
  })

  it('body con message vacío → 400', async () => {
    const { router, auth } = mount()
    const headers = hotelAdmin(auth)
    const res = await router.resolve('POST', '/api/tickets/t1/messages', { headers, body: { message: '   ' } })
    expect(res.status).toBe(400)
  })
})
