// Lo que el service agrega sobre los usecases: qué planes se muestran a quien
// todavía no es cliente, y qué ve el hotel sobre su propia suscripción.
import { describe, it, expect } from 'bun:test'
import { SubscriptionsService } from '../service'
import type { RepositoryAdapter, Logger } from 'arckode-framework'

const log = { info() {}, error() {}, warn() {}, child: () => log } as unknown as Logger

function repoOf(rows: any[]): RepositoryAdapter<any> {
  return {
    // Honra el CONTRATO del repo: `options.orderBy` se aplica como lo hace el ORM real en SQL
    // (ver tests/public-plans.test.ts, que lo prueba contra SQLite de verdad).
    findMany: async (f: any = {}, options?: any) => {
      const out = rows.filter(r => Object.entries(f).every(([k, v]) => r[k] === v))
      const clauses: any[] = options?.orderBy ? (Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy]) : []
      for (const { field, dir = 'ASC' } of [...clauses].reverse()) {
        out.sort((x: any, y: any) => {
          const a = x[field], b = y[field]
          const numeric = Number.isFinite(Number(a)) && Number.isFinite(Number(b))
          const cmp = numeric ? Number(a) - Number(b) : String(a ?? '').localeCompare(String(b ?? ''))
          return dir === 'DESC' ? -cmp : cmp
        })
      }
      return out
    },
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

// #30 — El orden de los planes es lo primero que ve alguien que todavía no es cliente.
// Decisión del dueño: precio ASC en TODAS las superficies; el orden lo impone el backend en
// la query (`shared/utils/plans-order.ts`: price ASC, slug ASC) y ninguna UI re-ordena.
// Antes mandaba `sortOrder`, un campo cargado a mano, y en producción la lista salía
// Host $29 → Starter $49 → Enterprise $199 → Professional $123 → Essential $99 → Ultra $0.
// Reversión posterior (pedido del cliente): los planes a cotización (`price <= 0`, sin número,
// "A cotización"/"Consultar") van AL FINAL, no primero — ver `listPublicPlans`.
describe('SubscriptionsService.publicPlans — orden por precio (#30)', () => {
  const active = (over: any) => ({ currency: 'USD', description: '', features: [], isActive: 1, ...over })
  const slugs = (plans: any[]) => plans.map((p: any) => p.slug)
  const serviceWith = (plans: any[]) => new SubscriptionsService(
    repoOf([]), repoOf([{ id: 'h1' }]), repoOf([]), repoOf([]), repoOf(plans), repoOf([]), undefined, log,
  )

  it('(a) `sortOrder` ya NO manda: manda el precio, aunque el sortOrder diga otra cosa', async () => {
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: 1 }),
      active({ id: 'b', name: 'Host', slug: 'host', price: 29, sortOrder: 2 }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['host', 'enterprise'])
  })

  it('(b) del más barato al más caro, sin importar el sortOrder', async () => {
    // Cargados a propósito de mayor a menor: un orden por sortOrder los dejaría al revés.
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: 0 }),
      active({ id: 'b', name: 'Professional', slug: 'professional', price: 99, sortOrder: 0 }),
      active({ id: 'c', name: 'Host', slug: 'host', price: 29, sortOrder: 0 }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['host', 'professional', 'enterprise'])
  })

  it('(c) sin sortOrder (ausente o null) manda el precio igual, y el de cotización ($0) va al final', async () => {
    const plans = await serviceWith([
      active({ id: 'a', name: 'Enterprise', slug: 'enterprise', price: 199, sortOrder: null }),
      active({ id: 'b', name: 'Starter', slug: 'starter', price: 49 }),
      active({ id: 'c', name: 'Ultra', slug: 'ultra', price: 0, sortOrder: null }),
    ]).publicPlans()
    expect(slugs(plans)).toEqual(['starter', 'enterprise', 'ultra'])
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

  it('con precio empatado el orden es determinista por slug ASC, no el de la base', async () => {
    const rows = [
      active({ id: 'a', name: 'Zafiro', slug: 'zafiro', price: 99, sortOrder: 0 }),
      active({ id: 'b', name: 'Ambar', slug: 'ambar', price: 99, sortOrder: 0 }),
    ]
    expect(slugs(await serviceWith(rows).publicPlans())).toEqual(['ambar', 'zafiro'])
    expect(slugs(await serviceWith([...rows].reverse()).publicPlans())).toEqual(['ambar', 'zafiro'])
  })
})

// #28 — la política de la plataforma decide qué promete el alta y a quién deja entrar. Lo que se
// prueba acá es el cableado del service: que el flag llegue al resultado del alta y que retomar
// el pago no sea una puerta de atrás.
describe('SubscriptionsService — política de tarjeta en la prueba (#28)', () => {
  it('sin el puerto cableado, el alta no exige tarjeta y la política pública lo dice', async () => {
    const svc = setup()
    expect(await svc.signupPolicy()).toEqual({ requireCardOnTrial: false })
    expect(await svc.publicSignupPolicy()).toEqual({ requireCardOnTrial: false, trialDays: 7 })
  })

  it('con la política prendida, la política pública la refleja junto con los días de prueba', async () => {
    const svc = setup()
    svc.setPlatformSettingsDeps(async () => ({ requireCardOnTrial: true, enabled: false, durationDays: 90 }))
    expect(await svc.publicSignupPolicy()).toEqual({ requireCardOnTrial: true, trialDays: 7 })
  })

  it('si la config explota, la política pública cae al camino conservador (no exige tarjeta)', async () => {
    const svc = setup()
    svc.setPlatformSettingsDeps(async () => { throw new Error('configuration caída') })
    expect(await svc.signupPolicy()).toEqual({ requireCardOnTrial: false })
  })

  it('retomar el pago sin verificador cableado no procede', async () => {
    const svc = setup()
    expect(svc.resumeCheckout('a@b.com', 'x', 'https://app.test')).rejects.toThrow()
  })

  it('credenciales que no validan no devuelven checkout (ni dicen si la cuenta existe)', async () => {
    const svc = setup()
    svc.setPlatformSettingsDeps(async () => ({ requireCardOnTrial: true, enabled: false, durationDays: 90 }))
    svc.setOwnerVerifier(async () => null)
    expect(svc.resumeCheckout('a@b.com', 'mala', 'https://app.test')).rejects.toThrow()
  })

  it('credenciales válidas pero SIN pago pendiente tampoco abren un checkout', async () => {
    // Trial con la tarjeta ya cargada: no hay nada que retomar.
    const svc = setup([
      { id: 's1', hotelId: 'h1', planId: 'p1', status: 'trialing', trialEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), paymentMethodAddedAt: '2026-08-01T00:00:00Z' },
    ])
    svc.setPlatformSettingsDeps(async () => ({ requireCardOnTrial: true, enabled: false, durationDays: 90 }))
    svc.setOwnerVerifier(async () => ({ hotelId: 'h1' }))
    expect(svc.resumeCheckout('a@b.com', 'ok', 'https://app.test')).rejects.toThrow(/pago pendiente/i)
  })

  it('con la prueba vencida tampoco se retoma: ya no es un alta a medias', async () => {
    const svc = setup([
      { id: 's1', hotelId: 'h1', planId: 'p1', status: 'trialing', trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() },
    ])
    svc.setPlatformSettingsDeps(async () => ({ requireCardOnTrial: true, enabled: false, durationDays: 90 }))
    svc.setOwnerVerifier(async () => ({ hotelId: 'h1' }))
    expect(svc.resumeCheckout('a@b.com', 'ok', 'https://app.test')).rejects.toThrow(/pago pendiente/i)
  })
})
