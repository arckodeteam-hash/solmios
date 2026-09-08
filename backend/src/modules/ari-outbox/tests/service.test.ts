// ari-outbox/tests/service.test.ts — Lo que el SERVICE aporta por encima del usecase.
//
// La lógica de agrupación/backoff/publicación ya está probada en outbox-queue.test.ts y la forma
// del endpoint en list.test.ts. Acá se prueba la capa delgada de service.ts, que igual tiene dos
// responsabilidades propias: (a) los defaults y topes del listado —límite, tope duro, offset y
// orden— que el controller NO calcula, (b) que schedule/drain/registerPublisher delegan de
// verdad en la cola y no son métodos huecos, (c) que los sockets se emiten cuando una fila se
// cierra y que un hook roto no corta el drenado, y (d) que el controller RECHAZA un query
// inválido con 400 en vez de bajar el filtro crudo al repositorio y devolver una lista vacía.
//
// El puerto es un array en memoria con la semántica de OrmRepository (igualdad exacta + orderBy +
// offset/limit): sin DB ni reloj real, como el resto de los tests del módulo.

import { describe, it, expect } from 'bun:test'
import { ErrorContract } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import { AriOutboxController } from '../controller'
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

/** Dos filas de dos estados: alcanza para ver que el filtro válido filtra y no devuelve todo. */
const SEMBRADO: AriOutboxRow[] = [
  fila({ id: 'f1', status: 'failed', lastError: 'Channex 422' }),
  fila({ id: 'p1', status: 'pending' }),
]

/**
 * Igualdad del CAS: matchea si TODOS los pares de `where` coinciden, tratando `undefined` y `null`
 * como el mismo "sin valor" (una fila vieja trae `claimedBy` ausente donde la tabla guarda NULL).
 */
