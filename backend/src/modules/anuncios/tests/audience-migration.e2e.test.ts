// anuncios/tests/audience-migration.e2e.test.ts — la columna `audience` (#106) contra una SQLite REAL.
//
// Recorre los DOS caminos por los que la columna llega a una base, como reads.e2e.test.ts:
//
//   1. Base VIEJA (tabla `announcements` sin `audience`, con filas): `orm.migrate()` (RUN_MIGRATE=1)
//      agrega la columna sin tocar las filas (quedan con `audience` NULL); después el backfill
//      REAL —`scripts/backfill-announcement-audience.ts`, corrido como subproceso contra esa
//      base— deja la fila con hotel en 'hotel' y la fila sin hotel en 'all', y es idempotente.
//   2. Base NUEVA: el CREATE TABLE actual de migrate-db.ts (leído del fuente, no una copia) trae
//      `DEFAULT 'hotel'`, así que una fila insertada sin audience vuelve 'hotel'.
//
// Y en el medio, lo que el ORM descarta en silencio si el modelo no lo declara: un create con
// audience:'admins' tiene que releerse con 'admins'.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAnunciosModels } from '../model'

const BACKEND_DIR = fileURLToPath(new URL('../../../../', import.meta.url))
const MIGRATE_DB_SOURCE = readFileSync(`${BACKEND_DIR}migrate-db.ts`, 'utf8')
const BACKFILL_SCRIPT = 'scripts/backfill-announcement-audience.ts'

/** El CREATE TABLE de announcements que corre en cada deploy, extraído del fuente. */
function currentAnnouncementsCreateSql(): string {
  const match = MIGRATE_DB_SOURCE.match(/CREATE TABLE IF NOT EXISTS announcements \([\s\S]*?\)/)
  if (!match) throw new Error('migrate-db.ts ya no crea la tabla announcements')
  return match[0]
}

/**
 * El backfill de producción, tal cual se corre en el deploy (`DB_PATH=... bun run scripts/...`).
 * Va como subproceso porque el script abre su propia conexión y termina con `db.close()`.
 * `DATABASE_URL` se saca del env: si estuviera puesta, el script iría a Postgres.
 */
function runBackfill(dbPath: string): { stdout: string; stderr: string } {
  const env: Record<string, string | undefined> = { ...process.env, DB_PATH: dbPath }
  delete env.DATABASE_URL
  const proc = Bun.spawnSync(['bun', 'run', BACKFILL_SCRIPT], { cwd: BACKEND_DIR, env })
  const stdout = proc.stdout.toString()
  const stderr = proc.stderr.toString()
  expect(proc.exitCode, `backfill falló:\n${stdout}\n${stderr}`).toBe(0)
  return { stdout, stderr }
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
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { unlinkSync(p + suffix) } catch { /* tmp, best-effort */ }
    }
  }
})

describe('announcements.audience — base VIEJA: orm.migrate + scripts/backfill-announcement-audience.ts', () => {
  let adapter: any
  let orm: any
  let dbPath: string

  beforeAll(async () => {
    dbPath = `/tmp/solmios-anuncios-audience-old-${crypto.randomUUID()}.db`
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

  it('orm.migrate() agrega la columna audience y deja las filas viejas intactas (audience NULL)', async () => {
    expect(await columnNames(adapter, 'announcements')).toContain('audience')
    const rows = (await adapter.query('SELECT id, audience FROM announcements ORDER BY id')) as Array<{ id: string; audience: unknown }>
    expect(rows.map((r) => r.id)).toEqual(['old-1', 'old-2'])
    // El ALTER no rellena: eso es trabajo del backfill, que se prueba abajo.
    expect(rows.map((r) => r.audience)).toEqual([null, null])
    expectOldFieldsIntact(await selectOld(adapter, 'old-1'), OLD_ROWS[0]!)
    expectOldFieldsIntact(await selectOld(adapter, 'old-2'), OLD_ROWS[1]!)
  })

  it('el backfill real: con hotelId → "hotel", sin hotelId → "all", sin tocar el resto', async () => {
    // (3) El script de deploy, como subproceso, contra ESTA base.
    const { stdout } = runBackfill(dbPath)
    expect(stdout).toContain("1 → 'hotel', 1 → 'all'")

    const old1 = await selectOld(adapter, 'old-1')
    const old2 = await selectOld(adapter, 'old-2')
    expect(old1.audience).toBe('hotel')
    expect(old2.audience).toBe('all')
    expectOldFieldsIntact(old1, OLD_ROWS[0]!)
    expectOldFieldsIntact(old2, OLD_ROWS[1]!)
    expect((await adapter.query('SELECT COUNT(*) as c FROM announcements'))[0].c).toBe(2)
  }, 30_000)

  it('el backfill es idempotente: correrlo de nuevo no cambia nada', async () => {
    const { stdout } = runBackfill(dbPath)
    expect(stdout).toContain('nada pendiente')
    const rows = (await adapter.query('SELECT id, audience FROM announcements ORDER BY id')) as Array<{ id: string; audience: string }>
    expect(rows).toEqual([{ id: 'old-1', audience: 'hotel' }, { id: 'old-2', audience: 'all' }])
  }, 30_000)

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
    // Y las viejas siguen como las dejó el backfill.
    expect((await selectOld(adapter, 'old-1')).audience).toBe('hotel')
    expect((await selectOld(adapter, 'old-2')).audience).toBe('all')
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
})
