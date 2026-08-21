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

  // E4: el nombre viejo ("no inventa espejo / queda sin escribir") certificaba el mock, no el
  // ORM. Real: `create({ plan: undefined })` INCLUYE la clave en el INSERT (kernel/orm.ts la
  // retiene, orm-utils `coerceToDbValue` pasa undefined tal cual) → la columna se escribe NULL
  // y el DEFAULT físico del modelo ('professional') NO aplica. El fake de acá retiene
  // `undefined` de la misma forma, así que la assertion documenta ese comportamiento.
  // (Vía HTTP esta rama ya no existe: SignupSchema exige planId no vacío — queda para filas
  // legacy y para llamadas directas al usecase.)
  it('signup sin plan NO elige slug: el ORM persiste la columna en NULL (el default físico no aplica)', async () => {
    const { uc, hotels } = setup()
    await uc.signup(VALID, new Date('2026-08-18T12:00:00Z'))
    expect('plan' in hotels[0]).toBe(true) // la clave VIAJA en el INSERT (→ NULL en la fila real)
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

  // CS-6: past_due sigue siendo una suscripción VIVA (WORKING_STATUSES) — el plan no se
  // pierde mientras el cron de suspensión no la pase a suspended. Mismo WORKING_STATUSES
  // que access.ts (E5): un solo conjunto para el corte y para el gate.
  it('past_due resuelve el plan: sigue viva mientras dura la gracia (CS-6)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'past_due' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.source).toBe('subscription')
    expect(resolved.modules).toEqual(HOST_MODULES)
  })

  // CS-3: la sub ACTIVA sin planId (signup que no cargó planes) NO puede resolver a `null`
  // (= sin restricción = TODO el panel ON): matriz VACÍA + WARN. Antes este caso dejaba
  // entrar con todo habilitado, repetible en el trial público sin captcha.
  it('sub activa SIN planId → matriz VACÍA (cero módulos) + WARN, nunca full access (CS-3)', async () => {
    const { logger, warns } = recordingLogger()
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: '', status: 'active' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional', logger)
    expect(resolved.source).toBe('subscription')
    expect(resolved.modules).toEqual([])
    expect(warns.length).toBeGreaterThan(0)
  })

  it('sub activa SIN planId en el gate: TODO el catálogo OFF (fail-closed de punta a punta)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: '', status: 'trialing' }])
    const state = await getModuleStateForHotel(repo([]), repo(plansTable()), subs, 'h1', undefined, 'professional')
    expect(state.planning).toBe(false)
    expect(state.reservations).toBe(false)
    expect(state.guests).toBe(false)
    expect(state.settings).toBe(false) // ni siquiera los settings: cero módulos es cero
  })

  // CS-8: `plans.modules` con JSON corrupto reventaba con 500 en CADA ruta gateada del
  // hotel. Ahora: matriz vacía (fail-closed, consistente con CS-3) + ERROR logueado.
  it('plans.modules con JSON corrupto → matriz VACÍA + ERROR, sin throw (CS-8)', async () => {
    const errors: string[] = []
    const base = silentLogger()
    const logger = { ...base, error: (msg: string) => { errors.push(msg) } } as unknown as Logger
    const plans = repo([{ id: 'plan-roto', slug: 'roto', modules: '{"planning": no-cierra' }])
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-roto', status: 'active' }])
    const resolved = await resolveHotelPlan(subs, plans, 'h1', 'professional', logger)
    expect(resolved.modules).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
  })

  // CS-7: con varias filas activas para el hotel (doble alta / migración) el `find` sin
  // orden podía leer OTRA fila que la que parchea el webhook. Determinismo: primero la
  // fila con stripeSubscriptionId (la que el pago tocó); desempate por createdAt desc.
  it('varias filas activas: gana la que tiene stripeSubscriptionId (CS-7)', async () => {
    const subs = repo([
      { id: 's-nueva-sin-stripe', hotelId: 'h1', planId: 'plan-essential', status: 'active', createdAt: '2026-09-01T00:00:00Z' },
      { id: 's-legacy', hotelId: 'h1', planId: 'plan-host', status: 'active', stripeSubscriptionId: 'sub_stripe_1', createdAt: '2026-08-01T00:00:00Z' },
    ])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.planId).toBe('plan-host')
  })

  it('varias filas activas sin stripeSubscriptionId: gana la más reciente (CS-7)', async () => {
    const subs = repo([
      { id: 's-vieja', hotelId: 'h1', planId: 'plan-host', status: 'active', createdAt: '2026-08-01T00:00:00Z' },
      { id: 's-nueva', hotelId: 'h1', planId: 'plan-essential', status: 'active', createdAt: '2026-09-01T00:00:00Z' },
    ])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.planId).toBe('plan-essential')
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
    // CS-1: host lista el padre 'reservations' → 'reservations.list' QUEDA HABILITADO aunque
    // la matriz no lo enumere (expansión padre→hijos). Antes: listar 'reservations.checkin'
    // sin 'reservations.list' apagaba el listado → TODA /api/reservas* en 403, porque el
    // guard de la API exige la SUB-clave.
    expect(state['reservations.list']).toBe(true)
  })

  // CS-1, test exigido por la auditoría: la matriz EXACTA del plan host del seeder. Seleccionar
  // un módulo padre IMPLICA sus sub-módulos — el guard exige sub-claves, la matriz no tiene
  // por qué conocerlas.
  it('matriz host del seeder: reservations (padre) implica reservations.list (CS-1)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }])
    const state = await getModuleStateForHotel(config, repo(plansTable()), subs, 'h1', undefined, 'professional')
    expect(state.reservations).toBe(true)
    expect(state['reservations.checkin']).toBe(true) // explícito en la matriz
    expect(state['reservations.list']).toBe(true)   // implícito por el padre
  })

  // CS-1, dirección única: una sub-clave SIN su padre no habilita al padre ni a sus hermanos.
  it('sub-clave listada sin su padre NO prende al padre (la expansión es padre→hijos)', async () => {
    const plans = repo([{ id: 'plan-solo-checkin', slug: 'solo-checkin', modules: ['planning', 'reservations.checkin'] }])
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-solo-checkin', status: 'trialing' }])
    const state = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(state.planning).toBe(true)
    expect(state.reservations).toBe(false)
    expect(state['reservations.checkin']).toBe(false)
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

describe('webhooks de suscripción — pagar/cambiar sincroniza la fuente de verdad y el espejo', () => {
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

  // CS-2/CS-6: el upgrade/downgrade desde el portal de Stripe ya no se ignora — antes
  // customer.subscription.updated caía al default y la fila local quedaba con el plan
  // viejo para siempre (nadie más vuelve a tocar planId).
  it('customer.subscription.updated: sincroniza subscription.planId y el espejo hotels.plan al plan pagado (CS-2)', async () => {
    const hotels = [{ id: 'h1', name: 'Hotel Sol', email: 'd@h.com', plan: 'host' }]
    const subsRows = [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active', stripeSubscriptionId: 'sub_stripe_1' }]
    const plans = repo([
      { id: 'plan-host', slug: 'host', modules: HOST_MODULES, stripePriceId: 'price_host' },
      { id: 'plan-essential', slug: 'essential', modules: ESSENTIAL_MODULES, stripePriceId: 'price_essential' },
    ])

    await handleStripeEvent(
      { subscriptionsRepo: repo(subsRows), hotelsRepo: repo(hotels), plansRepo: plans, logger: silentLogger(), stripe },
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_stripe_1', items: { data: [{ price: { id: 'price_essential' } }] } } },
      } as any,
    )

    expect(subsRows[0].planId).toBe('plan-essential') // fuente de verdad
    expect(hotels[0].plan).toBe('essential')          // espejo legacy
    expect(subsRows[0].status).toBe('active')         // updated NO toca el status (eso es de invoice.paid/deleted)
  })

  it('customer.subscription.updated con el MISMO plan: no reescribe nada', async () => {
    const hotels = [{ id: 'h1', name: 'Hotel Sol', email: 'd@h.com', plan: 'host' }]
    const subsRows = [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active', stripeSubscriptionId: 'sub_stripe_1' }]
    const plans = repo([{ id: 'plan-host', slug: 'host', modules: HOST_MODULES, stripePriceId: 'price_host' }])
    const updates: Array<{ id: string; patch: any }> = []
    const subsRepo = { ...repo(subsRows), update: async (id: string, patch: any) => { updates.push({ id, patch }) } } as unknown as RepositoryAdapter<any>

    await handleStripeEvent(
      { subscriptionsRepo: subsRepo, hotelsRepo: repo(hotels), plansRepo: plans, logger: silentLogger(), stripe },
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_stripe_1', items: { data: [{ price: { id: 'price_host' } }] } } },
      } as any,
    )

    expect(updates).toHaveLength(0)
  })

  it('customer.subscription.updated sin Subscription local: solo WARN, no toca nada', async () => {
    const updates: Array<{ id: string; patch: any }> = []
    const subsRepo = { ...repo([]), update: async (id: string, patch: any) => { updates.push({ id, patch }) } } as unknown as RepositoryAdapter<any>

    await handleStripeEvent(
      { subscriptionsRepo: subsRepo, hotelsRepo: repo([]), plansRepo: repo(plansTable()), logger: silentLogger(), stripe },
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_desconocida', items: { data: [{ price: { id: 'price_host' } }] } } },
      } as any,
    )

    expect(updates).toHaveLength(0)
  })
})
