// scripts/relax-reservations-roomid.ts — quita el NOT NULL de `reservations.roomId` (REQ-HAC-01, #256/#258).
//
// Desde #258 la habitación se asigna al check-in, no al reservar: una reserva sin `roomId` es válida
// (lo vendido es `roomType`). El modelo ORM ya no declara `required: true`, así que las bases nuevas
// salen bien; las existentes conservan el `roomId TEXT NOT NULL` con el que se creó la tabla y
// cualquier INSERT sin habitación revienta con `NOT NULL constraint failed`.
//
// Postgres: `ALTER TABLE ... ALTER COLUMN roomid DROP NOT NULL` (identificador sin comillas: PG lo
// pliega a minúsculas, igual que el CREATE que hizo ormMigrate). Antes se consulta
// `information_schema.columns.is_nullable` para devolver changed:false si ya estaba relajada.
//
// SQLite: no soporta ALTER COLUMN — se recrea la tabla sin ese NOT NULL copiando por nombre desde
// `pragma_table_info` y re-creando los índices, todo en transacción (mismo molde que
// drop-users-role-check.ts, pero sobre la API `db.query/db.run` del DbAdapter porque lo llama
// migrate-db.ts con el adapter que corresponda). `PRAGMA foreign_keys` no se puede cambiar dentro
// de una transacción: se apaga ANTES del BEGIN y se vuelve a prender DESPUÉS del COMMIT/ROLLBACK.
//
// Idempotente: si el DDL vigente no tiene el NOT NULL, devuelve changed:false sin tocar nada. Sólo
// se llama desde `migrate-db.ts` (corre en cada deploy) y desde su test
// `reservas/tests/relax-roomid-backfill-roomtype.e2e.test.ts`: NO se corre aparte.

import type { DbAdapter } from 'arckode-framework'

type Db = Pick<DbAdapter, 'query' | 'run'>

// `"?roomId"?` cubre el DDL del ORM (sin comillas) y el de un dump/legacy con comillas; el lookbehind
// evita pisar otra columna que termine en "roomId". `[^,()]*?` abarca el tipo y cualquier DEFAULT
// antes del NOT NULL, sin cruzar a la columna siguiente.
const ROOMID_NOT_NULL = /((?<![\w])["`]?roomId["`]?\s+[^,()]*?)\s+NOT\s+NULL/i

async function relaxPostgres(db: Db): Promise<{ changed: boolean }> {
  const rows = (await db.query(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'roomid'`,
  )) as Array<{ is_nullable: string }>
  if (rows.length === 0) throw new Error('relation "reservations" does not exist')
  if (rows[0].is_nullable === 'YES') return { changed: false }
  await db.run(`ALTER TABLE reservations ALTER COLUMN roomid DROP NOT NULL`)
  return { changed: true }
}

async function relaxSqlite(db: Db): Promise<{ changed: boolean }> {
  const rows = (await db.query(`SELECT sql FROM sqlite_master WHERE name = 'reservations' AND type = 'table'`)) as Array<{ sql: string }>
  if (rows.length === 0) throw new Error('no such table: reservations')
  const ddl = rows[0].sql
  if (!ROOMID_NOT_NULL.test(ddl)) return { changed: false }

  const newDdl = ddl.replace(ROOMID_NOT_NULL, '$1')
  const ddlTemp = newDdl.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?reservations["`]?/i, 'CREATE TABLE reservations_new')
  if (ddlTemp === newDdl) throw new Error('relax roomId: no se pudo reescribir el CREATE TABLE de reservations')

  // Columnas por nombre exacto (pragma_table_info) e índices con DDL propio (los autoindex de
  // PRIMARY KEY/UNIQUE tienen sql NULL y los recrea el CREATE TABLE).
  const cols = ((await db.query(`SELECT name FROM pragma_table_info('reservations')`)) as Array<{ name: string }>)
    .map((c) => `"${c.name}"`)
    .join(', ')
  const indexes = ((await db.query(
    `SELECT sql FROM sqlite_master WHERE tbl_name = 'reservations' AND type = 'index' AND sql IS NOT NULL`,
  )) as Array<{ sql: string }>).map((i) => i.sql)

  await db.run('PRAGMA foreign_keys = OFF')
  await db.run('BEGIN')
  try {
    await db.run(ddlTemp)
    await db.run(`INSERT INTO reservations_new (${cols}) SELECT ${cols} FROM reservations`)
    await db.run('DROP TABLE reservations')
    await db.run('ALTER TABLE reservations_new RENAME TO reservations')
    for (const idx of indexes) await db.run(idx)
    await db.run('COMMIT')
  } catch (e) {
    try { await db.run('ROLLBACK') } catch { /* ya hizo rollback */ }
    throw e
  } finally {
    await db.run('PRAGMA foreign_keys = ON')
  }
  return { changed: true }
}

/**
 * Quita el NOT NULL de `reservations.roomId`. Detecta el motor igual que migrate-db.ts /
 * composition-root.ts: `DATABASE_URL` → Postgres, si no SQLite.
 * Devuelve `changed:true` sólo cuando ESTA corrida modificó la tabla.
 */
export async function relaxReservationsRoomId(db: Db): Promise<{ changed: boolean }> {
  return process.env.DATABASE_URL ? relaxPostgres(db) : relaxSqlite(db)
}
