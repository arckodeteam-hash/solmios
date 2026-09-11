// restaurant/tests/order-number-dedupe.test.ts — #208: los `CMD-{año}-NNNN` duplicados que dejó el
// numerador viejo (#206) se renumeran ANTES de crear el UNIQUE (hotelId, number), y el índice
// después SÍ se crea. Antes migrate-db.ts se tragaba el fallo del índice con un console.log.
//
// Tabla creada por el ORM real (registerRestaurantModels + migrate) sobre SQLite in-memory: el script
// corre contra los MISMOS nombres de columna que en producción, y el `CREATE UNIQUE INDEX` de abajo
// es literalmente el de migrate-db.ts.
import { describe, it, expect } from 'bun:test'
import { ORM } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerRestaurantModels } from '../model'
import { formatOrderNumber } from '../usecases/order-number'
import { dedupeRestaurantOrderNumbers, sortOldestFirst } from '../../../../scripts/dedupe-restaurant-order-numbers'

const UNIQUE_INDEX_SQL = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_orders_hotel_number ON restaurant_orders(hotelId, number)'
const YEAR = 2026

interface Row { id: string; hotelId: string; number: string | null; openedAt?: string | null; createdAt?: string | null }

async function withDb(rows: Row[], fn: (db: SqliteAdapter) => Promise<void>): Promise<void> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerRestaurantModels(orm)
  await orm.migrate()
  for (const r of rows) {
    await db.run(
      'INSERT INTO restaurant_orders (id, hotelId, number, type, status, openedAt, createdAt) VALUES (?,?,?,?,?,?,?)',
      [r.id, r.hotelId, r.number, 'dine_in', 'paid', r.openedAt ?? null, r.createdAt ?? null],
    )
  }
  try { await fn(db) } finally { await db.close?.() }
}

const numbers = async (db: SqliteAdapter, hotelId: string): Promise<Record<string, string | null>> => {
  const rows = (await db.query('SELECT id, number FROM restaurant_orders WHERE hotelId = ? ORDER BY id', [hotelId])) as Array<{ id: string; number: string | null }>
  return Object.fromEntries(rows.map((r) => [r.id, r.number]))
}

describe('#208 — dedupeRestaurantOrderNumbers', () => {
  it('la comanda más vieja conserva el número; las siguientes pasan a -D1, -D2 en orden de apertura', async () => {
    const n7 = formatOrderNumber(YEAR, 7)
    await withDb([
      { id: 'o-new', hotelId: 'h1', number: n7, openedAt: '2026-03-01T12:00:00.000Z' },
      { id: 'o-old', hotelId: 'h1', number: n7, openedAt: '2026-03-01T10:00:00.000Z' },
      { id: 'o-mid', hotelId: 'h1', number: n7, openedAt: '2026-03-01T11:00:00.000Z' },
      { id: 'o-8', hotelId: 'h1', number: formatOrderNumber(YEAR, 8), openedAt: '2026-03-01T13:00:00.000Z' },
    ], async (db) => {
      const res = await dedupeRestaurantOrderNumbers(db)
      expect(res.groups).toBe(1)
      expect(res.renumbered.map((r) => [r.id, r.from, r.to])).toEqual([
        ['o-mid', n7, `${n7}-D1`],
        ['o-new', n7, `${n7}-D2`],
      ])
      expect(await numbers(db, 'h1')).toEqual({ 'o-8': formatOrderNumber(YEAR, 8), 'o-mid': `${n7}-D1`, 'o-new': `${n7}-D2`, 'o-old': n7 })
    })
  })

  it('después del dedup el UNIQUE (hotelId, number) SE CREA; antes, fallaba', async () => {
    const n1 = formatOrderNumber(YEAR, 1)
    await withDb([
      { id: 'a', hotelId: 'h1', number: n1, openedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', hotelId: 'h1', number: n1, openedAt: '2026-01-02T00:00:00.000Z' },
    ], async (db) => {
      await expect(async () => db.run(UNIQUE_INDEX_SQL)).toThrow(/UNIQUE/i)
      await dedupeRestaurantOrderNumbers(db)
      await db.run(UNIQUE_INDEX_SQL)
      // Con el índice puesto, un duplicado nuevo ya no entra.
      await expect(async () => db.run(
        'INSERT INTO restaurant_orders (id, hotelId, number, type, status) VALUES (?,?,?,?,?)', ['c', 'h1', n1, 'dine_in', 'open'],
      )).toThrow(/UNIQUE/i)
    })
  })

  it('idempotente: la segunda corrida no encuentra grupos ni escribe', async () => {
    const n1 = formatOrderNumber(YEAR, 1)
    await withDb([
      { id: 'a', hotelId: 'h1', number: n1, openedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', hotelId: 'h1', number: n1, openedAt: '2026-01-02T00:00:00.000Z' },
    ], async (db) => {
      await dedupeRestaurantOrderNumbers(db)
      const after = await numbers(db, 'h1')
      const again = await dedupeRestaurantOrderNumbers(db)
      expect(again).toEqual({ groups: 0, renumbered: [] })
      expect(await numbers(db, 'h1')).toEqual(after)
    })
  })

  it('el mismo número en DOS hoteles no es duplicado (el correlativo es por hotel)', async () => {
    const n1 = formatOrderNumber(YEAR, 1)
    await withDb([
      { id: 'a', hotelId: 'h1', number: n1 },
      { id: 'b', hotelId: 'h2', number: n1 },
    ], async (db) => {
      expect(await dedupeRestaurantOrderNumbers(db)).toEqual({ groups: 0, renumbered: [] })
      await db.run(UNIQUE_INDEX_SQL)
    })
  })

  it('`number` NULL no cuenta como duplicado y no se toca', async () => {
    await withDb([
      { id: 'a', hotelId: 'h1', number: null },
      { id: 'b', hotelId: 'h1', number: null },
    ], async (db) => {
      expect(await dedupeRestaurantOrderNumbers(db)).toEqual({ groups: 0, renumbered: [] })
      expect(await numbers(db, 'h1')).toEqual({ a: null, b: null })
    })
  })

  it('si `-D1` ya existe (corrida anterior a medias), salta al siguiente sufijo libre', async () => {
    const n5 = formatOrderNumber(YEAR, 5)
    await withDb([
      { id: 'a', hotelId: 'h1', number: n5, openedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', hotelId: 'h1', number: n5, openedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'c', hotelId: 'h1', number: `${n5}-D1`, openedAt: '2026-01-03T00:00:00.000Z' },
    ], async (db) => {
      const res = await dedupeRestaurantOrderNumbers(db)
      expect(res.renumbered).toEqual([{ id: 'b', hotelId: 'h1', from: n5, to: `${n5}-D2` }])
      await db.run(UNIQUE_INDEX_SQL)
    })
  })

  it('sin openedAt cae a createdAt, y sin ninguno desempata por id (determinista)', () => {
    const sorted = sortOldestFirst([
      { id: 'z', opened_at: null, created_at: null },
      { id: 'b', opened_at: null, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'a', opened_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-05T00:00:00.000Z' },
      { id: 'y', opened_at: null, created_at: null },
    ])
    expect(sorted.map((r) => r.id)).toEqual(['y', 'z', 'a', 'b'])
  })
})
