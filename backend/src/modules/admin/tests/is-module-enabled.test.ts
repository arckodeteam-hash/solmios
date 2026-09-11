// admin/tests/is-module-enabled.test.ts — #208: `isModuleEnabledForHotel` / `moduleStateForHotelId` son
// la ÚNICA cuenta de "global ∩ suscripción activa ∩ overrides" a partir de un hotelId. La usan el gate
// de la API y el checker de crons/conectores (infrastructure/auth/require-module.ts), `GET /api/modules`
// (admin/index.ts) y, vía `createModuleChecker`, la carta pública del restaurante. Un hotel cuyo plan
// no incluye `restaurant` → false; el mismo hotel con un override `enabled` → true; un módulo apagado
// global se cae para todos; la plataforma nunca se gatea.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { isModuleEnabledForHotel, moduleStateForHotelId, type ModuleEntitlementRepos } from '../usecases/modules'

const HOST_MODULES = ['planning', 'reservations', 'guests']
const PRO_MODULES = [...HOST_MODULES, 'restaurant']

function repo(rows: any[], onFind?: (f: Record<string, unknown>) => void): RepositoryAdapter<any> {
  return {
    findMany: async (f: Record<string, unknown> = {}) => { onFind?.(f); return rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)) },
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findOne: async (f: any) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null,
    create: async (d: any) => { rows.push(d); return d },
    update: async () => null, delete: async () => true, count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<any>
}

const plans = () => [
  { id: 'plan-host', slug: 'host', modules: HOST_MODULES, isActive: 1 },
  { id: 'plan-pro', slug: 'professional', modules: PRO_MODULES, isActive: 1 },
]

function setup(opts: { planId?: string; global?: Record<string, boolean>; overrides?: any[]; subscription?: boolean } = {}) {
  const hotelLookups: Array<Record<string, unknown>> = []
  const repos: ModuleEntitlementRepos = {
    hotelsRepo: repo([{ id: 'h1', name: 'Hotel Sol', plan: 'professional', status: 'active' }], (f) => hotelLookups.push(f)),
    subscriptionsRepo: repo(opts.subscription === false ? [] : [{ id: 's1', hotelId: 'h1', planId: opts.planId ?? 'plan-host', status: 'active' }]),
    configRepo: repo(opts.global ? [{ id: 'c1', hotelId: 'platform', key: 'modules', value: opts.global }] : []),
    overridesRepo: repo(opts.overrides ?? []),
    plansRepo: repo(plans()),
    logger: silentLogger(),
  }
  return { repos, hotelLookups }
}

describe('isModuleEnabledForHotel (#208)', () => {
  it('plan sin restaurant → false; plan con restaurant → true', async () => {
    expect(await isModuleEnabledForHotel(setup({ planId: 'plan-host' }).repos, 'h1', 'restaurant')).toBe(false)
    expect(await isModuleEnabledForHotel(setup({ planId: 'plan-pro' }).repos, 'h1', 'restaurant')).toBe(true)
  })

  it('override enabled del hotel prende el módulo aunque el plan no lo traiga (misma 3ª capa que el gate)', async () => {
    const { repos } = setup({ planId: 'plan-host', overrides: [{ id: 'ov1', hotelId: 'h1', moduleKey: 'restaurant', status: 'enabled' }] })
    expect(await isModuleEnabledForHotel(repos, 'h1', 'restaurant')).toBe(true)
  })

  it('apagado global manda: false aunque el plan lo incluya', async () => {
    const { repos } = setup({ planId: 'plan-pro', global: { restaurant: false } })
    expect(await isModuleEnabledForHotel(repos, 'h1', 'restaurant')).toBe(false)
  })

  it('sin suscripción activa cae al espejo legacy hotels.plan (professional → restaurant habilitado)', async () => {
    const { repos, hotelLookups } = setup({ subscription: false })
    expect(await isModuleEnabledForHotel(repos, 'h1', 'restaurant')).toBe(true)
    expect(hotelLookups).toEqual([{ id: 'h1' }])
  })

  it('hotelId vacío, undefined o "platform" → true, sin consultar hotels', async () => {
    const { repos, hotelLookups } = setup({ global: { restaurant: false } })
    expect(await isModuleEnabledForHotel(repos, '', 'restaurant')).toBe(true)
    expect(await isModuleEnabledForHotel(repos, undefined, 'restaurant')).toBe(true)
    expect(await isModuleEnabledForHotel(repos, 'platform', 'restaurant')).toBe(true)
    expect(hotelLookups).toEqual([])
  })
})

describe('moduleStateForHotelId (#208) — GET /api/modules usa la misma cuenta', () => {
  it('hotel: estado efectivo global ∩ suscripción ∩ overrides', async () => {
    const { repos } = setup({ planId: 'plan-host', overrides: [{ id: 'ov1', hotelId: 'h1', moduleKey: 'restaurant', status: 'enabled' }] })
    const state = await moduleStateForHotelId(repos, 'h1')
    expect(state.restaurant).toBe(true)
    expect(state.planning).toBe(true)
  })

  it('plataforma: solo el toggle global, sin leer hotels', async () => {
    const { repos, hotelLookups } = setup({ global: { restaurant: false } })
    const state = await moduleStateForHotelId(repos, 'platform')
    expect(state.restaurant).toBe(false)
    expect(hotelLookups).toEqual([])
  })
})
