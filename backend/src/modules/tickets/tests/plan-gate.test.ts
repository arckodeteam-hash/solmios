// plan-gate.test.ts — /api/tickets gateado por plan (operations.maintenance).
//
// Antes del gate: solo reports:view → 200 para CUALQUIER plan (hueco de feature-gating). Ahora
// exige además 'operations.maintenance' en la matriz del plan del hotel — misma clave que
// /api/mantenimiento y el menú Operaciones → Mantenimiento. Corta el acceso a host (matriz sin
// el módulo: correcto, no lo vende); essential/starter/professional lo mantienen. El super_admin
// no se gatea por módulos de hotel (require-module.ts:34).
//
// Se monta el módulo REAL sobre Router/HotelAuth reales con un ORM fake CON datos (el genérico
// de route-permission-helpers devuelve todo vacío y el resolver caería a "sin plan" = todo ON).
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { TicketsModule } from '../index'
import type { HotelAuth } from '../../../infrastructure/auth/hotel-auth'

/** ORM fake con filas por tabla (mismo shape que fakeOrm de route-permission-helpers). */
function ormWith(rows: Record<string, any[]>): any {
  const orm: any = {
    define() { return orm },
    findMany: async (table: string, filters?: any) =>
      (rows[table] ?? []).filter((r) => Object.entries(filters ?? {}).every(([k, v]) => r[k] === v)),
    findById: async () => null,
    findOne: async () => null,
    create: async (_t: string, d: any) => d,
    update: async (_t: string, _id: string, d: any) => d,
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
  }
  return orm
}

/** Monta el módulo con un hotel h1 cuyo plan (slug 'host') tiene `planModules`. */
function mount(planModules: string[]) {
  const router = new Router()
  const auth = makeAuth()
  const orm = ormWith({
    Roles: [],
    Tickets: [],
    Users: [],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', plan: 'host' }],
    Plans: [{ id: 'plan-host', slug: 'host', modules: planModules, isActive: 1 }],
    Subscriptions: [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }],
    Configuration: [], // sin overrides globales: todo global-ON
    HotelModuleOverrides: [],
  })
  const mod = TicketsModule() as any
  mod.create({
    logger: fakeLogger(), orm, router, auth,
    cache: { get: async () => null, set: async () => {}, delete: async () => {} },
  })
  return { router, auth }
}

const merchant = (auth: HotelAuth) => ({
  authorization: `Bearer ${auth.createToken({ id: 'u1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}`,
})
const superAdmin = (auth: HotelAuth) => ({
  authorization: `Bearer ${auth.createToken({ id: 'sa', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}`,
})

// Matrices reales del seeder (scripts/create-plans-table.ts): host NO vende mantenimiento,
// essential sí (starter/professional son [] = todo, mismo lado que essential acá).
const HOST_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests', 'settings.rooms', 'site-pages', 'settings.rates', 'settings.audit']
const ESSENTIAL_MODULES = [...HOST_MODULES, 'channel', 'finance.billing', 'finance.payments', 'operations.maintenance']

describe('GET /api/tickets — gate por plan (operations.maintenance)', () => {
  it('hotel con plan host (sin operations.maintenance) → 403, aunque tenga reports:view', async () => {
    const { router, auth } = mount(HOST_MODULES)
    const res = await router.resolve('GET', '/api/tickets', { headers: merchant(auth) })
    expect(res.status).toBe(403)
  })

  it('hotel con plan essential (operations.maintenance en la matriz) → pasa el gate (200)', async () => {
    const { router, auth } = mount(ESSENTIAL_MODULES)
    const res = await router.resolve('GET', '/api/tickets', { headers: merchant(auth) })
    expect(res.status).toBe(200)
    expect((res.body as any).data).toEqual([]) // lista vacía del ORM fake: llegó al handler
  })

  it('super_admin no se gatea por módulos de hotel', async () => {
    const { router, auth } = mount(HOST_MODULES)
    const res = await router.resolve('GET', '/api/tickets', { headers: superAdmin(auth) })
    expect(res.status).toBe(200)
  })
})
