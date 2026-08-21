// plan-gating.test.ts — La fila de `subscriptions` ACTIVA es la fuente de verdad del plan.
//
// Reproduce el bug de prod (2026-08, hotel a07f409e): el trial eligió `plan-host` (4 módulos),
// el alta nunca escribió `hotels.plan`, el default del modelo ('professional') ganó, y el gate
// de módulos — que solo leía `hotels.plan` — le mostró al hotel TODOS los módulos del panel.
//
// Las matrices son las reales del seeder (scripts/create-plans-table.ts):
//   host        = ['planning','reservations','reservations.checkin','guests']
//   essential   = host + ['finance','finance.billing','finance.payments','channel','operations','operations.maintenance']
//   starter/professional/enterprise/ultra = [] (todos — retrocompat planes top).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { SignupUseCase } from '../usecases/signup'
import { handleStripeEvent } from '../usecases/handle-stripe-event'
import { resolveHotelPlan } from '../usecases/resolve-plan'
import { getModuleStateForHotel } from '../../admin/usecases/modules'

const HOST_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests']
const ESSENTIAL_MODULES = [
  ...HOST_MODULES, 'finance', 'finance.billing', 'finance.payments',
  'channel', 'operations', 'operations.maintenance',
]

/** Repo fake en memoria — mismo criterio que handle-stripe-event.test.ts:makeRepo. */
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

/** Catálogo de planes como el seeder: id 'plan-X', slug 'X'. */
function plansTable() {
  return [
    { id: 'plan-host', slug: 'host', modules: HOST_MODULES },
    { id: 'plan-essential', slug: 'essential', modules: ESSENTIAL_MODULES },
    { id: 'plan-professional', slug: 'professional', modules: [] },
  ]
}

/** Logger que guarda los warn: el fail-open del resolver NO puede ser silencioso. */
function recordingLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = []
  const base = silentLogger()
  return { warns, logger: { ...base, warn: (msg: string) => { warns.push(msg) } } as unknown as Logger }
}

describe('signup — el trial aplica el plan elegido al hotel', () => {
  const VALID = { hotelName: 'Hotel Sol', email: 'dueno@sol.com', password: 'unaClave123', ownerName: 'Luis' }

  function setup() {
    const hotels: any[] = []
    const subs: any[] = []
    const uc = new SignupUseCase({
      hotelsRepo: repo(hotels),
      usersRepo: repo([]),
      rolesRepo: repo([]),
      subscriptionsRepo: repo(subs),
      plansRepo: repo(plansTable()),
      hashPassword: async (p: string) => `hashed:${p}`,
      logger: silentLogger(),
    })
    return { uc, hotels, subs }
  }

  it('signup con plan-host deja hotels.plan = "host" (el espejo refleja el plan del trial)', async () => {
    const { uc, hotels, subs } = setup()
    await uc.signup({ ...VALID, planId: 'plan-host' }, new Date('2026-08-18T12:00:00Z'))
    expect(subs[0]).toMatchObject({ planId: 'plan-host', status: 'trialing' })
    expect(hotels[0].plan).toBe('host')
  })

  it('signup sin plan no inventa espejo (hotels.plan queda sin escribir)', async () => {
    const { uc, hotels } = setup()
    await uc.signup(VALID, new Date('2026-08-18T12:00:00Z'))
    expect(hotels[0].plan).toBeUndefined()
  })
})

describe('resolveHotelPlan — la suscripción activa manda', () => {
  it('trial de plan-host resuelve la matriz del plan, no la del espejo hotels.plan', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.source).toBe('subscription')
    expect(resolved.slug).toBe('host')
    expect(resolved.modules).toEqual(HOST_MODULES)
  })

  it('suscripción activa paga lo mismo manda (no solo el trial)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.modules).toEqual(HOST_MODULES)
  })

  it('suscripción con el plan BORRADO de plans: fail-open documentado y WARN (nunca silencioso)', async () => {
    const { logger, warns } = recordingLogger()
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-fantasma', status: 'active' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional', logger)
    expect(resolved.modules).toBeNull()
    expect(warns.length).toBeGreaterThan(0)
  })

  it('sin fila de suscripción (hotel legacy): cae al espejo hotels.plan', async () => {
    const resolved = await resolveHotelPlan(repo([]), repo(plansTable()), 'h1', 'essential')
    expect(resolved.source).toBe('legacy')
    expect(resolved.modules).toEqual(ESSENTIAL_MODULES)
  })

  it('suscripción cancelada/expired no gatea: cae al legacy (el corte de acceso lo decide access.ts)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'canceled' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'essential')
    expect(resolved.source).toBe('legacy')
    expect(resolved.modules).toEqual(ESSENTIAL_MODULES)
  })
})

