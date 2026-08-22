// plan-gating.test.ts — La fila de `subscriptions` ACTIVA es la fuente de verdad del plan.
//
// Reproduce el bug de prod (2026-08, hotel a07f409e): el trial eligió `plan-host` (4 módulos),
// el alta nunca escribió `hotels.plan`, el default del modelo ('professional') ganó, y el gate
// de módulos — que solo leía `hotels.plan` — le mostró al hotel TODOS los módulos del panel.
//
// Las matrices son las reales del seeder (scripts/create-plans-table.ts):
//   host        = ['planning','reservations','reservations.checkin','guests','settings.rooms']
//   essential   = host + ['channel','finance.billing','finance.payments','operations.maintenance']
//     R3-2: SIN los padres 'finance'/'operations' — bajo "padre = módulo completo" un padre
//     hereda TODOS sus sub-módulos y essential regalaba 8 que el plan no promete.
//     settings.rooms (auditoría 2026-08-21): sin el catálogo de habitaciones el paso REQUIRED
//     del onboarding queda 403 y el plan que vende 'reservations' es inoperable.
//   starter/professional/enterprise/ultra = [] (todos — retrocompat planes top).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import type { Logger, RepositoryAdapter } from 'arckode-framework'
import { SignupUseCase } from '../usecases/signup'
import { handleStripeEvent } from '../usecases/handle-stripe-event'
import { resolveHotelPlan } from '../usecases/resolve-plan'
import { getModuleStateForHotel } from '../../admin/usecases/modules'

const HOST_MODULES = ['planning', 'reservations', 'reservations.checkin', 'guests', 'settings.rooms']
const ESSENTIAL_MODULES = [
  ...HOST_MODULES, 'channel', 'finance.billing', 'finance.payments', 'operations.maintenance',
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
    { id: 'plan-host', slug: 'host', modules: HOST_MODULES, isActive: 1 },
    { id: 'plan-essential', slug: 'essential', modules: ESSENTIAL_MODULES, isActive: 1 },
    { id: 'plan-professional', slug: 'professional', modules: [], isActive: 1 },
  ]
}

