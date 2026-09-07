// change-plan.test.ts — Cambiar el plan de un hotel tiene que mover la fila que MANDA.
//
// El bug de origen (#46): el super admin cambiaba el plan desde /admin/hotels, se guardaba solo
// el espejo legacy `hotels.plan`, y `resolveHotelPlan` lo ignora cuando el hotel tiene una
// suscripción activa — el panel del hotel seguía mostrando los módulos del plan viejo. El test
// de cierre de este archivo es justamente ese: después de `changeHotelPlan`, `resolveHotelPlan`
// devuelve la matriz del plan NUEVO.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { changeHotelPlan } from '../usecases/change-plan'
import { resolveHotelPlan } from '../usecases/resolve-plan'

// Matrices reales del seeder (scripts/create-plans-table.ts), recortadas a lo que este archivo
// necesita: lo que importa es que host y essential DIFIERAN, para poder ver el cambio.
const HOST_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests', 'settings.rooms', 'site-pages', 'settings.rates', 'settings.audit']
const ESSENTIAL_MODULES = [...HOST_MODULES, 'channel', 'finance.billing', 'finance.payments', 'operations.maintenance']

/** Repo fake en memoria — mismo criterio que plan-gating.test.ts:repo. */
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

/** Catálogo como el seeder: id 'plan-X', slug 'X'. `plan-baja` está dado de baja a propósito. */
function plansTable() {
  return [
    { id: 'plan-host', slug: 'host', modules: HOST_MODULES, isActive: 1 },
    { id: 'plan-essential', slug: 'essential', modules: ESSENTIAL_MODULES, isActive: 1 },
    { id: 'plan-baja', slug: 'baja', modules: [], isActive: 0 },
  ]
}

/**
 * Logger que graba info/warn. Los métodos de `silentLogger()` viven en el PROTOTIPO, así que un
 * spread `{...silentLogger(), info}` deja un objeto sin `info`/`error` reales — se asignan sobre
 * la instancia para que sombreen el prototipo y el resto de los niveles siga silencioso.
 */
function recordingLogger(): { logger: Logger; infos: Array<{ msg: string; meta: any }>; warns: string[] } {
  const infos: Array<{ msg: string; meta: any }> = []
  const warns: string[] = []
  const logger = silentLogger()
  Object.assign(logger, {
    info: (msg: string, meta?: any) => { infos.push({ msg, meta }) },
    warn: (msg: string) => { warns.push(msg) },
  })
  return { logger: logger as unknown as Logger, infos, warns }
}

function setup(subs: any[], hotel: any = { id: 'h1', name: 'Hotel Sol', plan: 'host' }) {
  const hotels = [hotel]
  const subUpdates: Array<{ id: string; patch: any }> = []
  const hotelUpdates: Array<{ id: string; patch: any }> = []
  const subscriptionsRepo = repo(subs, subUpdates)
  const plansRepo = repo(plansTable())
  const deps = { subscriptionsRepo, hotelsRepo: repo(hotels, hotelUpdates), plansRepo, logger: silentLogger() }
  return { deps, hotels, subs, subUpdates, hotelUpdates, subscriptionsRepo, plansRepo }
}

