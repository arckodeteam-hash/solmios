// anuncios/tests/audience-migration.e2e.test.ts — la columna `audience` (#106) contra una SQLite REAL.
//
// Recorre los DOS caminos por los que la columna llega a una base, como reads.e2e.test.ts:
//
//   1. Base VIEJA (tabla `announcements` sin `audience`, con filas): `orm.migrate()` (RUN_MIGRATE=1)
//      agrega la columna sin romper las filas; después el backfill de migrate-db.ts — el SQL
//      textual LEÍDO DEL FUENTE, no una copia — deja esas filas en 'hotel', que es lo que eran.
//   2. Base NUEVA: el CREATE TABLE actual de migrate-db.ts trae `DEFAULT 'hotel'`, así que una
//      fila insertada sin audience vuelve 'hotel'.
//
// Y en el medio, lo que el ORM descarta en silencio si el modelo no lo declara: un create con
// audience:'admins' tiene que releerse con 'admins'.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, unlinkSync } from 'node:fs'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAnunciosModels } from '../model'

const MIGRATE_DB_SOURCE = readFileSync(new URL('../../../../migrate-db.ts', import.meta.url), 'utf8')

/** El CREATE TABLE de announcements que corre en cada deploy, extraído del fuente. */
function currentAnnouncementsCreateSql(): string {
  const match = MIGRATE_DB_SOURCE.match(/CREATE TABLE IF NOT EXISTS announcements \([\s\S]*?\)/)
  if (!match) throw new Error('migrate-db.ts ya no crea la tabla announcements')
  return match[0]
}

/** El ADD COLUMN del deploy (addColumnIfMissing → `ALTER TABLE ... ADD COLUMN ...`), extraído del fuente. */
function audienceAddColumnSql(): string {
  const match = MIGRATE_DB_SOURCE.match(/addColumnIfMissing\('announcements',\s*'audience',\s*"([^"]+)"\)/)
  if (!match) throw new Error("migrate-db.ts ya no agrega la columna `audience` a announcements")
  return `ALTER TABLE announcements ADD COLUMN audience ${match[1]}`
}

/** El backfill del deploy, textual: las filas anteriores a #106 son del hotel. */
function audienceBackfillSql(): string {
  const match = MIGRATE_DB_SOURCE.match(/UPDATE announcements SET audience = 'hotel' WHERE audience IS NULL/)
  if (!match) throw new Error("migrate-db.ts ya no hace el backfill de `audience` a 'hotel'")
  return match[0]
}

// Mismo criterio que isAlreadyExistsError de migrate-db.ts: el ALTER es idempotente.
async function addColumnIfMissing(adapter: any, sql: string): Promise<void> {
  try {
    await adapter.run(sql)
  } catch (e) {
    const msg = String((e as Error).message).toLowerCase()
    if (!msg.includes('duplicate column') && !msg.includes('already exists')) throw e
  }
}

