// ari-outbox/tests/model.e2e.test.ts — E2E del schema de `ari_outbox` contra una SQLite REAL.
//
// No prueba lógica: prueba que el ModelDefinition esté COMPLETO. El ORM de arckode descarta al
// persistir cualquier campo que el modelo no declare, y lo hace en silencio —sin warning, sin
// error—, así que un campo olvidado no se nota hasta que en producción la fila vuelve sin él
// (es el anti-patrón que documenta CLAUDE.md y que ya costó el `channexGroupId` de canales).
//
// Por eso el test inserta una fila con TODOS los campos en valores NO-default (si se cayera uno,
// el default lo taparía y el test pasaría igual) y la relee campo por campo desde la DB.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerAriOutboxModels } from '../model'
import type { AriOutboxRow } from '../types'

const HOTEL_ID = 'e2e-outbox-hotel-1'

let orm: any
let dbPath: string
let repo: OrmRepository<any>

beforeAll(async () => {
  dbPath = `/tmp/solmios-ari-outbox-e2e-${crypto.randomUUID()}.db`
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  // SOLO el modelo de la outbox: la tabla no depende de ninguna otra (el hotelId es una columna
  // de tenancy, no una FK), así que si esto no migra solo, el modelo está mal.
  registerAriOutboxModels(orm)
  await orm.migrate()
  repo = new OrmRepository<any>(orm, 'AriOutbox')
}, 60_000) // migrate() sobre SQLite tarda varios segundos en CI/sandbox

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('ari_outbox — el modelo declara todos los campos que usa la cola', () => {
  it('persiste y relee una fila COMPLETA sin que el ORM descarte ningún campo', async () => {
    const row: AriOutboxRow = {
      id: 'e2e-outbox-1',
      hotelId: HOTEL_ID,
      kind: 'rates',
      // Ráfaga con canales explícitos: el caso que obliga a que `channels` sea json y plural.
      channels: ['OpenChannel', 'Booking'],
      status: 'failed',
      scheduledAt: '2026-09-07T12:34:56.000Z',
      attempts: 2,
      maxAttempts: 5,
      lastError: 'Channex respondio 422: rate_plan_id desconocido',
    }
    await repo.create(row as any)

    const saved = await repo.findById('e2e-outbox-1') as AriOutboxRow | null
    expect(saved).toBeTruthy()
    expect(saved!.id).toBe('e2e-outbox-1')
    expect(saved!.hotelId).toBe(HOTEL_ID)
    expect(saved!.kind).toBe('rates')
    expect(saved!.channels).toEqual(['OpenChannel', 'Booking']) // json ida y vuelta, no "[object Object]"
    expect(saved!.status).toBe('failed')
    expect(saved!.scheduledAt).toBe('2026-09-07T12:34:56.000Z')
    expect(saved!.attempts).toBe(2)      // no el default 0
    expect(saved!.maxAttempts).toBe(5)   // no el default 3
    expect(saved!.lastError).toBe('Channex respondio 422: rate_plan_id desconocido')
    // timestamps: true → el listado admin ordena por acá.
    expect(saved!.createdAt).toBeTruthy()
  })

  it('aplica los defaults de la cola cuando la ráfaga se agenda con lo mínimo', async () => {
    // Así la va a crear schedule(): un cambio GLOBAL, sin canales, listo para el primer intento.
    await repo.create({
      id: 'e2e-outbox-2',
      hotelId: HOTEL_ID,
      kind: 'inventory',
      scheduledAt: '2026-09-07T13:00:00.000Z',
    } as any)

    const saved = await repo.findById('e2e-outbox-2') as AriOutboxRow | null
    expect(saved).toBeTruthy()
    expect(saved!.status).toBe('pending')
    expect(saved!.attempts).toBe(0)
    expect(saved!.maxAttempts).toBe(3)
    expect(saved!.channels ?? []).toEqual([]) // [] = cambio global: base + canales con override
  })

  it('consulta por hotel y estado — el filtro que usan el drain y el listado admin', async () => {
    const pendientes = await repo.findMany({ hotelId: HOTEL_ID, status: 'pending' } as any)
    expect(pendientes.map((r: AriOutboxRow) => r.id)).toEqual(['e2e-outbox-2'])
  })
})