function matchea(row: AriOutboxRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = (row as unknown as Record<string, unknown>)[k]
    if (v === null || v === undefined) return actual === null || actual === undefined
    return actual === v
  })
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
    /** El CAS del reclamo: actualiza lo que matchea y devuelve el conteo (orm.updateMany). */
    async updateWhere(where, patch) {
      const match = rows.filter((r) => matchea(r, where))
      for (const row of match) Object.assign(row, patch, { updatedAt: new Date().toISOString() })
      return match.length
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

describe('AriOutboxService: sockets (hooks opcionales hacia otros módulos)', () => {
  /** Fila ya vencida: el drain la toma en la primera pasada. */
  const vencida = (over: Partial<AriOutboxRow> & { id: string }) =>
    fila({ scheduledAt: '2020-01-01T00:00:00.000Z', ...over })

  it('onAriOutboxSent se emite con la fila cerrada cuando el push sale bien', async () => {
    const { store, rows } = makeStore([vencida({ id: 'r1' })])
    const svc = new AriOutboxService(store, LOG)
    svc.registerPublisher('rates', { push: async () => {} })
    const enviadas: AriOutboxRow[] = []
    const fallidas: AriOutboxRow[] = []
    svc.setSockets({
      onAriOutboxSent: async (row) => { enviadas.push(row) },
      onAriOutboxFailed: async (row) => { fallidas.push(row) },
    })

    expect(await svc.drain()).toBe(1)

    expect(enviadas.map((r) => r.id)).toEqual(['r1'])
    expect(enviadas[0]).toMatchObject({ id: 'r1', hotelId: 'h1', kind: 'rates', status: 'sent' })
    expect(fallidas).toEqual([])
    expect(rows[0]!.status).toBe('sent')
  })

  it('onAriOutboxFailed se emite SOLO en el fallo definitivo, no en cada reintento', async () => {
    const { store, rows } = makeStore([vencida({ id: 'r1', maxAttempts: 2 })])
    const svc = new AriOutboxService(store, LOG)
    svc.registerPublisher('rates', { push: async () => { throw new Error('channex caído') } })
    const fallidas: AriOutboxRow[] = []
    svc.setSockets({ onAriOutboxFailed: async (row) => { fallidas.push(row) } })

    await svc.drain()
    // Primer intento: vuelve a pending con backoff → todavía NO se avisa.
    expect(rows[0]!.status).toBe('pending')
    expect(fallidas).toEqual([])

    rows[0]!.scheduledAt = '2020-01-01T00:00:00.000Z' // vence el backoff
    await svc.drain()

    expect(rows[0]!.status).toBe('failed')
    expect(fallidas.map((r) => r.id)).toEqual(['r1'])
    expect(fallidas[0]).toMatchObject({ status: 'failed', attempts: 2, lastError: 'channex caído' })
  })

  it('sin sockets cableados el drain publica igual: los hooks son OPCIONALES', async () => {
    const { store, rows } = makeStore([vencida({ id: 'r1' })])
    const svc = new AriOutboxService(store, LOG)
    svc.registerPublisher('rates', { push: async () => {} })

    expect(await svc.drain()).toBe(1)
    expect(rows[0]!.status).toBe('sent')
  })

  it('un hook que tira NO rompe el drenado: se loguea y las filas siguientes se publican', async () => {
    const { store, rows } = makeStore([
      vencida({ id: 'r1', hotelId: 'h1' }),
      vencida({ id: 'r2', hotelId: 'h2' }),
    ])
    const avisos: unknown[] = []
    const log = { ...LOG, warn: (...a: unknown[]) => { avisos.push(a) }, child: () => log } as unknown as Logger
    const svc = new AriOutboxService(store, log)
    const pushes: string[] = []
    svc.registerPublisher('rates', { push: async (hotelId) => { pushes.push(hotelId) } })
    svc.setSockets({ onAriOutboxSent: async () => { throw new Error('el conector explotó') } })

    expect(await svc.drain()).toBe(2)

    expect(pushes).toEqual(['h1', 'h2'])                      // el drenado siguió
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent']) // y las filas quedaron cerradas
    expect(avisos).toHaveLength(2)                             // pero se logueó cada vez
  })

  it('setSockets ACUMULA: dos conectores enganchados al mismo evento reciben los dos', async () => {
    const { store } = makeStore([vencida({ id: 'r1' })])
    const svc = new AriOutboxService(store, LOG)
    svc.registerPublisher('rates', { push: async () => {} })
    const vistos: string[] = []
    svc.setSockets({ onAriOutboxSent: async () => { vistos.push('a') } })
    svc.setSockets({ onAriOutboxSent: async () => { vistos.push('b') } })

    await svc.drain()

    expect(vistos).toEqual(['a', 'b'])
  })
})

describe('GET /api/admin/ari-outbox — el query se valida antes de bajar al repositorio', () => {
  const handler = () => new AriOutboxController(new AriOutboxService(makeStore(SEMBRADO).store, LOG), LOG)
  const req = (query: Record<string, string>) => ({ query }) as any

  /**
   * Lo mismo que hace el router con lo que tira un handler (router.ts:104-107): un ErrorContract
   * se convierte en su httpStatus + toJSON(). Se replica acá porque el repo no tiene tests HTTP
   * (issue #50): así el caso afirma el 400 REAL que ve el cliente, no solo que algo tiró.
   */
  async function responder(query: Record<string, string>) {
    try {
      return await handler().index(req(query))
    } catch (err: unknown) {
      if (err instanceof ErrorContract) return { status: err.httpStatus, body: err.toJSON() as any }
      throw err
    }
  }

  it('un status fuera del conjunto válido da 400, no una lista vacía en silencio', async () => {
    const res = await responder({ status: 'basura' })

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('status')
  })

  it('un kind fuera del conjunto válido da 400', async () => {
    const res = await responder({ kind: 'precios' })

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('kind')
  })

  it('los filtros válidos siguen pasando con 200 y filtran de verdad', async () => {
    const res = await responder({ status: 'failed', kind: 'rates', hotelId: 'h1' })

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.items.map((r: AriOutboxRow) => r.id)).toEqual(['f1'])
  })

  it('page/limit basura NO son 400: el service los normaliza (el listado no se rompe)', async () => {
    const res = await responder({ limit: 'todas', page: '-3' })

    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(DEFAULT_LIST_LIMIT)
    expect(res.body.page).toBe(1)
  })
})
