// huespedes/tests/merge-duplicate-guests.test.ts — #273 (MR-08): fusión de fichas de `guests`
// duplicadas por (hotelId, email normalizado). Hasta #273 cada reserva creaba una ficha nueva;
// `scripts/merge-duplicate-guests.ts` junta las históricas en la más antigua y reapunta todo lo
// que las referenciaba. Mismo patrón que restaurant/tests/restaurant-pay-backfill.test.ts: SQLite
// in-memory con CREATE TABLE mínimos (sólo las columnas que el script usa).
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { mergeDuplicateGuests, planGuestMerges, GUEST_ID_TABLES } from '../../../../scripts/merge-duplicate-guests'

interface TestDb extends DbAdapter { connect(): Promise<void> }

interface GuestSeed {
  id: string
  hotelId: string
  email: string | null
  name?: string
  phone?: string | null
  createdAt: string
  totalStays?: number
  totalSpent?: number
  loyaltyPoints?: number
}

async function makeDb(guests: GuestSeed[]): Promise<TestDb> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  await db.run(`CREATE TABLE guests (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, hotelId TEXT NOT NULL,
    loyaltyPoints REAL DEFAULT 0, totalStays REAL DEFAULT 0, totalSpent REAL DEFAULT 0,
    createdAt TEXT, updatedAt TEXT)`)
  for (const t of GUEST_ID_TABLES) {
    await db.run(`CREATE TABLE ${t} (id TEXT PRIMARY KEY, hotelId TEXT, guestId TEXT)`)
  }
  await db.run(`CREATE TABLE groups (id TEXT PRIMARY KEY, hotelId TEXT, leadGuestId TEXT)`)
  for (const g of guests) {
    await db.run(
      `INSERT INTO guests (id, name, email, phone, hotelId, loyaltyPoints, totalStays, totalSpent, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [g.id, g.name ?? '', g.email, g.phone ?? null, g.hotelId, g.loyaltyPoints ?? 0, g.totalStays ?? 0, g.totalSpent ?? 0, g.createdAt, g.createdAt],
    )
  }
  return db
}

const ref = (db: TestDb, table: string, id: string, guestId: string, column = 'guestId') =>
  db.run(`INSERT INTO ${table} (id, hotelId, ${column}) VALUES (?,?,?)`, [id, 'h1', guestId])

const count = async (db: TestDb, sql: string, params: unknown[] = []): Promise<number> => {
  const rows = (await db.query(`SELECT COUNT(*) AS c FROM ${sql}`, params)) as Array<{ c: number }>
  return Number(rows[0]!.c)
}

const guest = async (db: TestDb, id: string) =>
  ((await db.query(`SELECT * FROM guests WHERE id = ?`, [id])) as Array<Record<string, unknown>>)[0]

/** Tres fichas de Ana en h1 — distinta mayúscula/espacios — más una de Bruno que no se toca. */
const ANA = (): GuestSeed[] => [
  { id: 'g-new', hotelId: 'h1', email: 'ANA@mail.com', name: 'Ana Pérez', phone: '+18095550000', createdAt: '2026-03-01T00:00:00.000Z', totalStays: 1, totalSpent: 100, loyaltyPoints: 10 },
  { id: 'g-old', hotelId: 'h1', email: 'Ana@Mail.com', name: '', phone: null, createdAt: '2026-01-01T00:00:00.000Z', totalStays: 2, totalSpent: 250.5, loyaltyPoints: 25 },
  { id: 'g-mid', hotelId: 'h1', email: 'ana@mail.com ', name: 'A. Perez', phone: '809-555-1111', createdAt: '2026-02-01T00:00:00.000Z', totalStays: 3, totalSpent: 49.5, loyaltyPoints: 5 },
  { id: 'g-bruno', hotelId: 'h1', email: 'bruno@mail.com', name: 'Bruno', createdAt: '2026-01-15T00:00:00.000Z', totalStays: 7, totalSpent: 700 },
]

async function seedRefs(db: TestDb): Promise<void> {
  await ref(db, 'reservations', 'r1', 'g-old')
  await ref(db, 'reservations', 'r2', 'g-mid')
  await ref(db, 'reservations', 'r3', 'g-new')
  await ref(db, 'reservations', 'r4', 'g-bruno')
  await ref(db, 'folios', 'f1', 'g-mid')
  await ref(db, 'invoices', 'i1', 'g-new')
  await ref(db, 'invoices', 'i2', 'g-mid')
  await ref(db, 'payments', 'p1', 'g-new')
  await ref(db, 'loyalty_transactions', 'l1', 'g-mid')
  await ref(db, 'groups', 'grp1', 'g-new', 'leadGuestId')
}

describe('merge-duplicate-guests — --dry (apply: false)', () => {
  it('lista 1 grupo con 2 duplicadas de ana@mail.com, con totales y filas por tabla, y NO escribe', async () => {
    const db = await makeDb(ANA())
    await seedRefs(db)

    const result = await mergeDuplicateGuests(db, { apply: false })
    expect(result.merged).toBe(0)
    expect(result.repointed).toEqual({})
    expect(result.groups).toHaveLength(1)

    const g = result.groups[0]!
    expect(g.hotelId).toBe('h1')
    expect(g.email).toBe('ana@mail.com')
    expect(g.canonicalId).toBe('g-old')                      // el createdAt más viejo
    expect(g.duplicateIds).toEqual(['g-mid', 'g-new'])       // ordenadas por antigüedad
    expect(g.totalStays).toBe(6)
    expect(g.totalSpent).toBe(400)
    expect(g.loyaltyPoints).toBe(40)
    expect(g.fill).toEqual({ name: 'A. Perez', phone: '809-555-1111' }) // primer duplicado que los tiene
    expect(g.repoint).toEqual({
      'reservations.guestId': 2,
      'folios.guestId': 1,
      'invoices.guestId': 2,
      'loyalty_transactions.guestId': 1,
      'payments.guestId': 1,
      'groups.leadGuestId': 1,
    })

    // Nada cambió.
    expect(await count(db, 'guests')).toBe(4)
    expect(await count(db, 'reservations WHERE guestId = ?', ['g-old'])).toBe(1)
    expect((await guest(db, 'g-old'))!.totalStays).toBe(2)
    expect((await guest(db, 'g-old'))!.name).toBe('')
  })

  it('planGuestMerges devuelve el mismo plan que --dry', async () => {
    const db = await makeDb(ANA())
    const plan = await planGuestMerges(db)
    expect(plan.map((g) => [g.canonicalId, g.duplicateIds])).toEqual([['g-old', ['g-mid', 'g-new']]])
  })
})

describe('merge-duplicate-guests — --apply', () => {
  it('deja 1 ficha (la más vieja) con las sumas, reapunta todo y no pisa lo cargado', async () => {
    const db = await makeDb(ANA())
    await seedRefs(db)

    const result = await mergeDuplicateGuests(db, { apply: true })
    expect(result.merged).toBe(1)
    expect(result.repointed).toEqual({
      'reservations.guestId': 2,
      'folios.guestId': 1,
      'invoices.guestId': 2,
      'loyalty_transactions.guestId': 1,
      'payments.guestId': 1,
      'groups.leadGuestId': 1,
    })

    // Una sola ficha de Ana; Bruno intacto.
    expect(await count(db, 'guests')).toBe(2)
    expect(await count(db, `guests WHERE LOWER(TRIM(email)) = 'ana@mail.com'`)).toBe(1)
    const ana = (await guest(db, 'g-old'))!
    expect(ana.totalStays).toBe(6)
    expect(ana.totalSpent).toBe(400)
    expect(ana.loyaltyPoints).toBe(40)
    expect(ana.email).toBe('ana@mail.com')
    expect(ana.name).toBe('A. Perez')          // estaba vacío → se completó con el primer duplicado
    expect(ana.phone).toBe('809-555-1111')
    expect(ana.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    expect(await guest(db, 'g-mid')).toBeUndefined()
    expect(await guest(db, 'g-new')).toBeUndefined()
    const bruno = (await guest(db, 'g-bruno'))!
    expect(bruno.totalStays).toBe(7)

    // Ninguna referencia apunta a un id borrado.
    for (const t of ['reservations', 'folios', 'invoices', 'payments', 'loyalty_transactions']) {
      expect(await count(db, `${t} WHERE guestId NOT IN (SELECT id FROM guests)`)).toBe(0)
    }
    expect(await count(db, `groups WHERE leadGuestId NOT IN (SELECT id FROM guests)`)).toBe(0)
    expect(await count(db, 'reservations WHERE guestId = ?', ['g-old'])).toBe(3)
    expect(await count(db, 'reservations WHERE guestId = ?', ['g-bruno'])).toBe(1)
    expect(await count(db, 'groups WHERE leadGuestId = ?', ['g-old'])).toBe(1)
  })

  it('name/phone ya cargados en la canónica no se pisan', async () => {
    const db = await makeDb([
      { id: 'c', hotelId: 'h1', email: 'x@y.com', name: 'Canónica', phone: '+1111', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'd', hotelId: 'h1', email: 'X@Y.COM', name: 'Otra', phone: '+2222', createdAt: '2026-02-01T00:00:00.000Z' },
    ])
    const result = await mergeDuplicateGuests(db, { apply: true })
    expect(result.groups[0]!.fill).toEqual({})
    const c = (await guest(db, 'c'))!
    expect(c.name).toBe('Canónica')
    expect(c.phone).toBe('+1111')
  })

  it('mismo createdAt → desempata por id (determinista)', async () => {
    const db = await makeDb([
      { id: 'b', hotelId: 'h1', email: 'x@y.com', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a', hotelId: 'h1', email: 'x@y.com', createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    const plan = await planGuestMerges(db)
    expect(plan[0]!.canonicalId).toBe('a')
  })

  it('segunda corrida → 0 grupos, 0 cambios (idempotente)', async () => {
    const db = await makeDb(ANA())
    await seedRefs(db)
    await mergeDuplicateGuests(db, { apply: true })
    const before = await guest(db, 'g-old')

    const again = await mergeDuplicateGuests(db, { apply: true })
    expect(again.groups).toHaveLength(0)
    expect(again.merged).toBe(0)
    expect(again.repointed).toEqual({})
    expect(await count(db, 'guests')).toBe(2)
    expect(await guest(db, 'g-old')).toEqual(before)
  })

  it('--hotel filtra: con dos hoteles con duplicados, hotelId h1 sólo fusiona h1', async () => {
    const db = await makeDb([
      ...ANA(),
      { id: 'h2-a', hotelId: 'h2', email: 'carla@mail.com', createdAt: '2026-01-01T00:00:00.000Z', totalStays: 1 },
      { id: 'h2-b', hotelId: 'h2', email: 'Carla@mail.com', createdAt: '2026-02-01T00:00:00.000Z', totalStays: 1 },
    ])
    const result = await mergeDuplicateGuests(db, { apply: true, hotelId: 'h1' })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]!.hotelId).toBe('h1')
    expect(await count(db, `guests WHERE hotelId = 'h1'`)).toBe(2)   // Ana + Bruno
    expect(await count(db, `guests WHERE hotelId = 'h2'`)).toBe(2)   // h2 intacto

    // Sin filtro, ahora sólo queda h2.
    const rest = await mergeDuplicateGuests(db, { apply: false })
    expect(rest.groups.map((g) => g.hotelId)).toEqual(['h2'])
  })

  it('mismo email en distinto hotel NO se fusiona', async () => {
    const db = await makeDb([
      { id: 'h1-a', hotelId: 'h1', email: 'same@mail.com', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'h2-a', hotelId: 'h2', email: 'same@mail.com', createdAt: '2026-02-01T00:00:00.000Z' },
    ])
    const result = await mergeDuplicateGuests(db, { apply: true })
    expect(result.groups).toHaveLength(0)
    expect(await count(db, 'guests')).toBe(2)
  })

  it('fichas sin email (NULL o vacío) no se agrupan entre sí', async () => {
    const db = await makeDb([
      { id: 'n1', hotelId: 'h1', email: null, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'n2', hotelId: 'h1', email: '', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'n3', hotelId: 'h1', email: '   ', createdAt: '2026-01-03T00:00:00.000Z' },
    ])
    expect(await planGuestMerges(db)).toHaveLength(0)
  })

  it('tabla inexistente (base vieja) se saltea con aviso y el resto se fusiona igual', async () => {
    const db = await makeDb(ANA())
    await db.run('DROP TABLE ai_conversations')
    const logs: string[] = []
    const result = await mergeDuplicateGuests(db, { apply: true, log: (m) => logs.push(m) })
    expect(result.skippedTables).toEqual(['ai_conversations'])
    expect(logs.some((l) => l.includes('ai_conversations'))).toBe(true)
    expect(result.merged).toBe(1)
    expect(await count(db, 'guests')).toBe(2)
  })
})
