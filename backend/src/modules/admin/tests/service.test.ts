import { describe, it, expect, afterEach } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { AdminService } from '../service'
import { DashboardQueries } from '../usecases/dashboard-queries'

const log = silentLogger()

function makeRepos(overrides = {}) {
  const repo = (data: any[]) => ({
    findMany: async (_filter: any) => data,
    findById: async (id: string) => data.find((d: any) => d.id === id) || null,
    findOne: async (_filter: any) => data[0] || null,
    create: async (d: any) => d,
    update: async (_id: string, _d: any) => ({ id: _id, ...data[0], ..._d }),
    delete: async (_id: string) => true,
    count: async () => data.length,
    paginate: async (_filter?: any, _options?: any) => ({ data, total: data.length, limit: 20, offset: 0, pages: 1 }),
    ...overrides,
  })
  return {
    plansRepo: repo([{ id: 'p1', name: 'Essential', price: 49 }]),
    amenitiesRepo: repo([{ id: 'a1', key: 'wifi', label: 'WiFi' }]),
  }
}

function makeOrm(overrides: Partial<Record<string, any>> = {}) {
  return {
    findMany: async (table: string, _filter: any) => {
      if (table === 'Hotels') return [{ id: 'h1', name: 'Hotel 1', plan: 'professional', status: 'active' }]
      if (table === 'Users') return [{ id: 'u1', name: 'User 1', email: 'user@test.com' }]
      if (table === 'Reservations') return [{ id: 'r1', totalAmount: 100 }]
      if (table === 'Announcements') return []
      if (table === 'Auditlog') return []
      if (table === 'Tickets') return []
      return []
    },
    findById: async (_table: string, _id: string) => null,
    count: async (_table: string) => 0,
    create: async (_table: string, data: any) => data,
    update: async (_table: string, _id: string, _data: any) => {},
    delete: async (_table: string, _id: string) => {},
    ...overrides,
  }
}

