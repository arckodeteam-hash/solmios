// reservas/tests/backfill-source-web.e2e.test.ts — #247 (REQ-RWP-04): las reservas del motor público
// anteriores al cambio de `source` pasan a 'web' CON el deploy (migrate-db.ts), no con un script que
// alguien tiene que correr. Se pinea sobre una SQLite in-memory real (mismo patrón que
// restaurant/tests/restaurant-pay-backfill.test.ts) el discriminador `accessToken` y la idempotencia.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { backfillReservationSourceWeb } from '../../../../scripts/backfill-reservation-source-web'

interface TestDb extends DbAdapter { connect(): Promise<void> }

type Row = [id: string, source: string, channel: string, accessToken: string | null]

async function makeDb(rows: Row[]): Promise<TestDb> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  await db.run(`CREATE TABLE reservations (id TEXT PRIMARY KEY, hotelId TEXT, source TEXT, channel TEXT, accessToken TEXT)`)
  for (const [id, source, channel, accessToken] of rows) {
    await db.run(`INSERT INTO reservations (id, hotelId, source, channel, accessToken) VALUES (?,?,?,?,?)`, [id, 'h1', source, channel, accessToken])
  }
  return db
}

const sources = async (db: TestDb): Promise<string[]> => {
  const rows = (await db.query(`SELECT source FROM reservations ORDER BY id`)) as Array<{ source: string }>
  return rows.map((r) => r.source)
}

describe('backfillReservationSourceWeb — direct + accessToken → web', () => {
  let db: TestDb
  beforeEach(async () => {
    db = await makeDb([
      ['r1', 'direct', 'direct', 'tok-1'], // motor público antes de #247 → web
      ['r2', 'direct', 'direct', null], // cargada desde el panel → sigue direct
      ['r3', 'booking', 'booking', 'tok-3'], // OTA con token → no se toca (no es direct)
    ])
  })
  afterEach(async () => {
    await db.close()
  })

  it('primera corrida: convierte sólo la direct con accessToken y devuelve 1', async () => {
    expect(await backfillReservationSourceWeb(db)).toBe(1)
    expect(await sources(db)).toEqual(['web', 'direct', 'booking'])
  })

  it('segunda corrida: idempotente, devuelve 0 y nada cambia', async () => {
    await backfillReservationSourceWeb(db)
    expect(await backfillReservationSourceWeb(db)).toBe(0)
    expect(await sources(db)).toEqual(['web', 'direct', 'booking'])
  })

  it('accessToken vacío ("") no cuenta como reserva web', async () => {
    await db.run(`INSERT INTO reservations (id, hotelId, source, channel, accessToken) VALUES (?,?,?,?,?)`, ['r4', 'h1', 'direct', 'direct', ''])
    expect(await backfillReservationSourceWeb(db)).toBe(1)
    expect(await sources(db)).toEqual(['web', 'direct', 'booking', 'direct'])
  })
})