describe('changeHotelPlan — mueve el planId de la suscripción activa', () => {
  it('mueve el planId de la fila activa y sincroniza el espejo hotels.plan', async () => {
    const { deps, subs, hotels } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])

    const res = await changeHotelPlan(deps, 'h1', 'plan-essential')

    expect(res).toMatchObject({
      changed: true, hotelId: 'h1', planId: 'plan-essential', planSlug: 'essential',
      previousPlanId: 'plan-host', subscriptionId: 's1',
    })
    expect(subs[0].planId).toBe('plan-essential')
    expect(hotels[0].plan).toBe('essential')
    // El kernel ya envuelve la respuesta: devolver `{data:...}` acá sería el doble wrap.
    expect((res as any).data).toBeUndefined()
  })

  it('con varias filas mueve EXACTAMENTE la que elige compareSubscriptions (la de Stripe)', async () => {
    // CS-7: la fila con `stripeSubscriptionId` gana. Si acá se moviera otra, el hotel quedaría
    // gateado con una suscripción distinta de la que se cambió — el cambio no se vería.
    const { deps, subs, subUpdates } = setup([
      { id: 's-vieja', hotelId: 'h1', planId: 'plan-host', status: 'active', createdAt: '2026-08-01' },
      { id: 's-stripe', hotelId: 'h1', planId: 'plan-host', status: 'active', createdAt: '2026-07-01', stripeSubscriptionId: 'sub_123' },
    ])

    const res = await changeHotelPlan(deps, 'h1', 'plan-essential')

    expect(res.subscriptionId).toBe('s-stripe')
    expect(subUpdates).toEqual([{ id: 's-stripe', patch: { planId: 'plan-essential' } }])
    expect(subs.find((s) => s.id === 's-vieja').planId).toBe('plan-host')
  })

  it('hotel sin fila activa: NO crea suscripción, solo espeja hotels.plan y devuelve subscriptionId null', async () => {
    // Crear una fila 'active' sin nada en Stripe sería regalar acceso pago; ese hotel se resuelve
    // por el camino legacy de resolveHotelPlan, donde el espejo SÍ es la fuente.
    const { deps, subs, subUpdates, hotels } = setup([
      { id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'canceled' },
      { id: 's2', hotelId: 'h1', planId: 'plan-host', status: 'expired' },
    ])

    const res = await changeHotelPlan(deps, 'h1', 'plan-essential')

    expect(res).toMatchObject({ changed: true, subscriptionId: null, previousPlanId: null, planSlug: 'essential' })
    expect(subs).toHaveLength(2)
    expect(subUpdates).toHaveLength(0)
    expect(hotels[0].plan).toBe('essential')
  })

  it('plan inexistente → NotFoundError · hotel inexistente → NotFoundError', async () => {
    const { deps } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])
    await expect(changeHotelPlan(deps, 'h1', 'plan-inventado')).rejects.toThrow('Plan no encontrado')
    await expect(changeHotelPlan(deps, 'h-fantasma', 'plan-essential')).rejects.toThrow('Hotel no encontrado')
  })

  it('plan desactivado → ValidationError, salvo allowInactive (migraciones de la plataforma)', async () => {
    const { deps, subs } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])
    await expect(changeHotelPlan(deps, 'h1', 'plan-baja')).rejects.toThrow('desactivado')
    expect(subs[0].planId).toBe('plan-host')

    const res = await changeHotelPlan(deps, 'h1', 'plan-baja', { allowInactive: true })
    expect(res.changed).toBe(true)
    expect(subs[0].planId).toBe('plan-baja')
  })

  it('resuelve por slug además de por id (el select de /admin/hotels manda el slug)', async () => {
    const { deps, subs, hotels } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])

    const res = await changeHotelPlan(deps, 'h1', 'ESSENTIAL')

    expect(res).toMatchObject({ planId: 'plan-essential', planSlug: 'essential', changed: true })
    expect(subs[0].planId).toBe('plan-essential')
    expect(hotels[0].plan).toBe('essential')
  })

  it('idempotente: si ya está en ese plan devuelve changed:false y no escribe nada', async () => {
    const { deps, subUpdates, hotelUpdates } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])

    const res = await changeHotelPlan(deps, 'h1', 'plan-host')

    expect(res).toMatchObject({ changed: false, planId: 'plan-host', previousPlanId: 'plan-host', subscriptionId: 's1' })
    expect(subUpdates).toHaveLength(0)
    expect(hotelUpdates).toHaveLength(0)
  })

  it('un fallo del espejo hotels.plan NO tumba el cambio (best-effort, warn)', async () => {
    const { logger, warns } = recordingLogger()
    const subs = [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }]
    const hotelsRepo = {
      ...repo([{ id: 'h1', plan: 'host' }]),
      update: async () => { throw new Error('columna plan bloqueada') },
    } as unknown as RepositoryAdapter<any>

    const res = await changeHotelPlan(
      { subscriptionsRepo: repo(subs), hotelsRepo, plansRepo: repo(plansTable()), logger },
      'h1', 'plan-essential',
    )

    expect(res.changed).toBe(true)
    expect(subs[0].planId).toBe('plan-essential')
    expect(warns.join(' ')).toContain('hotels.plan')
  })

  it('deja rastro en el log cuando el plan cambia (acción de plataforma sobre un cliente)', async () => {
    const { logger, infos } = recordingLogger()
    const { deps } = setup([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])

    await changeHotelPlan({ ...deps, logger }, 'h1', 'plan-essential')

    expect(infos).toHaveLength(1)
    expect(infos[0].meta).toMatchObject({ hotelId: 'h1', previousPlanId: 'plan-host', planId: 'plan-essential' })
  })
})

describe('changeHotelPlan + resolveHotelPlan — el panel del hotel ve los módulos del plan nuevo', () => {
  // Criterio de aceptación 1 del #46. Es EL test del issue: antes, cambiar el plan escribía
  // `hotels.plan` y resolveHotelPlan lo ignoraba por tener una suscripción activa, así que el
  // hotel seguía con la matriz vieja. Acá se verifica la cadena entera con el mismo resolver
  // que usa el gate de módulos.
  it('tras cambiar host → essential, resolveHotelPlan devuelve la matriz de essential', async () => {
    const { deps, subscriptionsRepo, plansRepo, hotels } = setup([
      { id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' },
    ])

    const antes = await resolveHotelPlan(subscriptionsRepo, plansRepo, 'h1', hotels[0].plan)
    expect(antes).toMatchObject({ slug: 'host', planId: 'plan-host', source: 'subscription' })
    expect(antes.modules).toEqual(HOST_MODULES)

    await changeHotelPlan(deps, 'h1', 'essential')

    const despues = await resolveHotelPlan(subscriptionsRepo, plansRepo, 'h1', hotels[0].plan)
    expect(despues).toMatchObject({ slug: 'essential', planId: 'plan-essential', source: 'subscription' })
    expect(despues.modules).toEqual(ESSENTIAL_MODULES)
    expect(despues.modules).toContain('channel')
  })

  it('hotel sin suscripción activa: el espejo espejado alcanza — resolveHotelPlan lo lee por legacy', async () => {
    const { deps, subscriptionsRepo, plansRepo, hotels } = setup([
      { id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'canceled' },
    ])

    await changeHotelPlan(deps, 'h1', 'plan-essential')

    const res = await resolveHotelPlan(subscriptionsRepo, plansRepo, 'h1', hotels[0].plan)
    expect(res).toMatchObject({ slug: 'essential', source: 'legacy' })
    expect(res.modules).toEqual(ESSENTIAL_MODULES)
  })
})
