// ari-outbox/tests/list.test.ts — CA-9: la consulta de la outbox, la pantalla que se muestra.
//
// Se prueba el HANDLER, no la ruta: el repo no tiene ningún test HTTP y la forma probada (issue
// #50) es llamar al controller directo y mirar `{ status, body }`. La ruta de index.ts es un
// adaptador de una línea, así que lo único con lógica propia es lo que se ejercita acá.
//
// El puerto es un array en memoria con la misma semántica que `OrmRepository.paginate` (filtros
// por igualdad exacta + orderBy + offset/limit): sin DB, sin reloj real, sin flakes.

import { describe, it, expect } from 'bun:test'
import type { Logger } from 'arckode-framework'
import { AriOutboxController } from '../controller'
import { AriOutboxService, type AriOutboxStore } from '../service'
import type { AriOutboxRow, AriOutboxStatus } from '../types'

const LOG = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => LOG } as unknown as Logger

function fila(over: Partial<AriOutboxRow> & { id: string }): AriOutboxRow {
  return {
    hotelId: 'h1',
    kind: 'rates',
    channels: [],
    status: 'pending',
    scheduledAt: '2026-09-07T10:00:00.000Z',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    ...over,
  }
}

/** Filas sembradas: dos hoteles, los cuatro estados, un failed con su motivo legible. */
const SEMBRADO: AriOutboxRow[] = [
  fila({ id: 'r1', scheduledAt: '2026-09-07T10:00:01.000Z', status: 'pending' }),
  fila({ id: 'r2', scheduledAt: '2026-09-07T10:00:02.000Z', status: 'sent', kind: 'inventory' }),
  fila({ id: 'r3', scheduledAt: '2026-09-07T10:00:03.000Z', status: 'failed', attempts: 3, lastError: 'Channex 422: rate plan no mapeado' }),
  fila({ id: 'r4', scheduledAt: '2026-09-07T10:00:04.000Z', status: 'pending', hotelId: 'h2', channels: ['OpenChannel'] }),
  fila({ id: 'r5', scheduledAt: '2026-09-07T10:00:05.000Z', status: 'processing', hotelId: 'h2' }),
]

/** Puerto en memoria con la semántica de OrmRepository (igualdad exacta, orden, paginado). */
function makeStore(seed: AriOutboxRow[] = SEMBRADO) {
  const rows = seed.map((r) => ({ ...r }))
  const store: AriOutboxStore = {
    async create(row) { rows.push({ ...row }); return row },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
    async findMany(query) {
      return rows.filter((r) => Object.entries(query).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
    },
    async paginate(filters, options) {
      const match = rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
      const by = Array.isArray(options.orderBy) ? options.orderBy[0] : options.orderBy
      if (by) {
        const dir = by.dir === 'ASC' ? 1 : -1
        match.sort((a, b) => dir * String((a as any)[by.field] ?? '').localeCompare(String((b as any)[by.field] ?? '')))
      }
      const offset = options.offset ?? 0
      return { data: match.slice(offset, offset + options.limit), total: match.length }
    },
  }
  return store
}

function makeHandler(seed?: AriOutboxRow[]) {
  const service = new AriOutboxService(makeStore(seed), LOG)
  return new AriOutboxController(service, LOG)
}

/** El HttpRequest del framework trae `query` como propiedad top-level (ver #50). */
function req(query: Record<string, string> = {}) {
  return { query } as any
}

describe('GET /api/admin/ari-outbox — la outbox con sus filas y estados (CA-9)', () => {
  it('devuelve 200 con las filas y sus estados, lo último agendado primero', async () => {
    const res = await makeHandler().index(req())

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(5)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(50)
    // scheduledAt DESC: quien mira la cola está mirando lo que acaba de pasar.
    expect(res.body.items.map((r: AriOutboxRow) => r.id)).toEqual(['r5', 'r4', 'r3', 'r2', 'r1'])
    expect(res.body.items.map((r: AriOutboxRow) => r.status).sort()).toEqual(
      ['failed', 'pending', 'pending', 'processing', 'sent'] as AriOutboxStatus[],
    )
    // La fila fallida trae POR QUÉ falló: es lo que se muestra sin ir a los logs del proceso.
    const fallida = res.body.items.find((r: AriOutboxRow) => r.status === 'failed') as AriOutboxRow
    expect(fallida.lastError).toBe('Channex 422: rate plan no mapeado')
    expect(fallida.attempts).toBe(3)
  })

  it('filtra por status: solo las de ese estado', async () => {
    const res = await makeHandler().index(req({ status: 'pending' }))

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.items.map((r: AriOutboxRow) => r.id)).toEqual(['r4', 'r1'])
    expect(res.body.items.every((r: AriOutboxRow) => r.status === 'pending')).toBe(true)
  })

  it('filtra por hotelId sin mezclar hoteles', async () => {
    const res = await makeHandler().index(req({ hotelId: 'h2' }))

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.items.map((r: AriOutboxRow) => r.hotelId)).toEqual(['h2', 'h2'])
    expect(res.body.items.map((r: AriOutboxRow) => r.id)).toEqual(['r5', 'r4'])
  })

  it('combina hotelId + status + kind y respeta el paginado', async () => {
    const soloH1Pending = await makeHandler().index(req({ hotelId: 'h1', status: 'pending', kind: 'rates' }))
    expect(soloH1Pending.body.items.map((r: AriOutboxRow) => r.id)).toEqual(['r1'])

    const pagina2 = await makeHandler().index(req({ limit: '2', page: '2' }))
    expect(pagina2.body.total).toBe(5)
    expect(pagina2.body.page).toBe(2)
    expect(pagina2.body.limit).toBe(2)
    expect(pagina2.body.items.map((r: AriOutboxRow) => r.id)).toEqual(['r3', 'r2'])
  })

  it('acota el limit al tope de 200 y cae al default con basura', async () => {
    const muchas = Array.from({ length: 250 }, (_, i) =>
      fila({ id: `x${String(i).padStart(3, '0')}`, scheduledAt: `2026-09-07T10:${String(i % 60).padStart(2, '0')}:00.000Z` }),
    )
    const topeado = await makeHandler(muchas).index(req({ limit: '5000' }))
    expect(topeado.body.limit).toBe(200)
    expect(topeado.body.items).toHaveLength(200)
    expect(topeado.body.total).toBe(250)

    const basura = await makeHandler(muchas).index(req({ limit: 'todas', page: '-3' }))
    expect(basura.body.limit).toBe(50)
    expect(basura.body.page).toBe(1)
  })
})
