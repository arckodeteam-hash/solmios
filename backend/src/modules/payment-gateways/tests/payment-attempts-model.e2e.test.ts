// payment-gateways/tests/payment-attempts-model.e2e.test.ts — E2E del schema de `payment_attempts`
// contra una SQLite REAL.
//
// No prueba lógica: prueba que el ModelDefinition esté COMPLETO. El ORM de arckode descarta al
// persistir cualquier campo que el modelo no declare, y lo hace en silencio —sin warning, sin
// error—, así que un campo olvidado no se nota hasta que en producción la fila vuelve sin él
// (el anti-patrón que documenta CLAUDE.md). Por eso se inserta una fila con TODOS los campos en
// valores NO-default (si se cayera uno, el default lo taparía) y se relee campo por campo.
//
// También verifica que la tabla y sus índices (hotelId, reservationId, providerRef) existan de
// verdad en la base migrada: son los que usan el listado por reserva y la conciliación por
// referencia del proveedor.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerPaymentGatewaysModels } from '../model'

const HOTEL_ID = 'e2e-attempts-hotel-1'

let orm: any
let adapter: any
let dbPath: string
let repo: OrmRepository<any>

beforeAll(async () => {
  dbPath = `/tmp/solmios-payment-attempts-e2e-${crypto.randomUUID()}.db`
  adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  // Se registran los modelos del módulo tal como lo hace index.ts: la tabla no depende de ninguna
  // otra (hotelId y reservationId son columnas de tenancy/relación, no FKs), así que si esto no
  // migra solo, el modelo está mal.
  registerPaymentGatewaysModels(orm)
  await orm.migrate()
  repo = new OrmRepository<any>(orm, 'PaymentAttempts')
}, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('payment_attempts — el modelo declara todos los campos que usa la bitácora', () => {
  it('persiste y relee una fila COMPLETA sin que el ORM descarte ningún campo', async () => {
    const row = {
      id: 'stripe:evt_e2e_1',
      hotelId: HOTEL_ID,
      reservationId: 'res-e2e-1',
      source: 'booking_engine',
      provider: 'stripe',
      mode: 'live',
      providerRef: 'cs_test_e2e_1',
      eventId: 'evt_e2e_1',
      // Un rechazo: el outcome que antes de esta tabla se perdía sin dejar rastro.
      kind: 'failed',
      amountMinor: 123456, // no el default 0
      currency: 'DOP',
      failureCode: 'card_declined',
      failureMessage: 'Your card was declined.',
      cardBrand: 'visa',
      cardLast4: '0002',
      receiptUrl: 'https://pay.stripe.com/receipts/e2e-1',
      occurredAt: '2026-09-10T15:04:05.000Z',
    }
    await repo.create(row as any)

    const saved = await repo.findById('stripe:evt_e2e_1') as any
    expect(saved).toBeTruthy()
    expect(saved.id).toBe('stripe:evt_e2e_1')
    expect(saved.hotelId).toBe(HOTEL_ID)
    expect(saved.reservationId).toBe('res-e2e-1')
    expect(saved.source).toBe('booking_engine')
    expect(saved.provider).toBe('stripe')
    expect(saved.mode).toBe('live')
    expect(saved.providerRef).toBe('cs_test_e2e_1')
    expect(saved.eventId).toBe('evt_e2e_1')
    expect(saved.kind).toBe('failed')
    expect(saved.amountMinor).toBe(123456)
    expect(saved.currency).toBe('DOP')
    expect(saved.failureCode).toBe('card_declined')
    expect(saved.failureMessage).toBe('Your card was declined.')
    expect(saved.cardBrand).toBe('visa')
    expect(saved.cardLast4).toBe('0002')
    expect(saved.receiptUrl).toBe('https://pay.stripe.com/receipts/e2e-1')
    expect(saved.occurredAt).toBe('2026-09-10T15:04:05.000Z')
    // timestamps: true → el listado por reserva ordena por acá.
    expect(saved.createdAt).toBeTruthy()
    expect(saved.updatedAt).toBeTruthy()
  })

  it('aplica el default de amountMinor cuando se registra sólo el checkout creado', async () => {
    // Así la va a crear recordCheckout(): todavía no hay outcome ni monto confirmado.
    await repo.create({
      id: 'cardnet:sess-e2e-2',
      hotelId: HOTEL_ID,
      source: 'booking_engine',
      provider: 'cardnet',
      kind: 'checkout_created',
    } as any)

    const saved = await repo.findById('cardnet:sess-e2e-2') as any
    expect(saved).toBeTruthy()
    expect(saved.kind).toBe('checkout_created')
    expect(saved.amountMinor).toBe(0)
  })

  it('consulta por hotel y reserva — el filtro de listByReservation', async () => {
    const filas = await repo.findMany({ hotelId: HOTEL_ID, reservationId: 'res-e2e-1' } as any)
    expect(filas.map((r: any) => r.id)).toEqual(['stripe:evt_e2e_1'])
  })
})

describe('payment_attempts — la tabla y sus índices existen en la base migrada', () => {
  it('crea la tabla payment_attempts', async () => {
    const tablas = (await adapter.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='payment_attempts'`,
    )) as Array<{ name: string }>
    expect(tablas.map(t => t.name)).toEqual(['payment_attempts'])
  })

  it('crea índices sobre hotelId, reservationId y providerRef', async () => {
    const indices = (await adapter.query(
      `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='payment_attempts'`,
    )) as Array<{ name: string; sql: string | null }>
    const sqls = indices.map(i => i.sql ?? '')
    for (const col of ['hotelId', 'reservationId', 'providerRef']) {
      // Alguno de los índices tiene que nombrar la columna: `indexed: true` en el modelo debe
      // traducirse a un CREATE INDEX real, no quedar como anotación.
      expect(sqls.some(sql => sql.includes(col))).toBe(true)
    }
  })
})
