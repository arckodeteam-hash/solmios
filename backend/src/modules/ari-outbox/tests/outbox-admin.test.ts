// ari-outbox/tests/outbox-admin.test.ts — Contrato de la operación de la cola desde el Super Admin.
//
// Tres cosas que el monitor necesita y que hoy nadie garantiza: que "en reintento" se distinga de
// "pendiente" (no es un estado de la tabla, es `pending` con intentos ya gastados), que un
// reintento manual devuelva la fila a cero sin importar de qué estado venga, y que la config
// aguante lo que le manden (un value corrupto en la tabla no puede tirar el endpoint).
//
// Todo contra dobles en memoria —arrays y closures, mismo estilo que outbox-queue.test.ts—: sin
// base, sin reloj real, sin flakes.

import { describe, it, expect } from 'bun:test'
import {
  contarPorEstado,
  reintentar,
  sanearConfig,
  createQueueConfigStore,
  QUEUE_CONFIG_DEFAULTS,
  QUEUE_CONFIG_KEY,
  type OutboxCountPort,
  type OutboxRetryPort,
} from '../usecases/outbox-admin'
import type { AriOutboxRow } from '../types'

function fila(over: Partial<AriOutboxRow> & { id: string }): AriOutboxRow {
  return {
    hotelId: 'h1',
    kind: 'rates',
    channels: [],
    status: 'pending',
    scheduledAt: '2026-09-07T10:00:00.000Z',
    attempts: 0,
    maxAttempts: 3,
    ...over,
  }
}

const matchea = (row: AriOutboxRow, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)

/** Puerto de outbox en memoria: count/findMany por igualdad + update por id. */
function makePort(rows: AriOutboxRow[]): OutboxCountPort & OutboxRetryPort {
  return {
    async count(where) {
      return rows.filter((r) => matchea(r, where)).length
    },
    async findMany(where) {
      return rows.filter((r) => matchea(r, where))
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, patch)
      return row
    },
  }
}

/** Doble del `orm` crudo, solo con lo que usa el store de config sobre `Configuration`. */
function makeOrm(rows: Array<Record<string, any>> = []) {
  const orm = {
    async findMany(model: string, where: Record<string, unknown>) {
      return rows.filter((r) => r.__model === model && matchea(r as any, where))
    },
    async update(model: string, id: string, patch: Record<string, unknown>) {
      const row = rows.find((r) => r.__model === model && r.id === id)
      if (row) Object.assign(row, patch)
      return row ?? null
    },
    async create(model: string, data: Record<string, unknown>) {
      const row = { __model: model, ...data }
      rows.push(row)
      return row
    },
  }
  return { orm, rows }
}

const configRow = (value: string) => ({ __model: 'Configuration', id: 'cfg-1', hotelId: 'platform', key: QUEUE_CONFIG_KEY, value })

describe('contarPorEstado', () => {
  it('separa las pending que nunca fallaron de las que están en reintento', async () => {
    const rows = [
      fila({ id: '1' }),
      fila({ id: '2' }),
      fila({ id: '3', attempts: 2 }), // ya falló dos veces: está esperando su reintento
      fila({ id: '4', status: 'processing' }),
      fila({ id: '5', status: 'sent' }),
      fila({ id: '6', status: 'sent' }),
      fila({ id: '7', status: 'failed', attempts: 3 }),
    ]

    const counts = await contarPorEstado(makePort(rows))

    expect(counts).toEqual({ pending: 2, retrying: 1, processing: 1, sent: 2, failed: 1, total: 7 })
  })

  it('el total suma las pending en reintento una sola vez', async () => {
    const rows = [fila({ id: '1' }), fila({ id: '2', attempts: 1 }), fila({ id: '3', attempts: 2 })]

    const counts = await contarPorEstado(makePort(rows))

    expect(counts.pending + counts.retrying).toBe(3)
    expect(counts.total).toBe(3)
  })

  it('respeta el filtro por hotelId en TODAS las consultas', async () => {
    const rows = [
      fila({ id: '1', hotelId: 'h1' }),
      fila({ id: '2', hotelId: 'h1', attempts: 1 }),
      fila({ id: '3', hotelId: 'h2' }),
      fila({ id: '4', hotelId: 'h2', status: 'sent' }),
      fila({ id: '5', hotelId: 'h1', status: 'failed', attempts: 3 }),
    ]

    const counts = await contarPorEstado(makePort(rows), { hotelId: 'h1' })

    expect(counts).toEqual({ pending: 1, retrying: 1, processing: 0, sent: 0, failed: 1, total: 3 })
  })

  it('respeta el filtro por kind', async () => {
    const rows = [
      fila({ id: '1', kind: 'rates' }),
      fila({ id: '2', kind: 'inventory' }),
      fila({ id: '3', kind: 'inventory', status: 'sent' }),
    ]

    const counts = await contarPorEstado(makePort(rows), { kind: 'inventory' })

    expect(counts).toEqual({ pending: 1, retrying: 0, processing: 0, sent: 1, failed: 0, total: 2 })
  })
})

