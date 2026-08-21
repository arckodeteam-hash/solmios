// Lo que el service agrega sobre los usecases: qué planes se muestran a quien
// todavía no es cliente, y qué ve el hotel sobre su propia suscripción.
import { describe, it, expect } from 'bun:test'
import { SubscriptionsService } from '../service'
import type { RepositoryAdapter, Logger } from 'arckode-framework'

const log = { info() {}, error() {}, warn() {}, child: () => log } as unknown as Logger

function repoOf(rows: any[]): RepositoryAdapter<any> {
  return {
    findMany: async (f: any = {}) => rows.filter(r => Object.entries(f).every(([k, v]) => r[k] === v)),
    findById: async (id: string) => rows.find(r => r.id === id) ?? null,
    create: async (r: any) => { rows.push(r); return r },
    update: async (id: string, patch: any) => {
      const r = rows.find(x => x.id === id)
      if (r) Object.assign(r, patch)
      return r
    },
  } as unknown as RepositoryAdapter<any>
}

const PLANS = [
  { id: 'p2', name: 'Pro', slug: 'pro', price: 99, currency: 'USD', description: 'x', features: ['a'], isActive: 1, sortOrder: 2, limits: { rooms: 30 }, modules: ['x'] },
  { id: 'p1', name: 'Starter', slug: 'starter', price: 49, currency: 'USD', description: 'y', features: [], isActive: 1, sortOrder: 1, limits: { rooms: 10 }, modules: [] },
  { id: 'p9', name: 'Viejo', slug: 'old', price: 10, currency: 'USD', isActive: 0, sortOrder: 0 },
]

function setup(subs: any[] = [], hotels: any[] = [{ id: 'h1', status: 'active' }]) {
  return new SubscriptionsService(
    repoOf(subs), repoOf(hotels), repoOf([]), repoOf([]), repoOf([...PLANS]), repoOf([]), undefined, log,
  )
}

describe('SubscriptionsService.publicPlans', () => {
  it('muestra solo los activos, ordenados', async () => {
    const plans = await setup().publicPlans()
    expect(plans.map(p => p.slug)).toEqual(['starter', 'pro'])
  })

  it('no filtra `modules` hacia afuera, pero sí publica los topes', async () => {
    const [plan] = await setup().publicPlans()
    // `modules` es cómo se aplica el plan puertas adentro: no sale.
    expect(plan).not.toHaveProperty('modules')
    // CFG-1: `limits` SÍ sale — es lo que el visitante compara, y tenerlo hardcodeado en el
    // frontend hacía que la landing contradijera a la tabla ("Hasta 50 habitaciones" vs rooms:30).
    expect(plan.limits).toEqual({ rooms: 10, roomsUnlimited: false })
    expect(plan).toMatchObject({ name: 'Starter', price: 49 })
  })

  it('recorta los topes a lo público y aguanta un JSON roto', async () => {
    const svc = new SubscriptionsService(
      repoOf([]), repoOf([{ id: 'h1', status: 'active' }]), repoOf([]), repoOf([]),
      repoOf([
        { id: 'p1', name: 'A', slug: 'a', price: 1, currency: 'USD', isActive: 1, sortOrder: 1, limits: '{"rooms":30,"users":2,"secreto":"x"}' },
        { id: 'p2', name: 'B', slug: 'b', price: 2, currency: 'USD', isActive: 1, sortOrder: 2, limits: 'no-es-json' },
      ]),
      repoOf([]), undefined, log,
    )
    const plans = await svc.publicPlans()
    // `roomsUnlimited` lo resuelve el servidor contra `UNLIMITED_LIMIT_SENTINEL` (CFG-2).
    expect(plans[0].limits).toEqual({ rooms: 30, roomsUnlimited: false, users: 2 })
    expect(plans[1].limits).toEqual({})
  })
})

describe('SubscriptionsService.statusOf', () => {
  it('en prueba: informa cuántos días quedan y que puede trabajar', async () => {
    const trialEndsAt = new Date(Date.now() + 3 * 86_400_000).toISOString()
    const st = await setup([{ id: 's1', hotelId: 'h1', status: 'trialing', trialEndsAt }]).statusOf('h1')
    expect(st.allowed).toBe(true)
    expect(st.status).toBe('trialing')
    expect(st.daysLeft).toBeGreaterThan(0)
  })

  it('prueba vencida: no puede trabajar y dice por qué', async () => {
    const trialEndsAt = new Date(Date.now() - 86_400_000).toISOString()
    const st = await setup([{ id: 's1', hotelId: 'h1', status: 'trialing', trialEndsAt }]).statusOf('h1')
    expect(st.allowed).toBe(false)
    expect(st.reason).toBe('trial_expired')
  })

  it('hotel viejo sin suscripción: sigue trabajando', async () => {
    const st = await setup([]).statusOf('h1')
    expect(st.allowed).toBe(true)
    expect(st.status).toBe('none')
  })
})