describe('AdminService', () => {
  describe('listHotels', () => {
    it('returns hotels list', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      const result = await svc.listHotels()
      expect(result.data).toHaveLength(1)
    })
  })

  describe('listUsers', () => {
    it('returns users list without passwords', async () => {
      const repos = makeRepos()
      const orm = makeOrm({
        findMany: async () => [{ id: 'u1', name: 'User', password: 'secret' }],
      })
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(orm))
      const result = await svc.listUsers()
      expect(result.data[0]).not.toHaveProperty('password')
    })
  })

  describe('getAnalytics', () => {
    it('returns analytics with counts', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      const result = await svc.getAnalytics()
      expect(result.totalHoteles).toBe(1)
      expect(result.totalUsuarios).toBe(1)
      expect(result.totalReservas).toBe(1)
    })

    // DT-14: P&L consolidado cross-hotel (revenue − gastos), hallado al re-auditar el mapa.
    it('DT-14: pnlConsolidado suma revenue/gastos/neto de TODOS los hoteles, no solo el filtrado por status', async () => {
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Hotels') return [
            { id: 'h1', name: 'Hotel 1', plan: 'professional', status: 'active' },
            { id: 'h2', name: 'Hotel 2', plan: 'essential', status: 'active' },
          ]
          if (table === 'Reservations') return [
            { id: 'r1', hotelId: 'h1', totalAmount: 300, status: 'confirmed' },
            { id: 'r2', hotelId: 'h1', totalAmount: 999, status: 'cancelled' }, // NO cuenta (no confirmed/checked_in)
            { id: 'r3', hotelId: 'h2', totalAmount: 100, status: 'checked_in' },
          ]
          if (table === 'Expenses') return [
            { id: 'e1', hotelId: 'h1', amount: 50 },
            { id: 'e2', hotelId: 'h1', amount: 20 },
            { id: 'e3', hotelId: 'h2', amount: 30 },
          ]
          if (table === 'Rooms') return []
          if (table === 'Users') return []
          return []
        },
      })
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(orm))
      const result: any = await svc.getAnalytics()

      const h1 = result.hotelsBreakdown.find((h: any) => h.id === 'h1')
      const h2 = result.hotelsBreakdown.find((h: any) => h.id === 'h2')
      expect(h1).toMatchObject({ revenue: 300, gastos: 70, neto: 230 })
      expect(h2).toMatchObject({ revenue: 100, gastos: 30, neto: 70 })
      expect(result.pnlConsolidado).toEqual({ revenue: 400, gastos: 100, neto: 300 })
    })
  })

  describe('listSubscriptions', () => {
    it('cruza Hotels con Subscriptions/Plans reales — no inventa un mrr desde hotels.plan', async () => {
      const repos = makeRepos()
      const orm = makeOrm({
        findMany: async (table: string) => {
          if (table === 'Hotels') return [{ id: 'h1', name: 'Hotel 1', plan: 'professional' }, { id: 'h2', name: 'Hotel 2', plan: 'starter' }]
          if (table === 'Subscriptions') return [{ id: 's1', hotelId: 'h1', planId: 'p1', status: 'active', currentPeriodEnd: '2027-01-01T00:00:00.000Z', stripeCustomerId: 'cus_1' }]
          if (table === 'Plans') return [{ id: 'p1', name: 'Professional', price: 99 }]
          return []
        },
      })
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(orm))
      const result = await svc.listSubscriptions()

      expect(result.total).toBe(2)
      const h1 = result.data.find((r: any) => r.hotelId === 'h1')
      const h2 = result.data.find((r: any) => r.hotelId === 'h2')
      expect(h1).toMatchObject({ status: 'active', planName: 'Professional', mrr: 99, hasStripeCustomer: true })
      // h2 no tiene fila en `subscriptions`: no se inventa un plan ni un cobro.
      expect(h2).toMatchObject({ status: 'none', planName: '', mrr: 0, hasStripeCustomer: false })
      expect(result.mrrTotal).toBe(99)
    })
  })

  describe('listPlans', () => {
    it('returns plans list', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      const result = await svc.listPlans()
      expect(result.data).toHaveLength(1)
    })
  })

  describe('createPlan', () => {
    it('creates a new plan', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      const result = await svc.createPlan({ name: 'New Plan', price: 99 })
      expect(result.name).toBe('New Plan')
      expect(result.price).toBe(99)
    })

    it('throws without name', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      await expect(svc.createPlan({ price: 99 })).rejects.toThrow('name y price requeridos')
    })

    // CS-9: `plans.modules` aceptaba cualquier string — un typo quedaba persistido y el gate lo
    // ignoraba en silencio (el hotel perdía el módulo "sin razón"). Se valida contra el MISMO
    // catálogo que lee el gate; el controller mapea ValidationError → 400.
    it('CS-9: rechaza claves de módulo fuera del catálogo con ValidationError (→ 400)', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      await expect(svc.createPlan({ name: 'X', price: 10, modules: ['finance', 'finanze', 'finanze'] }))
        .rejects.toThrow('Claves de módulo inválidas en el plan: finanze')
    })

    it('CS-9: acepta módulos (padre) y submódulos (sub-clave) del catálogo', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      const result = await svc.createPlan({ name: 'X', price: 10, modules: ['planning', 'finance.billing'] })
      expect(result.modules).toEqual(['planning', 'finance.billing'])
    })

    it('CS-9: sin modules en el body no valida (retrocompat: default [])', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      const result = await svc.createPlan({ name: 'X', price: 10 })
      expect(result.modules).toEqual([])
    })
  })

  describe('updatePlan', () => {
    const makeSvc = () => {
      const repos = makeRepos()
      const created: any[] = []
      repos.plansRepo.update = async (id: string, patch: any) => { created.push({ id, patch }); return { id, ...patch } }
      return { svc: new AdminService(repos.plansRepo, repos.amenitiesRepo, log), updates: created }
    }

    it('actualiza la matriz modules con claves válidas del catálogo', async () => {
      const { svc, updates } = makeSvc()
      const result = await svc.updatePlan('p1', { modules: ['planning', 'reservations.checkin'] })
      expect(result.modules).toEqual(['planning', 'reservations.checkin'])
      expect(updates).toHaveLength(1)
    })

    it('CS-9: clave inválida → ValidationError y NO toca el repo', async () => {
      const { svc, updates } = makeSvc()
      await expect(svc.updatePlan('p1', { modules: ['planning', 'no-existe'] }))
        .rejects.toThrow('Claves de módulo inválidas en el plan: no-existe')
      expect(updates).toHaveLength(0)
    })

    it('patch sin modules no valida ni rompe (CS-9 solo aplica a la matriz)', async () => {
      const { svc, updates } = makeSvc()
      const result = await svc.updatePlan('p1', { price: 59 })
      expect(result.price).toBe(59)
      expect(updates[0].patch.modules).toBeUndefined()
    })

    it('404 si el plan no existe', async () => {
      const { svc } = makeSvc()
      await expect(svc.updatePlan('nope', { modules: [] })).rejects.toThrow('no encontrado')
    })
  })

  describe('deletePlan', () => {
    it('deletes existing plan', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      await expect(svc.deletePlan('p1')).resolves.toBeUndefined()
    })

    it('throws for non-existent plan', async () => {
      const repos = makeRepos()
      const svc = new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(makeOrm()))
      await expect(svc.deletePlan('nope')).rejects.toThrow('no encontrado')
    })
  })

  describe('getPublicUsers — fail-closed SEC-3.1 (V6)', () => {
    const demoOrm = makeOrm({
      findMany: async (table: string) => {
        if (table === 'Users') return [{ id: 'u1', name: 'Demo', email: 'demo@solmios.com', role: 'hotel_admin', isDemo: 1, active: 1 }]
        return []
      },
    })
    const prevNodeEnv = process.env.NODE_ENV
    const prevDemo = process.env.DEMO_LOGIN

    const makeSvc = () => {
      const repos = makeRepos()
      return new AdminService(repos.plansRepo, repos.amenitiesRepo, log, undefined, new DashboardQueries(demoOrm))
    }

    afterEach(() => {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevDemo === undefined) delete process.env.DEMO_LOGIN
      else process.env.DEMO_LOGIN = prevDemo
    })

    it('devuelve [] si NODE_ENV no esta seteado (fail-closed: deploy sin NODE_ENV no filtra cuentas demo)', async () => {
      delete process.env.NODE_ENV
      delete process.env.DEMO_LOGIN
      expect(await makeSvc().getPublicUsers()).toEqual([])
    })

    it('en dev (NODE_ENV=development) lista las cuentas demo, sin id ni credenciales', async () => {
      process.env.NODE_ENV = 'development'
      delete process.env.DEMO_LOGIN
      const result = await makeSvc().getPublicUsers()
      expect(result).toEqual([{ name: 'Demo', email: 'demo@solmios.com', role: 'hotel_admin' }])
      expect(result[0]).not.toHaveProperty('id')
    })

    it('en production solo lista si DEMO_LOGIN=1', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.DEMO_LOGIN
      expect(await makeSvc().getPublicUsers()).toEqual([])
      process.env.DEMO_LOGIN = '1'
      expect(await makeSvc().getPublicUsers()).toHaveLength(1)
    })
  })
})
