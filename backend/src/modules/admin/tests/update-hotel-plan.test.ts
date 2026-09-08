// admin/tests/update-hotel-plan.test.ts — El select de plan de /admin/hotels tiene que mover el
// plan REAL del hotel.
//
// El bug de origen (#46, reportado por el super admin): cambiaba el plan de un hotel desde
// /admin/hotels, la pantalla decía que guardó, y el panel de ese hotel seguía con exactamente los
// mismos menús. `updateHotel` escribía SOLO el espejo legacy `hotels.plan`, y `resolveHotelPlan`
// ignora ese espejo cuando el hotel tiene una suscripción activa: la fuente de verdad es
// `subscriptions.planId`. El test de cierre de este archivo es el criterio de aceptación mismo:
// después del PUT, `getModuleStateForHotel` (lo que come `GET /api/modules`, o sea el menú)
// devuelve los módulos del plan NUEVO.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { RepositoryAdapter } from 'arckode-framework'
import { AdminService } from '../service'
import { getModuleStateForHotel } from '../usecases/modules'

// Matrices reales del seeder (scripts/create-plans-table.ts), recortadas: lo que importa es que
// host y essential DIFIERAN, para poder ver el cambio en el menú.
const HOST_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests', 'settings.rooms', 'site-pages', 'settings.rates', 'settings.audit']
const ESSENTIAL_MODULES = [...HOST_MODULES, 'channel', 'finance.billing', 'finance.payments', 'operations.maintenance']

/** Repo fake en memoria — mismo criterio que subscriptions/tests/plan-gating.test.ts:repo. */
function repo(rows: any[], updates?: Array<{ id: string; patch: any }>): RepositoryAdapter<any> {
  return {
    findMany: async (f: Record<string, unknown> = {}) =>
      rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findOne: async (f: any) => rows.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null,
    create: async (d: any) => { rows.push(d); return d },
    update: async (id: string, patch: any) => {
      updates?.push({ id, patch })
      const row = rows.find((r) => r.id === id); if (row) Object.assign(row, patch)
      return row
    },
    delete: async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true },
    count: async () => rows.length,
    paginate: async () => ({ data: rows, total: rows.length, limit: 20, offset: 0, pages: 1 }),
  } as unknown as RepositoryAdapter<any>
}

/** Catálogo como el seeder: id 'plan-X', slug 'X'. */
function plansTable() {
  return [
    { id: 'plan-host', slug: 'host', modules: HOST_MODULES, isActive: 1 },
    { id: 'plan-essential', slug: 'essential', modules: ESSENTIAL_MODULES, isActive: 1 },
  ]
}

/**
 * Mismo contrato que el auth real: `assertOwnership(dueño, solicitante, rol, rolAdmin)` pasa si el
 * solicitante es el dueño O tiene el rol de admin. `updateHotel` es de plataforma, así que la
 * única puerta abierta es el rol — este doble tiene que seguir cerrando la otra.
 */
function fakeAuth() {
  return {
    assertOwnership(owner: string, requesterId: string, role?: string, adminRole?: string) {
      if (owner !== requesterId && role !== adminRole) throw new Error('Forbidden')
    },
  }
}

const SUPER_ADMIN = { id: 'u-sa', role: 'super_admin' }

/** `wireSubscriptions:false` = el service SIN el repo de suscripciones (cómo estaba antes del fix). */
function setup(opts: { wireSubscriptions?: boolean; subs?: any[]; hotel?: any } = {}) {
  const hotels = [opts.hotel ?? { id: 'h1', name: 'Hotel Sol', plan: 'host', status: 'active' }]
  const subs = opts.subs ?? [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }]
  const subUpdates: Array<{ id: string; patch: any }> = []
  const plansRepo = repo(plansTable())
  const hotelsRepo = repo(hotels)
  const subscriptionsRepo = repo(subs, subUpdates)
  const configRepo = repo([])
  const service = new AdminService(
    plansRepo as any, repo([]) as any, silentLogger(), fakeAuth(), undefined, hotelsRepo,
    undefined, undefined, configRepo, undefined,
    opts.wireSubscriptions === false ? undefined : subscriptionsRepo,
  )
  return { service, hotels, subs, subUpdates, plansRepo, subscriptionsRepo, configRepo }
}