/** Logger que guarda warn y error: ni el fail-open ni el fail-closed pueden ser silenciosos. */
function recordingLogger(): { logger: Logger; warns: string[]; errors: string[] } {
  const warns: string[] = []
  const errors: string[] = []
  const base = silentLogger()
  return {
    warns, errors,
    logger: {
      ...base,
      warn: (msg: string) => { warns.push(msg) },
      error: (msg: string) => { errors.push(msg) },
    } as unknown as Logger,
  }
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

  // R3-1a: el bypass. Un planId inexistente pasaba el schema (no-vacío) y el usecase solo
  // WARNEABA; después el resolver le daba matriz null = TODO el panel. El alta tiene que
  // cortar ANTES de crear nada: 400 "Plan no disponible" y cero filas.
  it('signup con planId INEXISTENTE → 400 "Plan no disponible", sin crear nada (R3-1a)', async () => {
    const { uc, hotels, subs } = setup()
    await expect(uc.signup({ ...VALID, planId: 'plan-x' }, new Date('2026-08-18T12:00:00Z')))
      .rejects.toThrow('Plan no disponible')
    expect(hotels).toHaveLength(0)
    expect(subs).toHaveLength(0)
  })

  it('signup con plan DESACTIVADO → 400 "Plan no disponible" igual (R3-1a)', async () => {
    const hotels: any[] = []
    const subs: any[] = []
    const uc = new SignupUseCase({
      hotelsRepo: repo(hotels),
      usersRepo: repo([]),
      rolesRepo: repo([]),
      subscriptionsRepo: repo(subs),
      plansRepo: repo([{ id: 'plan-baja', slug: 'baja', modules: [], isActive: 0 }]),
      hashPassword: async (p: string) => `hashed:${p}`,
      logger: silentLogger(),
    })
    await expect(uc.signup({ ...VALID, planId: 'plan-baja' }, new Date('2026-08-18T12:00:00Z')))
      .rejects.toThrow('Plan no disponible')
    expect(hotels).toHaveLength(0)
  })

  // E4: el ORM retiene `plan: undefined` en el INSERT → la columna viaja NULL y el default
  // físico ('professional') NO aplica; el fake replica ese comportamiento.
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

  // R3-4c: empate total (sin stripe, mismo createdAt) → desempate final por id. Sin esto el
  // ganador dependía del orden de devolución de la base: mismo hotel, distinta matriz según
  // el motor/índice.
  it('empate total (sin stripe, mismo createdAt): gana la de id menor — determinista (R3-4c)', async () => {
    const subs = repo([
      { id: 's-b', hotelId: 'h1', planId: 'plan-host', status: 'active', createdAt: '2026-08-01T00:00:00Z' },
      { id: 's-a', hotelId: 'h1', planId: 'plan-essential', status: 'active', createdAt: '2026-08-01T00:00:00Z' },
    ])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.planId).toBe('plan-essential') // s-a < s-b
  })

  it('suscripción activa paga lo mismo manda (no solo el trial)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional')
    expect(resolved.modules).toEqual(HOST_MODULES)
  })

  // R3-1b: el otro extremo del bypass. La suscripción apunta a un plan que NO existe en
  // `plans` (borrado / id inventado que pasó el schema) → matriz VACÍA + ERROR, igual que
  // la sub sin planId (CS-3). Antes: matriz null = fail-open = TODO el panel prendido para
  // un plan de 4 módulos.
  it('suscripción con plan INEXISTENTE → matriz VACÍA + ERROR, nunca fail-open (R3-1b)', async () => {
    const { logger, errors } = recordingLogger()
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-fantasma', status: 'active' }])
    const resolved = await resolveHotelPlan(subs, repo(plansTable()), 'h1', 'professional', logger)
    expect(resolved.source).toBe('subscription')
    expect(resolved.modules).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
  })

  it('sub activa con plan INEXISTENTE en el gate: cero módulos (fail-closed de punta a punta, R3-1b)', async () => {
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-fantasma', status: 'trialing' }])
    const state = await getModuleStateForHotel(repo([]), repo(plansTable()), subs, 'h1', undefined, 'professional')
    expect(state.planning).toBe(false)
    expect(state.reservations).toBe(false)
    expect(state.guests).toBe(false)
    expect(state.settings).toBe(false)
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

  it('trial de plan-host: SOLO los módulos del plan; el resto OFF', async () => {
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

  // CS-1, dirección única: una sub-clave SIN su padre no habilita al padre NI a sus hermanos
  // — pero desde R3-2 el sub-módulo listado SÍ queda habilitado por sí mismo (sin esto, la
  // matriz de essential con hijos sin padre no concedería nada de finance/operations).
  it('sub-clave listada sin su padre: prende SOLO esa sub-clave (ni el padre ni sus hermanos)', async () => {
    const plans = repo([{ id: 'plan-solo-checkin', slug: 'solo-checkin', modules: ['planning', 'reservations.checkin'] }])
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-solo-checkin', status: 'trialing' }])
    const state = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(state.planning).toBe(true)
    expect(state['reservations.checkin']).toBe(true) // la sub-clave listada, habilitada
    expect(state.reservations).toBe(false)           // el padre NO (nunca hijos→padre)
    expect(state['reservations.list']).toBe(false)   // ni sus hermanos
  })

  it('hotel legacy sin suscripción: mantiene el acceso de hoy vía hotels.plan', async () => {
    const state = await getModuleStateForHotel(config, repo(plansTable()), repo([]), 'h1', undefined, 'essential')
    expect(state.channel).toBe(true)
    expect(state['finance.billing']).toBe(true) // R3-2: los hijos explícitos de essential se mantienen
    expect(state.finance).toBe(false)           // pero el padre ya no entra (módulo completo no prometido)
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

// Editor de módulos por plan (/admin → planes): al guardar un PUT la matriz persiste en
// `plans.modules`. El gate NO cachea — la lee en cada request — así que el hotel tiene que ver
// el cambio en la llamada siguiente, sin restart del backend.
describe('edición del plan → el gate la ve en el request siguiente (sin restart)', () => {
  const config = repo([]) // sin configuration(platform,'modules'): todo global-ON

  it('agregar un módulo al plan: el estado del hotel cambia en la llamada siguiente', async () => {
    const plansRows = [{ id: 'plan-host', slug: 'host', modules: [...HOST_MODULES], isActive: 1 }]
    const plans = repo(plansRows) // repo() muta in-place: el update es visible para el findMany siguiente
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'trialing' }])

    const before = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(before.crm).toBe(false)

    await plans.update('plan-host', { modules: [...HOST_MODULES, 'crm'] }) // lo que persiste el PUT /api/admin/plans/:id

    const after = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(after.crm).toBe(true) // sin restart ni invalidación: la matriz se lee por request
  })

  it('quitar el padre finance: el módulo y sus submódulos caen en el request siguiente', async () => {
    const plans = repo([{ id: 'plan-full', slug: 'full', modules: ['planning', 'finance'], isActive: 1 }])
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-full', status: 'active' }])

    const before = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(before.finance).toBe(true)
    expect(before['finance.billing']).toBe(true) // implícito por el padre (CS-1)

    await plans.update('plan-full', { modules: ['planning'] })

    const after = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(after.finance).toBe(false)
    expect(after['finance.billing']).toBe(false)
  })

  it('de padre completo a sub-claves sueltas (activación parcial): solo esa parte queda ON', async () => {
    const plans = repo([{ id: 'plan-parcial', slug: 'parcial', modules: ['finance'], isActive: 1 }])
    const subs = repo([{ id: 's1', hotelId: 'h1', planId: 'plan-parcial', status: 'trialing' }])

    await plans.update('plan-parcial', { modules: ['finance.billing'] }) // el editor guarda SOLO la sub-clave

    const state = await getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
    expect(state['finance.billing']).toBe(true)  // la parte elegida
    expect(state.finance).toBe(false)            // el módulo completo ya no
    expect(state['finance.folios']).toBe(false)  // ni los hermanos
  })
})

// R3-2 — congelado de la matriz EFECTIVA de los planes del SEEDER bajo la semántica
// "padre = módulo completo". El test lee la matriz de scripts/create-plans-table.ts (no una
// copia acá): si alguien vuelve a listar un padre en essential, o el script y el catálogo
// divergen — que fue la causa raíz del over-grant — este es el test que rompe.
describe('R3-2 — matriz EFECTIVA de los planes del seeder', () => {
  const config = repo([]) // sin configuration(platform,'modules'): todo global-ON

  /** Matriz `modules` del seeder para un plan: de su línea, el único JSON.stringify([...])
   *  cuyos items incluyen 'planning' (features/limits de los planes no lo listan). Los
   *  literales son JS con comillas simples — se extraen por regex, sin JSON.parse. */
  async function seederModules(planId: string): Promise<string[]> {
    const src = await Bun.file(new URL('../../../../scripts/create-plans-table.ts', import.meta.url)).text()
    const line = src.split('\n').find((l) => l.includes(`'${planId}'`))
    if (!line) throw new Error(`${planId} no está en el seeder`)
    const arrays = [...line.matchAll(/JSON\.stringify\(\[([^\]]*)\]\)/g)]
      .map((m) => [...(m[1] ?? '').matchAll(/'([^']*)'/g)].map((i) => i[1] as string))
    const modules = arrays.find((items) => items.includes('planning'))
    if (!modules) throw new Error(`${planId}: matriz modules no encontrada en el seeder`)
    return modules
  }

  async function stateFor(planId: string) {
    const plans = repo([{ id: planId, slug: planId.replace('plan-', ''), modules: await seederModules(planId), isActive: 1 }])
    const subs = repo([{ id: 's1', hotelId: 'h1', planId, status: 'trialing' }])
    return getModuleStateForHotel(config, plans, subs, 'h1', undefined, 'professional')
  }

  it('essential: NO hereda folios/caja/gastos/reports/night-audit ni limpieza/proveedores/chats', async () => {
    const state = await stateFor('plan-essential')
    // Los 8 sub-módulos heredados por listar los padres 'finance' y 'operations':
    expect(state['finance.folios']).toBe(false)
    expect(state['finance.caja']).toBe(false)
    expect(state['finance.gastos']).toBe(false)
    expect(state['finance.reports']).toBe(false)
    expect(state['finance.night-audit']).toBe(false)
    expect(state['operations.housekeeping']).toBe(false)
    expect(state['operations.providers']).toBe(false)
    expect(state['operations.team-chat']).toBe(false)
    // Los padres tampoco (módulo completo NO prometido por el plan):
    expect(state.finance).toBe(false)
    expect(state.operations).toBe(false)
  })

  it('essential: lo que SÍ promete queda ON (PMS + Channel + Reservas + Pagos + Mantenimiento)', async () => {
    const state = await stateFor('plan-essential')
    expect(state.planning).toBe(true)
    expect(state.reservations).toBe(true)
    expect(state['reservations.list']).toBe(true)
    expect(state['reservations.checkin']).toBe(true)
    expect(state.guests).toBe(true)
    expect(state.channel).toBe(true)
    expect(state['finance.billing']).toBe(true)
    expect(state['finance.payments']).toBe(true)
    expect(state['operations.maintenance']).toBe(true)
    expect(state.crm).toBe(false)
  })

  it('host: reservations (padre) implica reservations.list y reservations.checkin (CS-1)', async () => {
    const state = await stateFor('plan-host')
    expect(state.reservations).toBe(true)
    expect(state['reservations.list']).toBe(true)   // implícito por el padre
    expect(state['reservations.checkin']).toBe(true)
    expect(state.finance).toBe(false)
  })

  // Auditoría de superficies 2026-08-21: host/essential venden 'reservations' pero NO listaban
  // el catálogo de habitaciones → el paso REQUIRED del onboarding ('Cargá tus habitaciones' →
  // /panel/config/habitaciones → /api/habitaciones con moduleGuard('settings.rooms')) quedaba
  // 403. Sin habitaciones no entra ninguna reserva y el motor público no tiene inventario
  // (prod: Hotel Ortiz, trial plan-host, 0 habitaciones). La SUB-clave sola prende el catálogo
  // SIN regalar el padre 'settings' (R3-2: ni locks, ni gateways, ni auto-messages).
  it('host puede gestionar habitaciones (settings.rooms ON) sin heredar el resto de settings', async () => {
    const state = await stateFor('plan-host')
    expect(state['settings.rooms']).toBe(true)  // el catálogo, explícito en la matriz
    expect(state.settings).toBe(false)          // el padre NO: módulo completo no prometido
    expect(state['settings.locks']).toBe(false)
    expect(state['settings.gateways']).toBe(false)
    expect(state['settings.auto-messages']).toBe(false)
  })

  it('essential también puede gestionar habitaciones (mismo bug de clase)', async () => {
    const state = await stateFor('plan-essential')
    expect(state['settings.rooms']).toBe(true)
    expect(state.settings).toBe(false) // sin over-grant del padre
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

  // R3-4a: checkout.session.completed tomaba `findMany({hotelId})[0]` sin orden — con varias
  // filas (doble alta / migración) parcheaba una distinta de la que resuelve el gate. Mismo
  // orden determinista que resolve-plan: primero la fila con stripeSubscriptionId.
  it('checkout.session.completed con varias filas: parchea la MISMA fila que resuelve el gate (R3-4a)', async () => {
    const hotels = [{ id: 'h1', name: 'Hotel Sol', email: 'd@h.com', plan: 'host' }]
    // Orden de inserción ADVERSO al determinista: la primera fila del findMany NO es la que gana.
    const subsRows = [
      { id: 's-trial-nueva', hotelId: 'h1', planId: 'plan-host', status: 'trialing', createdAt: '2026-09-01T00:00:00Z' },
      { id: 's-legacy-stripe', hotelId: 'h1', planId: 'plan-host', status: 'active', stripeSubscriptionId: 'sub_stripe_1', createdAt: '2026-08-01T00:00:00Z' },
    ]

    await handleStripeEvent(
      {
        subscriptionsRepo: repo(subsRows),
        hotelsRepo: repo(hotels),
        plansRepo: repo(plansTable()),
        logger: silentLogger(),
        stripe,
      },
      checkoutEvent('h1', 'plan-essential'),
    )

    expect(subsRows[1]).toMatchObject({ status: 'active', planId: 'plan-essential' }) // la que el gate resuelve
    expect(subsRows[0]).toMatchObject({ status: 'trialing', planId: 'plan-host' })    // la otra queda intacta
  })

  // R3-4b: un `updated` cuyo ítem no trae price cortaba en silencio — nadie se enteraba de
  // que el plan local dejaba de sincronizarse. WARN antes de cortar.
  it('customer.subscription.updated con price NO-string: WARN y no toca nada (R3-4b)', async () => {
    const warns: Array<{ msg: string; meta: any }> = []
    const base = silentLogger()
    const logger = { ...base, warn: (msg: string, meta?: any) => { warns.push({ msg, meta }) } } as unknown as Logger
    const updates: Array<{ id: string; patch: any }> = []
    const subsRows = [{ id: 's1', hotelId: 'h1', planId: 'plan-host', status: 'active', stripeSubscriptionId: 'sub_stripe_1' }]
    const subsRepo = { ...repo(subsRows), update: async (id: string, patch: any) => { updates.push({ id, patch }) } } as unknown as RepositoryAdapter<any>

    await handleStripeEvent(
      { subscriptionsRepo: subsRepo, hotelsRepo: repo([]), plansRepo: repo(plansTable()), logger, stripe },
      {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_stripe_1', items: { data: [{ price: {} }] } } }, // price sin id
      } as any,
    )

    expect(updates).toHaveLength(0)
    expect(warns.length).toBeGreaterThan(0)
    expect(warns[0]!.meta).toMatchObject({ stripeSubscriptionId: 'sub_stripe_1' })
  })
})