describe('getModuleStateForHotel — el gate aplica plans.modules tal cual', () => {
  const config = repo([]) // sin configuration(platform,'modules'): todo global-ON

  it('trial de plan-host: SOLO los 4 módulos del plan; el resto OFF', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }])
    const state = await getModuleStateForHotel(config, repo(plansTable()), subs, 'h1', undefined, 'professional')
    expect(state.planning).toBe(true)
    expect(state.reservations).toBe(true)
    expect(state['reservations.checkin']).toBe(true)
    expect(state.guests).toBe(true)
    // El resto del catálogo NO entra al plan:
    expect(state.finance).toBe(false)
    expect(state.crm).toBe(false)
    expect(state.hr).toBe(false)
    expect(state.restaurant).toBe(false)
    // Config tal cual: host lista 'reservations.checkin' pero NO 'reservations.list' →
    // dentro de reservas solo el check-in (regla de submódulos del catálogo).
    expect(state['reservations.list']).toBe(false)
  })

  it('hotel legacy sin suscripción: mantiene el acceso de hoy vía hotels.plan', async () => {
    const state = await getModuleStateForHotel(config, repo(plansTable()), repo([]), 'h1', undefined, 'essential')
    expect(state.finance).toBe(true)
    expect(state.channel).toBe(true)
    expect(state.crm).toBe(false)
    expect(state.restaurant).toBe(false)
  })

  it('hotel legacy con slug desconocido: todo ON (legacy documentado, no rompe clientes existentes)', async () => {
    const state = await getModuleStateForHotel(config, repo(plansTable()), repo([]), 'h1', undefined, 'plan-viejo-que-ya-no-existe')
    expect(state.finance).toBe(true)
    expect(state.crm).toBe(true)
  })

  it('hotel con suscripción activa y slug desconocido en el espejo: la suscripción igual manda', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }])
    const state = await getModuleStateForHotel(config, repo(plansTable()), subs, 'h1', undefined, 'plan-roto')
    expect(state.planning).toBe(true)
    expect(state.finance).toBe(false)
  })
})

describe('checkout.session.completed — pagar sincroniza la fuente de verdad y el espejo', () => {
  const stripe = { subscriptions: { retrieve: async () => ({ items: { data: [{ current_period_end: 1_800_000_000 }] } }) } } as any

  function checkoutEvent(hotelId: string, metadataPlanId: string): any {
    return {
      type: 'checkout.session.completed',
      data: { object: { mode: 'subscription', customer: 'cus_1', subscription: 'sub_stripe_1', metadata: { hotelId, planId: metadataPlanId } } },
    }
  }

  it('paga un plan DISTINTO al del trial: subscription.planId pasa al plan pagado y hotels.plan al slug', async () => {
    const hotels = [{ id: 'h1', name: 'Hotel Sol', email: 'd@h.com', plan: 'host' }]
    const subsRows = [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }]

    await handleStripeEvent(
      {
        subscriptionsRepo: repo(subsRows), // muta in-place: se aserta sobre subsRows
        hotelsRepo: repo(hotels),          // ídem hotels
        plansRepo: repo(plansTable()),
        logger: silentLogger(),
        stripe,
      },
      checkoutEvent('h1', 'plan-essential'),
    )

    // Fuente de verdad: la suscripción queda apuntando al plan PAGADO.
    expect(subsRows[0].planId).toBe('plan-essential')
    expect(subsRows[0].status).toBe('active')
    // Espejo: hotels.plan refleja el slug del plan pagado.
    expect(hotels[0].plan).toBe('essential')
  })
})
