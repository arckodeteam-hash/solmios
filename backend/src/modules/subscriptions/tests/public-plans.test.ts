// public-plans.test.ts — #30: el orden de los planes lo impone el BACKEND en la query.
//
// El bug visto en producción: `sortOrder` (cargado a mano desde /admin) mandaba en el orden y
// la lista salía Host $29 → Starter $49 → Enterprise $199 → Professional $123 → Essential $99
// → Ultra $0. Decisión del dueño: precio ASC en TODAS las superficies, sin campos nuevos —
// el precio es la clave natural de orden.
//
// Se testea contra el ORM REAL (SQLite in-memory, mismo patrón que
// restaurant/tests/menu-items-f6-persistence.test.ts) porque el orden ahora vive en el
// `ORDER BY` de la query: con un repo fake que ignora `options` este test no probaría nada.
// Las filas se insertan en orden INVERSO al esperado, así que sólo un ORDER BY real puede
// devolver la progresión de menor a mayor.
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter, RepositoryAdapter } from 'arckode-framework'
import { registerSharedModels } from '../../../shared/models'
import { listPublicPlans } from '../usecases/public-plans'
import { PLANS_PRICE_ORDER } from '../../../shared/utils/plans-order'

interface TestDb extends DbAdapter { connect(): Promise<void> }

/** Seed de `scripts/create-plans-table.ts` (precios reales), insertado al revés. */
const SEED_PLANS = [
  { id: 'plan-enterprise', name: 'Enterprise', slug: 'enterprise', price: 199, currency: 'USD', isActive: 1, sortOrder: 2 },
  { id: 'plan-professional', name: 'Professional', slug: 'professional', price: 99, currency: 'USD', isActive: 1, sortOrder: 1 },
  { id: 'plan-essential', name: 'Essential', slug: 'essential', price: 99, currency: 'USD', isActive: 1, sortOrder: 3 },
  { id: 'plan-starter', name: 'Starter', slug: 'starter', price: 49, currency: 'USD', isActive: 1, sortOrder: 0 },
  { id: 'plan-host', name: 'Host', slug: 'host', price: 29, currency: 'USD', isActive: 1, sortOrder: -1 },
  { id: 'plan-ultra', name: 'Ultra', slug: 'ultra', price: 0, currency: 'USD', isActive: 1, sortOrder: 4 },
]

async function withPlansRepo(fn: (repo: OrmRepository<any>) => Promise<void>): Promise<void> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  const orm = new ORM(db)
  registerSharedModels(orm)
  await orm.migrate()
  const repo = new OrmRepository<any>(orm, 'Plans')
  for (const p of SEED_PLANS) await repo.create({ ...p } as any)
  try {
    await fn(repo)
  } finally {
    await db.close?.()
  }
}

describe('listPublicPlans — #30: precio ASC, del más barato al más caro, cotización al final', () => {
  it('devuelve los planes del seed en [host, starter, essential, professional, enterprise, ultra]', async () => {
    await withPlansRepo(async (repo) => {
      const plans = await listPublicPlans(repo)
      expect(plans.map((p) => p.slug)).toEqual(['host', 'starter', 'essential', 'professional', 'enterprise', 'ultra'])
      expect(plans.map((p) => p.price)).toEqual([29, 49, 99, 99, 199, 0])
    })
  })

  it('el $0 (ultra, a cotización) sale último — pedido del cliente sobre #30', async () => {
    await withPlansRepo(async (repo) => {
      const plans = await listPublicPlans(repo)
      const last = plans[plans.length - 1]
      expect(last?.slug).toBe('ultra')
      expect(last?.price).toBe(0)
    })
  })

  it('empate de precio desempata por slug ASC — essential antes que professional ($99/$99)', async () => {
    await withPlansRepo(async (repo) => {
      const plans = await listPublicPlans(repo)
      const essential = plans.findIndex((p) => p.slug === 'essential')
      const professional = plans.findIndex((p) => p.slug === 'professional')
      expect(essential).toBeGreaterThan(-1)
      expect(professional).toBe(essential + 1)
    })
  })

  it('`sortOrder` ya NO manda: enterprise (sortOrder 2, $199) va penúltimo, no tercero — solo el de cotización va después', async () => {
    await withPlansRepo(async (repo) => {
      const plans = await listPublicPlans(repo)
      expect(plans[plans.length - 2]?.slug).toBe('enterprise')
    })
  })

  it('con más de un plan a cotización, ambos van al final y mantienen slug ASC entre sí', async () => {
    await withPlansRepo(async (repo) => {
      await repo.create({
        id: 'plan-a-medida', name: 'A Medida', slug: 'a-medida', price: 0, currency: 'USD',
        isActive: 1, sortOrder: -5,
      } as any)
      const plans = await listPublicPlans(repo)
      expect(plans.slice(-2).map((p) => p.slug)).toEqual(['a-medida', 'ultra'])
    })
  })

  it('sigue filtrando isActive: un plan inactivo no aparece', async () => {
    await withPlansRepo(async (repo) => {
      await repo.create({
        id: 'plan-oculto', name: 'Oculto', slug: 'oculto', price: 10, currency: 'USD',
        isActive: 0, sortOrder: -10,
      } as any)
      const plans = await listPublicPlans(repo)
      expect(plans.some((p) => p.slug === 'oculto')).toBe(false)
    })
  })

  it('el orden se pide en la query: findMany recibe PLANS_PRICE_ORDER (price ASC, slug ASC)', async () => {
    const calls: Array<{ filters: Record<string, unknown>; options?: any }> = []
    const fakeRepo = {
      findMany: async (filters: Record<string, unknown>, options?: any) => {
        calls.push({ filters, options })
        return []
      },
    } as unknown as RepositoryAdapter<any>
    await listPublicPlans(fakeRepo)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.filters).toEqual({ isActive: 1 })
    expect(calls[0]!.options?.orderBy).toEqual(PLANS_PRICE_ORDER)
    expect(PLANS_PRICE_ORDER).toEqual([{ field: 'price', dir: 'ASC' }, { field: 'slug', dir: 'ASC' }])
  })
})
