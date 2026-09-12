// reservas/tests/relax-roomid-backfill-roomtype.e2e.test.ts — REQ-HAC-01 (#256/#258): las bases
// existentes tienen `reservations.roomId TEXT NOT NULL` (CREATE original del ORM) y `roomType` vacío.
// Con el deploy (migrate-db.ts), `relaxReservationsRoomId` recrea la tabla sin ese NOT NULL
// preservando filas e índices, y `backfillReservationRoomType` copia `rooms.type` a las reservas
// viejas. Se pinea sobre una SQLite REAL en archivo temporal (la recreación de tabla + PRAGMA
// foreign_keys es lo que se prueba, no vale mockear) con el mismo molde que
// backfill-source-web.e2e.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { relaxReservationsRoomId } from '../../../../scripts/relax-reservations-roomid'
import { backfillReservationRoomType } from '../../../../scripts/backfill-reservation-room-type'

interface TestDb extends DbAdapter { connect(): Promise<void> }

// Esquema LEGACY: roomId NOT NULL, sin roomType (la agrega migrate-db.ts con addColumnIfMissing
// justo antes del backfill — acá se simula con el mismo ALTER).
const LEGACY_DDL = `CREATE TABLE reservations (id TEXT PRIMARY KEY, guestId TEXT, roomId TEXT NOT NULL,
  hotelId TEXT NOT NULL, checkIn TEXT NOT NULL, checkOut TEXT NOT NULL, status TEXT DEFAULT 'pending',
  totalAmount REAL NOT NULL, notes TEXT, createdAt TEXT, updatedAt TEXT)`

async function makeDb(dir: string): Promise<TestDb> {
  const db = new SqliteAdapter({ path: join(dir, 'legacy.db'), wal: false, foreignKeys: true }) as TestDb
  await db.connect()
  await db.run(`CREATE TABLE rooms (id TEXT PRIMARY KEY, hotelId TEXT NOT NULL, number TEXT, type TEXT)`)
  await db.run(LEGACY_DDL)
  await db.run(`CREATE INDEX idx_reservations_hotelId ON reservations(hotelId)`)
  await db.run(`CREATE UNIQUE INDEX idx_reservations_hotel_idempotency ON reservations(hotelId, notes)`)
  await db.run(`INSERT INTO rooms (id, hotelId, number, type) VALUES (?,?,?,?)`, ['room-1', 'h1', '101', 'double'])
  await db.run(`INSERT INTO rooms (id, hotelId, number, type) VALUES (?,?,?,?)`, ['room-2', 'h1', '201', 'suite'])
  await db.run(
    `INSERT INTO reservations (id, roomId, hotelId, checkIn, checkOut, totalAmount, notes) VALUES (?,?,?,?,?,?,?)`,
    ['r1', 'room-1', 'h1', '2026-10-01', '2026-10-03', 100, 'a'],
  )
  await db.run(
    `INSERT INTO reservations (id, roomId, hotelId, checkIn, checkOut, totalAmount, notes) VALUES (?,?,?,?,?,?,?)`,
    ['r2', 'room-2', 'h1', '2026-10-05', '2026-10-07', 300, 'b'],
  )
  await db.run(`ALTER TABLE reservations ADD COLUMN roomType TEXT`)
  return db
}

const tableDdl = async (db: TestDb): Promise<string> => {
  const rows = (await db.query(`SELECT sql FROM sqlite_master WHERE name='reservations' AND type='table'`)) as Array<{ sql: string }>
  return rows[0].sql
}
const indexNames = async (db: TestDb): Promise<string[]> => {
  const rows = (await db.query(`SELECT name FROM sqlite_master WHERE tbl_name='reservations' AND type='index' AND sql IS NOT NULL ORDER BY name`)) as Array<{ name: string }>
  return rows.map((r) => r.name)
}
const reservations = async (db: TestDb): Promise<Array<{ id: string; roomId: string | null; roomType: string | null; totalAmount: number }>> =>
  (await db.query(`SELECT id, roomId, roomType, totalAmount FROM reservations ORDER BY id`)) as Array<{ id: string; roomId: string | null; roomType: string | null; totalAmount: number }>