async function columnNames(adapter: any, table: string): Promise<string[]> {
  const rows = (await adapter.query(`PRAGMA table_info(${table})`)) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

// El schema ANTERIOR a #106, tal cual estaba en migrate-db.ts (sin `audience`).
const OLD_ANNOUNCEMENTS_CREATE_SQL = `CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, hotelId TEXT, authorId TEXT, title TEXT NOT NULL, message TEXT,
    type TEXT DEFAULT 'info', priority TEXT DEFAULT 'medium', active INTEGER DEFAULT 1,
    date TEXT, createdAt TEXT)`

const OLD_ROWS = [
  { id: 'old-1', hotelId: 'h-old', authorId: 'u-1', title: 'Del hotel', message: 'm1', type: 'warning', priority: 'high', active: 1, date: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'old-2', hotelId: null, authorId: 'u-2', title: 'Sin hotel', message: 'm2', type: 'info', priority: 'low', active: 0, date: '2026-02-01T00:00:00.000Z', createdAt: '2026-02-01T00:00:00.000Z' },
]

async function openDb(dbPath: string) {
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  return adapter
}

async function selectOld(adapter: any, id: string): Promise<Record<string, unknown>> {
  const rows = (await adapter.query('SELECT * FROM announcements WHERE id = ?', [id])) as Array<Record<string, unknown>>
  expect(rows).toHaveLength(1)
  return rows[0]!
}

function expectOldFieldsIntact(row: Record<string, unknown>, expected: (typeof OLD_ROWS)[number]) {
  for (const key of ['hotelId', 'authorId', 'title', 'message', 'type', 'priority', 'active', 'date', 'createdAt'] as const) {
    expect(row[key]).toBe(expected[key])
  }
}

const tmpPaths: string[] = []

afterAll(() => {
  for (const p of tmpPaths) {
    try { unlinkSync(p) } catch { /* tmp, best-effort */ }
  }
})

describe('announcements.audience — base VIEJA: orm.migrate + backfill de migrate-db.ts', () => {
  let adapter: any
  let orm: any

  beforeAll(async () => {
    const dbPath = `/tmp/solmios-anuncios-audience-old-${crypto.randomUUID()}.db`
    tmpPaths.push(dbPath)
    adapter = await openDb(dbPath)
    // (1) La tabla como estaba antes de #106, con filas de producción.
    await adapter.run(OLD_ANNOUNCEMENTS_CREATE_SQL)
    for (const r of OLD_ROWS) {
      await adapter.run(
        'INSERT INTO announcements (id, hotelId, authorId, title, message, type, priority, active, date, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [r.id, r.hotelId, r.authorId, r.title, r.message, r.type, r.priority, r.active, r.date, r.createdAt],
      )
    }
    expect(await columnNames(adapter, 'announcements')).not.toContain('audience')

    // (2) Lo que hace RUN_MIGRATE=1 al bootear: el registro real del módulo + orm.migrate().
    orm = new ORM(adapter)
    registerAnunciosModels(orm)
    await orm.migrate()
  }, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

  it('orm.migrate() agrega la columna audience y deja las filas viejas intactas', async () => {
    expect(await columnNames(adapter, 'announcements')).toContain('audience')
    const rows = (await adapter.query('SELECT id, audience FROM announcements ORDER BY id')) as Array<{ id: string; audience: unknown }>
    expect(rows.map((r) => r.id)).toEqual(['old-1', 'old-2'])
    expectOldFieldsIntact(await selectOld(adapter, 'old-1'), OLD_ROWS[0]!)
    expectOldFieldsIntact(await selectOld(adapter, 'old-2'), OLD_ROWS[1]!)
  })

  it('el backfill de migrate-db.ts deja las filas viejas en "hotel" sin tocar el resto', async () => {
    // (3) El ALTER (idempotente: la columna ya la puso orm.migrate) y el UPDATE del deploy.
    await addColumnIfMissing(adapter, audienceAddColumnSql())
    await adapter.run(audienceBackfillSql())

    const old1 = await selectOld(adapter, 'old-1')
    const old2 = await selectOld(adapter, 'old-2')
    expect(old1.audience).toBe('hotel')
    expect(old2.audience).toBe('hotel')
    expectOldFieldsIntact(old1, OLD_ROWS[0]!)
    expectOldFieldsIntact(old2, OLD_ROWS[1]!)
    expect((await adapter.query('SELECT COUNT(*) as c FROM announcements'))[0].c).toBe(2)
  })

  it('el backfill es idempotente: correrlo de nuevo no cambia nada', async () => {
    await addColumnIfMissing(adapter, audienceAddColumnSql())
    await adapter.run(audienceBackfillSql())
    const rows = (await adapter.query("SELECT COUNT(*) as c FROM announcements WHERE audience = 'hotel'")) as Array<{ c: number }>
    expect(rows[0]!.c).toBe(2)
  })

  it('un create con audience:"admins" persiste y findById lo devuelve con "admins"', async () => {
    // (4) Si el modelo no declarara `audience`, el ORM la descartaría en silencio.
    const repo = new OrmRepository<any>(orm, 'Announcements')
    const created = await repo.create({ id: 'new-admins', hotelId: 'h-old', title: 'Solo admins', audience: 'admins' } as any)
    expect(created.audience).toBe('admins')
    const saved = await repo.findById('new-admins')
    expect(saved).toBeTruthy()
    expect(saved!.audience).toBe('admins')
    const raw = (await adapter.query('SELECT audience FROM announcements WHERE id = ?', ['new-admins'])) as Array<{ audience: string }>
    expect(raw[0]!.audience).toBe('admins')
    // Y las viejas siguen siendo del hotel.
    expect((await selectOld(adapter, 'old-1')).audience).toBe('hotel')
  })
})

describe('announcements.audience — base NUEVA: el CREATE TABLE actual de migrate-db.ts', () => {
  let adapter: any

  beforeAll(async () => {
    const dbPath = `/tmp/solmios-anuncios-audience-new-${crypto.randomUUID()}.db`
    tmpPaths.push(dbPath)
    adapter = await openDb(dbPath)
    // (5) La tabla tal cual la crea el deploy hoy, leída del fuente.
    await adapter.run(currentAnnouncementsCreateSql())
  })

  it('el CREATE TABLE del deploy declara audience', () => {
    expect(currentAnnouncementsCreateSql()).toMatch(/audience TEXT DEFAULT 'hotel'/)
  })

  it('una fila insertada sin audience vuelve "hotel" por el DEFAULT', async () => {
    await adapter.run('INSERT INTO announcements (id, hotelId, title) VALUES (?,?,?)', ['fresh-1', 'h-new', 'Sin audience'])
    const rows = (await adapter.query('SELECT audience FROM announcements WHERE id = ?', ['fresh-1'])) as Array<{ audience: string }>
    expect(rows[0]!.audience).toBe('hotel')
  })

  it('el backfill del deploy sobre la base nueva es un no-op', async () => {
    await addColumnIfMissing(adapter, audienceAddColumnSql())
    await adapter.run(audienceBackfillSql())
    const rows = (await adapter.query('SELECT audience FROM announcements WHERE id = ?', ['fresh-1'])) as Array<{ audience: string }>
    expect(rows[0]!.audience).toBe('hotel')
  })
})
