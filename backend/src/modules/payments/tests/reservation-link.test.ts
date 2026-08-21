// payments/tests/reservation-link.test.ts — el TERCER vínculo reserva → dinero, de punta a punta.
//
// MED-3: el cambio de schema (`migrate-db.ts` += `payments.reservationId` + índice + backfill)
// no tenía NINGÚN test — patrón del repo: SQLite in-memory como migrate-public-bookings.test.ts.
// MED-4: ningún test importaba `PaymentModel`, así que nada guardaba contra el anti-patrón ORM
// "campo no declarado se descarta en silencio" (CLAUDE.md, 6 casos históricos): si alguien sacara
// `reservationId` del modelo, `charge-reschedule-diff` seguiría "guardando" cobros que al recargar
// pierden el vínculo, y el techo de `payment-requests` volvería a autorizar cobrarlos por Stripe.
import { describe, it, expect } from 'bun:test'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import type { DbAdapter } from 'arckode-framework'
import { PaymentModel } from '../model'
import { backfillPaymentsReservationId } from '../../../../scripts/backfill-payments-reservation'

interface TestDb extends DbAdapter { connect(): Promise<void> }

async function makeDb(): Promise<TestDb> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false }) as TestDb
  await db.connect()
  // DDL mínima de una base VIEJA: existe ANTES de la columna `reservationId` (el ALTER la agrega).
  await db.run(`CREATE TABLE payments (
    id TEXT PRIMARY KEY, hotelId TEXT NOT NULL, folioId TEXT, invoiceId TEXT,
    type TEXT, method TEXT, status TEXT, amount REAL, currency TEXT,
    metadata TEXT)`)
  return db
}

describe('PaymentModel — el vínculo directo está declarado (anti-patrón ORM)', () => {
  it('declara `reservationId` con índice: sin esto el campo se descarta al persistir en silencio', () => {
    expect(Object.keys(PaymentModel.fields)).toContain('reservationId')
    expect(PaymentModel.fields.reservationId?.type).toBe('string')
    expect(PaymentModel.fields.reservationId?.indexed).toBe(true)
  })

  it('declara los otros dos vínculos y la metadata de donde se reconstruye el histórico', () => {
    expect(Object.keys(PaymentModel.fields)).toContain('folioId')
    expect(Object.keys(PaymentModel.fields)).toContain('invoiceId')
    expect(PaymentModel.fields.metadata?.type).toBe('json')
  })
})

describe('backfillPaymentsReservationId — COR-B', () => {
  it('reconstruye el vínculo desde metadata:{reservationId} en filas históricas', async () => {
    const db = await makeDb()
    await db.run(`ALTER TABLE payments ADD COLUMN reservationId TEXT`)
    // Cobro de reprogramación PRE-columna: reserva sólo en metadata (lo que escribía
    // charge-reschedule-diff antes de BUG-ceiling-bypass).
    await db.run(`INSERT INTO payments (id, hotelId, type, method, status, amount, metadata)
      VALUES ('p1', 'h1', 'charge', 'cash', 'completed', 80, ?)`,
      [JSON.stringify({ reservationId: 'r1', source: 'reschedule' })])
    await db.run(`INSERT INTO payments (id, hotelId, type, method, status, amount, metadata)
      VALUES ('p2', 'h1', 'charge', 'card', 'completed', 50, ?)`,
      [JSON.stringify({ source: 'other' })]) // sin reservationId en metadata
    await db.run(`INSERT INTO payments (id, hotelId, folioId, type, method, status, amount)
      VALUES ('p3', 'h1', 'f1', 'charge', 'cash', 'completed', 30)`) // metadata NULL, ya tiene folio

    const fixed = await backfillPaymentsReservationId(db)
    expect(fixed).toBe(1)

    const rows = (await db.query(`SELECT id, reservationId FROM payments ORDER BY id`)) as Array<{ id: string; reservationId: string | null }>
    expect(rows).toEqual([
      { id: 'p1', reservationId: 'r1' },
      { id: 'p2', reservationId: null },
      { id: 'p3', reservationId: null },
    ])
  })

  it('es idempotente: la segunda corrida no toca nada (y no pisa correcciones manuales)', async () => {
    const db = await makeDb()
    await db.run(`ALTER TABLE payments ADD COLUMN reservationId TEXT`)
    await db.run(`INSERT INTO payments (id, hotelId, type, method, status, amount, metadata)
      VALUES ('p1', 'h1', 'charge', 'cash', 'completed', 80, ?)`,
      [JSON.stringify({ reservationId: 'r1', source: 'reschedule' })])

    expect(await backfillPaymentsReservationId(db)).toBe(1)
    // Corrección manual posterior (el staff arregló el vínculo a otra reserva): no se pisa.
    await db.run(`UPDATE payments SET reservationId = 'r9' WHERE id = 'p1'`)
    expect(await backfillPaymentsReservationId(db)).toBe(0)
    const rows = (await db.query(`SELECT reservationId FROM payments`)) as Array<{ reservationId: string | null }>
    expect(rows[0]?.reservationId).toBe('r9')
  })

  it('tolera metadata corrupta (JSON roto) sin romper la migración', async () => {
    const db = await makeDb()
    await db.run(`ALTER TABLE payments ADD COLUMN reservationId TEXT`)
    await db.run(`INSERT INTO payments (id, hotelId, type, method, status, amount, metadata)
      VALUES ('p1', 'h1', 'charge', 'cash', 'completed', 80, '{reservationId: roto')`)
    expect(await backfillPaymentsReservationId(db)).toBe(0)
  })
})
