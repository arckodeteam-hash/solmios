// sales-leads/tests/sales-prospects-model.e2e.test.ts — Schema de `sales_prospects` contra una
// SQLite REAL (issue #144, tarea 1.1).
//
// No prueba lógica: prueba que el ModelDefinition esté COMPLETO. El ORM descarta al persistir
// cualquier campo que el modelo no declare, en silencio (anti-patrón de CLAUDE.md, mem 1805). Por
// eso se inserta una fila con TODOS los campos en valores NO-default y se relee campo por campo.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { ORM, OrmRepository } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerSalesLeadsModels, SalesProspectsModel } from '../model'
import type { SalesProspectDTO } from '../types'

let orm: any
let dbPath: string
let repo: OrmRepository<SalesProspectDTO>

beforeAll(async () => {
  dbPath = `/tmp/solmios-sales-prospects-e2e-${crypto.randomUUID()}.db`
  const adapter = new SqliteAdapter({ path: dbPath, wal: false, foreignKeys: true }) as any
  await adapter.connect()
  orm = new ORM(adapter)
  registerSalesLeadsModels(orm)
  await orm.migrate()
  repo = new OrmRepository<SalesProspectDTO>(orm, 'SalesProspects')
}, 60_000)

afterAll(() => {
  try { require('node:fs').unlinkSync(dbPath) } catch { /* tmp, best-effort */ }
})

describe('sales_prospects — el modelo declara todos los campos que usa el pipeline', () => {
  it('persiste y relee una fila COMPLETA sin que el ORM descarte ningún campo', async () => {
    const full: Omit<SalesProspectDTO, 'id' | 'createdAt' | 'updatedAt'> = {
      hotelId: 'hotel-e2e-1',
      leadId: 'lead-e2e-1',
      nextStepAt: '2026-09-12T10:00:00.000Z',
      nextStepNote: 'Llamar 10am',
      assignedTo: 'user-super-admin-1',
      contactedAt: '2026-09-10T15:30:00.000Z',
      lostAt: '2026-09-11T09:00:00.000Z',
      lostReason: 'chose_competitor',
      notes: 'línea 1\nlínea 2',
      sequenceSent: { activation_no_rooms: '2026-09-11T08:00:00.000Z' },
    }
    const created = await repo.create(full as Omit<SalesProspectDTO, 'id'>)
    expect(created.id).toBeTruthy()

    const back = await repo.findById(created.id)
    expect(back).not.toBeNull()
    for (const [field, value] of Object.entries(full)) {
      expect({ [field]: (back as any)[field] }).toEqual({ [field]: value })
    }
    expect(typeof back!.createdAt).toBe('string')
    expect(typeof back!.updatedAt).toBe('string')
  })

  it('el DTO y el modelo declaran exactamente los mismos campos (ninguno se queda afuera)', () => {
    const modelFields = Object.keys(SalesProspectsModel.fields).filter((f) => f !== 'id').sort()
    const dtoFields = [
      'hotelId', 'leadId', 'nextStepAt', 'nextStepNote', 'assignedTo', 'contactedAt',
      'lostAt', 'lostReason', 'notes', 'sequenceSent',
    ].sort()
    expect(modelFields).toEqual(dtoFields)
  })

  it('findOne por hotelId y por leadId (las dos claves del upsert) funcionan sobre la tabla real', async () => {
    await repo.create({ hotelId: 'h-only', leadId: null, nextStepAt: null, nextStepNote: null, assignedTo: null, contactedAt: null, lostAt: null, lostReason: null, notes: null, sequenceSent: {} } as any)
    await repo.create({ hotelId: null, leadId: 'l-only', nextStepAt: null, nextStepNote: null, assignedTo: null, contactedAt: null, lostAt: null, lostReason: null, notes: null, sequenceSent: {} } as any)
    expect((await repo.findOne({ hotelId: 'h-only' }))?.leadId ?? null).toBeNull()
    expect((await repo.findOne({ leadId: 'l-only' }))?.hotelId ?? null).toBeNull()
  })

  it('un update parcial pisa solo lo enviado y conserva el resto', async () => {
    const row = await repo.create({ hotelId: 'h-partial', leadId: null, nextStepAt: '2026-09-12', nextStepNote: 'nota', assignedTo: null, contactedAt: null, lostAt: null, lostReason: null, notes: null, sequenceSent: {} } as any)
    const updated = await repo.update(row.id, { contactedAt: '2026-09-10T00:00:00.000Z' })
    expect(updated).toMatchObject({ nextStepAt: '2026-09-12', nextStepNote: 'nota', contactedAt: '2026-09-10T00:00:00.000Z' })
  })
})
