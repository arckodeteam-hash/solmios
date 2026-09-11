// restaurant/tests/business-date-backfill.test.ts — #213 (auditoría): las comandas y los pagos anteriores
// a la columna `businessDate` reciben su día contable CON el deploy (migrate-db.ts), en la zona del hotel.
// Sin esto quedan en NULL y ningún cierre del día los ve (el ORM consulta por igualdad).
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { backfillBusinessDate } from '../../../../scripts/backfill-business-date'

interface TestDb extends DbAdapter { connect(): Promise<void> }

async function makeDb(): Promise<TestDb> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  await db.run(`CREATE TABLE hotels (id TEXT PRIMARY KEY, timezone TEXT)`)
  await db.run(`CREATE TABLE restaurant_orders (id TEXT PRIMARY KEY, hotelId TEXT, status TEXT, closedAt TEXT, businessDate TEXT)`)
  await db.run(`CREATE TABLE payments (id TEXT PRIMARY KEY, hotelId TEXT, processedAt TEXT, createdAt TEXT, businessDate TEXT)`)
  await db.run(`INSERT INTO hotels VALUES ('h-sdq', 'America/Santo_Domingo'), ('h-mad', 'Europe/Madrid'), ('h-null', NULL)`)
  return db
}

const col = async (db: TestDb, table: string, id: string): Promise<string | null> =>
  ((await db.query(`SELECT businessDate AS business_date FROM ${table} WHERE id = ?`, [id])) as Array<{ business_date: string | null }>)[0]!.business_date

describe('backfillBusinessDate', () => {
  it('comandas: closedAt → día en la zona del hotel; abiertas (sin closedAt) quedan NULL; no pisa lo que ya tiene valor', async () => {
    const db = await makeDb()
    // 01:30Z del 12 = 21:30 del 11 en Santo Domingo, 03:30 del 12 en Madrid.
    await db.run(`INSERT INTO restaurant_orders VALUES ('o-sdq', 'h-sdq', 'paid', '2026-09-12T01:30:00.000Z', NULL)`)
    await db.run(`INSERT INTO restaurant_orders VALUES ('o-mad', 'h-mad', 'paid', '2026-09-12T01:30:00.000Z', NULL)`)
    await db.run(`INSERT INTO restaurant_orders VALUES ('o-unknown-hotel', 'h-x', 'paid', '2026-09-12T01:30:00.000Z', NULL)`)
    await db.run(`INSERT INTO restaurant_orders VALUES ('o-open', 'h-sdq', 'served', NULL, NULL)`)
    await db.run(`INSERT INTO restaurant_orders VALUES ('o-done', 'h-sdq', 'paid', '2026-09-12T01:30:00.000Z', '2026-01-01')`)

    const first = await backfillBusinessDate(db)
    expect(first).toEqual({ orders: 3, payments: 0 })
    expect(await col(db, 'restaurant_orders', 'o-sdq')).toBe('2026-09-11')
    expect(await col(db, 'restaurant_orders', 'o-mad')).toBe('2026-09-12')
    expect(await col(db, 'restaurant_orders', 'o-unknown-hotel')).toBe('2026-09-11')   // zona por defecto (Santo Domingo)
    expect(await col(db, 'restaurant_orders', 'o-open')).toBeNull()
    expect(await col(db, 'restaurant_orders', 'o-done')).toBe('2026-01-01')

    // Idempotente: la segunda corrida no escribe nada.
    expect(await backfillBusinessDate(db)).toEqual({ orders: 0, payments: 0 })
  })

  it('pagos: processedAt manda; sin processedAt cae a createdAt; hotel con timezone NULL usa la zona por defecto', async () => {
    const db = await makeDb()
    await db.run(`INSERT INTO payments VALUES ('p-done', 'h-sdq', '2026-09-12T01:30:00.000Z', '2026-09-10T12:00:00.000Z', NULL)`)
    await db.run(`INSERT INTO payments VALUES ('p-pending', 'h-mad', NULL, '2026-09-12T01:30:00.000Z', NULL)`)
    await db.run(`INSERT INTO payments VALUES ('p-null-tz', 'h-null', '2026-09-12T01:30:00.000Z', NULL, NULL)`)
    await db.run(`INSERT INTO payments VALUES ('p-nothing', 'h-sdq', NULL, NULL, NULL)`)
    // Sembrado por migrate-db con sólo la fecha: se toma tal cual (medianoche UTC lo correría al 25).
    await db.run(`INSERT INTO payments VALUES ('p-date-only', 'h-sdq', '2026-06-26', NULL, NULL)`)

    expect(await backfillBusinessDate(db)).toEqual({ orders: 0, payments: 4 })
    expect(await col(db, 'payments', 'p-done')).toBe('2026-09-11')
    expect(await col(db, 'payments', 'p-pending')).toBe('2026-09-12')
    expect(await col(db, 'payments', 'p-null-tz')).toBe('2026-09-11')
    expect(await col(db, 'payments', 'p-nothing')).toBeNull()
    expect(await col(db, 'payments', 'p-date-only')).toBe('2026-06-26')
  })
})