// El SqliteAdapter lanza SINCRÓNICAMENTE desde run() (no rechaza la promesa): se envuelve en async.
const insertWithoutRoom = async (db: TestDb) =>
  db.run(`INSERT INTO reservations (id, roomId, hotelId, checkIn, checkOut, totalAmount, roomType) VALUES (?,?,?,?,?,?,?)`, [
    'r3', null, 'h1', '2026-11-01', '2026-11-02', 50, 'double',
  ])

describe('relaxReservationsRoomId + backfillReservationRoomType — SQLite legacy con roomId NOT NULL', () => {
  let dir: string
  let db: TestDb
  const savedUrl = process.env.DATABASE_URL

  beforeEach(async () => {
    delete process.env.DATABASE_URL // el script detecta el motor por esta var: acá siempre SQLite
    dir = mkdtempSync(join(tmpdir(), 'relax-roomid-'))
    db = await makeDb(dir)
  })
  afterEach(async () => {
    await db.close()
    rmSync(dir, { recursive: true, force: true })
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl
  })

  it('antes del relax: el INSERT sin habitación revienta con NOT NULL (sanidad del fixture)', async () => {
    expect(/roomId TEXT NOT NULL/.test(await tableDdl(db))).toBe(true)
    await expect(insertWithoutRoom(db)).rejects.toThrow(/NOT NULL/)
  })

  it('relax: quita el NOT NULL, conserva filas e índices y el INSERT con roomId NULL ya no falla', async () => {
    expect(await relaxReservationsRoomId(db)).toEqual({ changed: true })

    const ddl = await tableDdl(db)
    expect(/roomId TEXT NOT NULL/.test(ddl)).toBe(false)
    expect(/hotelId TEXT NOT NULL/.test(ddl)).toBe(true) // sólo se toca roomId
    expect(await indexNames(db)).toEqual(['idx_reservations_hotelId', 'idx_reservations_hotel_idempotency'])

    const rows = await reservations(db)
    expect(rows.map((r) => [r.id, r.roomId, r.totalAmount])).toEqual([['r1', 'room-1', 100], ['r2', 'room-2', 300]])

    await insertWithoutRoom(db)
    expect((await reservations(db)).find((r) => r.id === 'r3')?.roomId).toBeNull()

    // PRAGMA foreign_keys vuelve a ON al terminar (el adapter lo prendió al conectar).
    const fk = (await db.query(`PRAGMA foreign_keys`)) as Array<{ foreign_keys: number }>
    expect(fk[0].foreign_keys).toBe(1)
  })

  it('backfill: toda fila con habitación queda con roomType = rooms.type', async () => {
    await relaxReservationsRoomId(db)
    expect(await backfillReservationRoomType(db)).toBe(2)
    expect((await reservations(db)).map((r) => [r.id, r.roomType])).toEqual([['r1', 'double'], ['r2', 'suite']])
  })

  it('segunda corrida de ambos: changed:false y 0 filas (idempotente)', async () => {
    await relaxReservationsRoomId(db)
    await backfillReservationRoomType(db)
    expect(await relaxReservationsRoomId(db)).toEqual({ changed: false })
    expect(await backfillReservationRoomType(db)).toBe(0)
    expect((await reservations(db)).map((r) => [r.id, r.roomType])).toEqual([['r1', 'double'], ['r2', 'suite']])
  })

  it('backfill: una reserva sin habitación o con habitación inexistente no se toca', async () => {
    await relaxReservationsRoomId(db)
    await insertWithoutRoom(db) // r3: roomId NULL, roomType ya viene 'double' (vendido por tipo)
    await db.run(`INSERT INTO reservations (id, roomId, hotelId, checkIn, checkOut, totalAmount) VALUES (?,?,?,?,?,?)`, [
      'r4', 'room-gone', 'h1', '2026-11-03', '2026-11-04', 10,
    ])
    expect(await backfillReservationRoomType(db)).toBe(2)
    expect((await reservations(db)).map((r) => [r.id, r.roomType])).toEqual([
      ['r1', 'double'], ['r2', 'suite'], ['r3', 'double'], ['r4', null],
    ])
  })
})
