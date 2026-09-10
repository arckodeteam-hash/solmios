// plan-gate.test.ts — /api/tickets SIN gate por plan (REQ-SOP-07).
//
// Antes: exigía 'operations.maintenance' en la matriz del plan (misma clave que
// /api/mantenimiento) — un hotel sin ese módulo en su plan veía "Error al cargar tickets" en la
// pantalla de ayuda, que es CORE (soporte de la plataforma, no una feature vendible). Se retiró
// el createModuleGuard de las 5 rutas de tickets/index.ts; el permiso reports:* se sigue
// exigiendo (deuda anotada: falta un permiso propio support:*).
// /api/mantenimiento (el módulo REAL de incidencias de mantenimiento — no tocado por este
// cambio) sigue gateado por su propio plan: se monta acá también para dejar constancia de que
// retirar el gate de tickets no le pegó al de al lado.
//
// Se monta el módulo REAL sobre Router/HotelAuth reales con un ORM fake CON datos (el genérico
// de route-permission-helpers devuelve todo vacío y el resolver caería a "sin plan" = todo ON).
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { TicketsModule } from '../index'
import { MantenimientoModule } from '../../mantenimiento/index'
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

/** Monta AMBOS módulos (tickets + mantenimiento) sobre el mismo router, con un hotel h1 cuyo
 *  plan (slug 'host') tiene `planModules`. */
function mount(planModules: string[]) {
  const router = new Router()
  const auth = makeAuth()
  const orm = ormWith({
    Roles: [],
    Tickets: [],
    Maintenance: [],
    Users: [],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', plan: 'host' }],
    Plans: [{ id: 'plan-host', slug: 'host', modules: planModules, isActive: 1 }],
    Subscriptions: [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }],
    Configuration: [], // sin overrides globales: todo global-ON
    HotelModuleOverrides: [],
  })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const ticketsMod = TicketsModule() as any
  ticketsMod.create({ logger: fakeLogger(), orm, router, auth, cache })
  const mantenimientoMod = MantenimientoModule() as any
  mantenimientoMod.create({ logger: fakeLogger(), orm, router, auth, cache })
  return { router, auth }
}

const merchant = (auth: HotelAuth) => ({
  authorization: `Bearer ${auth.createToken({ id: 'u1', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}`,
})

// Matriz real del seeder (scripts/create-plans-table.ts): host NO vende mantenimiento.
const HOST_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests', 'settings.rooms', 'site-pages', 'settings.rates', 'settings.audit']

describe('/api/tickets — SIN gate por plan (REQ-SOP-07)', () => {
  it('hotel con plan host (sin operations.maintenance) → GET /api/tickets 200', async () => {
    const { router, auth } = mount(HOST_MODULES)
    const res = await router.resolve('GET', '/api/tickets', { headers: merchant(auth) })
    expect(res.status).toBe(200)
  })

  it('hotel con plan host (sin operations.maintenance) → POST /api/tickets 201', async () => {
    const { router, auth } = mount(HOST_MODULES)
    const res = await router.resolve('POST', '/api/tickets', {
      headers: merchant(auth),
      body: { hotelId: 'h1', userId: 'u1', subject: 'No puedo entrar al panel' },
    })
    expect(res.status).toBe(201)
  })

  it('super_admin sigue pudiendo — nunca dependió del módulo de hotel', async () => {
    const { router, auth } = mount(HOST_MODULES)
    const headers = { authorization: `Bearer ${auth.createToken({ id: 'sa', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
    const res = await router.resolve('GET', '/api/tickets', { headers })
    expect(res.status).toBe(200)
  })

  it('/api/mantenimiento (módulo distinto, no tocado) sigue 403 para el mismo hotel/plan', async () => {
    const { router, auth } = mount(HOST_MODULES)
    const res = await router.resolve('GET', '/api/mantenimiento', { headers: merchant(auth) })
    expect(res.status).toBe(403)
  })
})
