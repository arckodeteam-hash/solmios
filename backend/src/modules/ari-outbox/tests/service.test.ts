// ari-outbox/tests/service.test.ts — Lo que el SERVICE aporta por encima del usecase.
//
// La lógica de agrupación/backoff/publicación ya está probada en outbox-queue.test.ts y la forma
// del endpoint en list.test.ts. Acá se prueba la capa delgada de service.ts, que igual tiene dos
// responsabilidades propias: (a) los defaults y topes del listado —límite, tope duro, offset y
// orden— que el controller NO calcula, y (b) que schedule/drain/registerPublisher delegan de
// verdad en la cola y no son métodos huecos.
//
// El puerto es un array en memoria con la semántica de OrmRepository (igualdad exacta + orderBy +
// offset/limit): sin DB ni reloj real, como el resto de los tests del módulo.

import { describe, it, expect } from 'bun:test'
import type { Logger } from 'arckode-framework'
import {
  AriOutboxService,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  type AriOutboxStore,
} from '../service'
import type { AriOutboxRow } from '../types'

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

interface PaginateCall {
  filters: Record<string, unknown>
  options: { offset?: number; limit: number; orderBy?: unknown }
}

/** Store falso que además ANOTA cómo lo llamó el service (lo que se quiere verificar acá). */
function makeStore(seed: AriOutboxRow[] = []) {
  const rows = seed.map((r) => ({ ...r }))
  const calls: PaginateCall[] = []
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
      calls.push({ filters: { ...filters }, options: options as PaginateCall['options'] })
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
  return { store, rows, calls }
}

describe('AriOutboxService.list', () => {
  it('sin limit aplica el default de 50', async () => {
    const { store, calls } = makeStore()
    const res = await new AriOutboxService(store, LOG).list({})

    expect(calls[0]?.options.limit).toBe(DEFAULT_LIST_LIMIT)
    expect(DEFAULT_LIST_LIMIT).toBe(50)
    expect(res.limit).toBe(DEFAULT_LIST_LIMIT)
    expect(res.page).toBe(1)
  })

  it('respeta el tope duro: pedir 500 devuelve 200', async () => {
    const { store, calls } = makeStore()
    const res = await new AriOutboxService(store, LOG).list({ limit: 500 })

    expect(calls[0]?.options.limit).toBe(MAX_LIST_LIMIT)
    expect(MAX_LIST_LIMIT).toBe(200)
    expect(res.limit).toBe(200)
  })

  it('un limit basura (0, negativo, NaN) cae al default en vez de pedir 0 filas', async () => {
    const { store, calls } = makeStore()
    const svc = new AriOutboxService(store, LOG)
    await svc.list({ limit: 0 })
    await svc.list({ limit: -5 })
    await svc.list({ limit: Number('x') })

    expect(calls.map((c) => c.options.limit)).toEqual([DEFAULT_LIST_LIMIT, 1, DEFAULT_LIST_LIMIT])
  })

  it('la paginación calcula el offset: page 3 con limit 10 → offset 20', async () => {
    const { store, calls } = makeStore()
    const res = await new AriOutboxService(store, LOG).list({ page: 3, limit: 10 })

    expect(calls[0]?.options.offset).toBe(20)
    expect(calls[0]?.options.limit).toBe(10)
    expect(res.page).toBe(3)
  })

  it('page 0 o negativa no genera un offset negativo: se normaliza a la 1', async () => {
    const { store, calls } = makeStore()
    const res = await new AriOutboxService(store, LOG).list({ page: 0, limit: 10 })

    expect(calls[0]?.options.offset).toBe(0)
    expect(res.page).toBe(1)
  })

  it('ordena por scheduledAt DESC: lo último agendado primero', async () => {
    const { store, calls } = makeStore([
      fila({ id: 'vieja', scheduledAt: '2026-09-07T10:00:01.000Z' }),
      fila({ id: 'nueva', scheduledAt: '2026-09-07T10:00:03.000Z' }),
      fila({ id: 'media', scheduledAt: '2026-09-07T10:00:02.000Z' }),
    ])
    const res = await new AriOutboxService(store, LOG).list({})

    expect(calls[0]?.options.orderBy).toEqual({ field: 'scheduledAt', dir: 'DESC' })
    expect(res.items.map((r) => r.id)).toEqual(['nueva', 'media', 'vieja'])
    expect(res.total).toBe(3)
  })

  it('solo manda al repo los filtros presentes (un status vacío no filtra por cadena vacía)', async () => {
    const { store, calls } = makeStore()
    const svc = new AriOutboxService(store, LOG)
    await svc.list({ hotelId: 'h2', status: 'failed', kind: 'inventory' })
    await svc.list({ hotelId: undefined, status: '' })

    expect(calls[0]?.filters).toEqual({ hotelId: 'h2', status: 'failed', kind: 'inventory' })
    expect(calls[1]?.filters).toEqual({})
  })
})

describe('AriOutboxService: delegación en la cola', () => {
  it('schedule persiste la ráfaga como pending y drain la publica con el publisher registrado', async () => {
    const { store, rows } = makeStore()
    const svc = new AriOutboxService(store, LOG)
    const pushes: Array<[string, string | undefined]> = []
    svc.registerPublisher('rates', { push: async (hotelId, channel) => { pushes.push([hotelId, channel]) } })

    await svc.schedule('h1', 'rates', ['OpenChannel'])

    // La fila está ESCRITA antes de que venza el debounce: el punto entero de la outbox.
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ hotelId: 'h1', kind: 'rates', status: 'pending', channels: ['OpenChannel'], attempts: 0 })
    expect(await svc.drain()).toBe(0) // todavía no vence: nada que publicar
    expect(pushes).toHaveLength(0)

    // Vencido el debounce (se adelanta el reloj de la fila, no el del proceso):
    rows[0]!.scheduledAt = '2020-01-01T00:00:00.000Z'
    expect(await svc.drain()).toBe(1)

    expect(pushes).toEqual([['h1', 'OpenChannel']])
    expect(rows[0]!.status).toBe('sent')
  })

  it('sin publisher registrado la fila falla con un lastError legible en vez de tirar', async () => {
    const { store, rows } = makeStore([fila({ id: 'r1', scheduledAt: '2020-01-01T00:00:00.000Z', maxAttempts: 1 })])
    const svc = new AriOutboxService(store, LOG)

    expect(await svc.drain()).toBe(1)

    expect(rows[0]!.status).toBe('failed')
    expect(rows[0]!.lastError).toContain("sin publisher registrado para kind 'rates'")
  })

  it('reclaimStale devuelve a pending las filas que otro proceso tomó y nunca cerró', async () => {
    const viejo = new Date(Date.now() - 60 * 60_000).toISOString()
    const { store, rows } = makeStore([
      fila({ id: 'colgada', status: 'processing', updatedAt: viejo }),
      fila({ id: 'reciente', status: 'processing', updatedAt: new Date().toISOString() }),
    ])
    const svc = new AriOutboxService(store, LOG)

    expect(await svc.reclaimStale()).toBe(1)

    expect(rows.find((r) => r.id === 'colgada')!.status).toBe('pending')
    expect(rows.find((r) => r.id === 'reciente')!.status).toBe('processing')
  })
})