describe('reintentar', () => {
  it('devuelve una fila failed a la cola desde cero', async () => {
    const rows = [
      fila({ id: 'x', status: 'failed', attempts: 3, lastError: 'channex 502', claimedBy: 'worker-1' }),
    ]
    const port = makePort(rows)

    const actualizada = await reintentar(port, 'x', '2026-09-08T12:00:00.000Z')

    expect(actualizada).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
      claimedBy: null,
      scheduledAt: '2026-09-08T12:00:00.000Z',
    })
    expect(rows[0]!.status).toBe('pending')
  })

  it('también destraba una fila colgada en processing (no se bloquea por status)', async () => {
    const rows = [fila({ id: 'y', status: 'processing', attempts: 1, claimedBy: 'worker-muerto' })]

    const actualizada = await reintentar(makePort(rows), 'y', '2026-09-08T12:00:00.000Z')

    expect(actualizada?.status).toBe('pending')
    expect(actualizada?.claimedBy).toBeNull()
  })

  it('devuelve null si el id no existe y no toca nada', async () => {
    const rows = [fila({ id: 'x', status: 'failed', attempts: 3 })]

    const actualizada = await reintentar(makePort(rows), 'no-existe', '2026-09-08T12:00:00.000Z')

    expect(actualizada).toBeNull()
    expect(rows[0]!.status).toBe('failed')
  })
})

describe('sanearConfig', () => {
  it('sin nada devuelve los defaults', () => {
    expect(sanearConfig({})).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
    expect(sanearConfig(null)).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
    expect(sanearConfig(undefined)).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('acepta valores válidos', () => {
    expect(sanearConfig({ maxAttempts: 5, maxPerMinute: 30 })).toEqual({ maxAttempts: 5, maxPerMinute: 30 })
    expect(sanearConfig({ maxAttempts: 1, maxPerMinute: 60 })).toEqual({ maxAttempts: 1, maxPerMinute: 60 })
  })

  it('lo que se pasa de rango cae al DEFAULT, no al borde', () => {
    expect(sanearConfig({ maxAttempts: 99, maxPerMinute: 500 })).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
    expect(sanearConfig({ maxAttempts: 0, maxPerMinute: -3 })).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('ignora lo que no es número y trunca los decimales', () => {
    expect(sanearConfig({ maxAttempts: 'muchos', maxPerMinute: NaN })).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
    expect(sanearConfig({ maxAttempts: {}, maxPerMinute: [] })).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
    expect(sanearConfig({ maxAttempts: '4', maxPerMinute: 20.9 })).toEqual({ maxAttempts: 4, maxPerMinute: 20 })
  })

  it('salva el campo válido aunque el otro venga roto', () => {
    expect(sanearConfig({ maxAttempts: 7, maxPerMinute: 'x' })).toEqual({
      maxAttempts: 7,
      maxPerMinute: QUEUE_CONFIG_DEFAULTS.maxPerMinute,
    })
  })
})

describe('createQueueConfigStore', () => {
  it('leer sin fila devuelve los defaults', async () => {
    const { orm } = makeOrm()

    expect(await createQueueConfigStore(orm).leer()).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('leer un value corrupto devuelve los defaults en vez de explotar', async () => {
    const { orm } = makeOrm([configRow('no-es-json')])

    expect(await createQueueConfigStore(orm).leer()).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('leer devuelve lo guardado, saneado', async () => {
    const { orm } = makeOrm([configRow(JSON.stringify({ maxAttempts: 6, maxPerMinute: 999 }))])

    expect(await createQueueConfigStore(orm).leer()).toEqual({
      maxAttempts: 6,
      maxPerMinute: QUEUE_CONFIG_DEFAULTS.maxPerMinute,
    })
  })

  it('guardar crea la fila la primera vez y actualiza la segunda', async () => {
    const { orm, rows } = makeOrm()
    const store = createQueueConfigStore(orm)

    expect(await store.guardar({ maxAttempts: 5, maxPerMinute: 30 })).toEqual({ maxAttempts: 5, maxPerMinute: 30 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ __model: 'Configuration', hotelId: 'platform', key: QUEUE_CONFIG_KEY })

    expect(await store.guardar({ maxAttempts: 2, maxPerMinute: 10 })).toEqual({ maxAttempts: 2, maxPerMinute: 10 })
    expect(rows).toHaveLength(1) // sigue siendo LA MISMA fila: update, no create
    expect(JSON.parse(rows[0]!.value)).toEqual({ maxAttempts: 2, maxPerMinute: 10 })
    expect(await store.leer()).toEqual({ maxAttempts: 2, maxPerMinute: 10 })
  })

  it('un patch parcial conserva el otro campo', async () => {
    const { orm } = makeOrm([configRow(JSON.stringify({ maxAttempts: 8, maxPerMinute: 45 }))])
    const store = createQueueConfigStore(orm)

    expect(await store.guardar({ maxPerMinute: 12 })).toEqual({ maxAttempts: 8, maxPerMinute: 12 })
    expect(await store.leer()).toEqual({ maxAttempts: 8, maxPerMinute: 12 })
  })

  it('un patch fuera de rango deja la config en el default, no a medias', async () => {
    const { orm } = makeOrm([configRow(JSON.stringify({ maxAttempts: 8, maxPerMinute: 45 }))])
    const store = createQueueConfigStore(orm)

    expect(await store.guardar({ maxAttempts: 999 })).toEqual({
      maxAttempts: QUEUE_CONFIG_DEFAULTS.maxAttempts,
      maxPerMinute: 45,
    })
  })
})