describe('SubscriptionsService.signup', () => {
  it('crea la cuenta y devuelve cuándo termina la prueba', async () => {
    const svc = setup()
    const res = await svc.signup({
      hotelName: 'Hotel Nuevo', email: 'nuevo@ejemplo.com', password: 'Clave12345',
    })
    expect(res.hotelId).toBeTruthy()
    expect(res.userId).toBeTruthy()
    expect(new Date(res.trialEndsAt).getTime()).toBeGreaterThan(Date.now())
  })
})

// GH-30.2 — El orden de los planes es lo primero que ve alguien que todavía no es cliente.
// `sortOrder` es un campo cargado a mano: cuando se repite, o cuando nadie lo cargó y todos
// caen a 0, el orden pasaba a ser el que devolviera la base (arbitrario). Eso produjo en
// producción: Host $29 → Starter $49 → Enterprise $199 → Professional $123 → Essential $99 →
// Ultra $0. El desempate por precio hace que un `sortOrder` mal cargado degrade a algo
// comprensible en vez de a ruido.
describe('SubscriptionsService.publicPlans — orden estable', () => {
  const active = (over: any) => ({ currency: 'USD', description: '', features: [], isActive: 1, ...over })
  const slugs = (plans: any[]) => plans.map((p: any) => p.slug)
  const serviceWith = (plans: any[]) => new SubscriptionsService(
    repoOf([]), repoOf([{ id: 'h1' }]), repoOf([]), repoOf([]), repoOf(plans), repoOf([]), undefined, log,
  )

  it('(a) con sortOrder distintos manda sortOrder, aunque el precio diga otra cosa', async () => {
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: 1 }),
      active({ id: 'b', name: 'Host', slug: 'host', price: 29, sortOrder: 2 }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['enterprise', 'host'])
  })

  it('(b) con sortOrder iguales desempata el precio ascendente', async () => {
    // Cargados a propósito de mayor a menor: un sort estable sin desempate los dejaría así.
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: 0 }),
      active({ id: 'b', name: 'Professional', slug: 'professional', price: 99, sortOrder: 0 }),
      active({ id: 'c', name: 'Host', slug: 'host', price: 29, sortOrder: 0 }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['host', 'professional', 'enterprise'])
  })

  it('(c) sin sortOrder (ausente o null) manda el precio', async () => {
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: null }),
      active({ id: 'b', name: 'Starter', slug: 'starter', price: 49 }),
      active({ id: 'c', name: 'Ultra', slug: 'ultra', price: 0, sortOrder: null }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['ultra', 'starter', 'enterprise'])
  })

  // CFG-2: "sin tope" lo resuelve el SERVIDOR contra `UNLIMITED_LIMIT_SENTINEL`. El frontend tenía
  // su propia copia del 9999: subir el centinela del seed dejaba la landing anunciando
  // "Hasta 99999 habitaciones".
  it('publica `roomsUnlimited` ya resuelto contra el centinela del seed', async () => {
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: 1, limits: JSON.stringify({ rooms: 9999, users: 9999 }) }),
      active({ id: 'b', name: 'Starter', slug: 'starter', price: 49, sortOrder: 0, limits: { rooms: 30, users: 2 } }),
    ]).publicPlans()
    expect(plans.map((p: any) => p.limits)).toEqual([
      { rooms: 30, roomsUnlimited: false, users: 2 },
      { rooms: 9999, roomsUnlimited: true, users: 9999 },
    ])
  })

  it('compara el precio como número, no como texto', async () => {
    // '99' < '349' lexicográficamente, pero 99 < 349 también; el caso que delata la
    // comparación de strings es '349' < '99'. Si el driver devolviera el precio como
    // texto, un orden lexicográfico pondría Enterprise ($349) antes que Host ($99).
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: '349', sortOrder: 0 }),
      active({ id: 'b', name: 'Host', slug: 'host', price: '99', sortOrder: 0 }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['host', 'enterprise'])
  })

  it('con sortOrder y precio empatados el orden sigue siendo estable, no el de la base', async () => {
    const rows = [
      active({ id: 'a', name: 'Zafiro', slug: 'zafiro', price: 99, sortOrder: 0 }),
      active({ id: 'b', name: 'Ambar', slug: 'ambar', price: 99, sortOrder: 0 }),
    ]
    expect(slugs(await serviceWith(rows).publicPlans())).toEqual(['ambar', 'zafiro'])
    expect(slugs(await serviceWith([...rows].reverse()).publicPlans())).toEqual(['ambar', 'zafiro'])
  })
})