describe('AdminService.updateHotel — el cambio de plan del super admin mueve la suscripción (#46)', () => {
  it('hotel con suscripción ACTIVA: mueve subscriptions.planId Y deja el espejo hotels.plan', async () => {
    const { service, hotels, subs } = setup()

    await service.updateHotel('h1', { plan: 'essential' }, SUPER_ADMIN)

    expect(subs[0].planId).toBe('plan-essential')
    expect(hotels[0].plan).toBe('essential')
  })

  it('extremo a extremo con el gate: el menú del hotel pasa a los módulos del plan NUEVO', async () => {
    const { service, hotels, plansRepo, subscriptionsRepo, configRepo } = setup()
    const menu = () => getModuleStateForHotel(configRepo, plansRepo, subscriptionsRepo, 'h1', undefined, hotels[0].plan)

    // Antes: plan host — sin Channel Manager ni Facturación (el hotel no los ve en el menú).
    const antes = await menu()
    expect(antes.channel).toBe(false)
    expect(antes['finance.billing']).toBe(false)
    expect(antes.planning).toBe(true)

    await service.updateHotel('h1', { plan: 'essential' }, SUPER_ADMIN)

    // Después: los módulos que essential SÍ promete aparecen. Este es el criterio de aceptación:
    // el super admin cambia el plan y el panel del hotel muestra los menús nuevos.
    const despues = await menu()
    expect(despues.channel).toBe(true)
    expect(despues['finance.billing']).toBe(true)
    expect(despues['finance.payments']).toBe(true)
    expect(despues.planning).toBe(true)
    // Lo que essential no incluye sigue cerrado: no se abrió el panel entero de paso.
    expect(despues['finance.caja']).toBe(false)
  })

  it('sin subscriptionsRepo cableado: escribe el espejo y NO rompe (comportamiento previo)', async () => {
    const { service, hotels, subs, subUpdates } = setup({ wireSubscriptions: false })

    const out = await service.updateHotel('h1', { plan: 'essential' }, SUPER_ADMIN)

    expect(hotels[0].plan).toBe('essential')
    expect((out as any).plan).toBe('essential')
    expect(subs[0].planId).toBe('plan-host')
    expect(subUpdates).toHaveLength(0)
  })

  it('plan inexistente: sigue fallando como hoy y no toca ni la suscripción ni el hotel', async () => {
    const { service, hotels, subs } = setup()

    await expect(service.updateHotel('h1', { plan: 'no-existe' }, SUPER_ADMIN))
      .rejects.toThrow("El plan 'no-existe' no existe en el catálogo de planes")
    expect(subs[0].planId).toBe('plan-host')
    expect(hotels[0].plan).toBe('host')
  })

  it('sin body.plan (solo name/status): no toca ninguna suscripción', async () => {
    const { service, hotels, subs, subUpdates } = setup()

    await service.updateHotel('h1', { name: 'Hotel Sol Naciente', status: 'INACTIVE' }, SUPER_ADMIN)

    expect(hotels[0].name).toBe('Hotel Sol Naciente')
    expect(hotels[0].status).toBe('inactive')
    expect(hotels[0].plan).toBe('host')
    expect(subs[0].planId).toBe('plan-host')
    expect(subUpdates).toHaveLength(0)
  })

  it('hotel SIN suscripción activa (solo una cancelada): espeja y no inventa una suscripción', async () => {
    const { service, hotels, subs } = setup({ subs: [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'canceled' }] })

    await service.updateHotel('h1', { plan: 'essential' }, SUPER_ADMIN)

    expect(hotels[0].plan).toBe('essential')
    expect(subs).toHaveLength(1)
    expect(subs[0].planId).toBe('plan-host')
  })

  it('si mover la suscripción falla, el error SE PROPAGA y el espejo no miente', async () => {
    const { service, subscriptionsRepo, hotels } = setup()
    ;(subscriptionsRepo as any).update = async () => { throw new Error('base caída') }

    await expect(service.updateHotel('h1', { plan: 'essential' }, SUPER_ADMIN)).rejects.toThrow('base caída')
    // El super admin ve el fallo y el hotel sigue coherente en su plan viejo: si acá quedara
    // 'essential', la pantalla prometería un plan que el gate no le da.
    expect(hotels[0].plan).toBe('host')
  })

  it('sigue siendo operación de plataforma: un hotel_admin no puede cambiarle el plan a nadie', async () => {
    const { service, subs } = setup()

    await expect(service.updateHotel('h1', { plan: 'essential' }, { id: 'u9', role: 'hotel_admin' }))
      .rejects.toThrow('Forbidden')
    expect(subs[0].planId).toBe('plan-host')
  })
})
