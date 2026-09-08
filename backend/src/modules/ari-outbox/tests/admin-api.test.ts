// ari-outbox/tests/admin-api.test.ts — La API de operación de la cola desde el Super Admin:
// contadores, reintento manual y config (GET/PUT).
//
// Se prueba el HANDLER, no la ruta: el repo no tiene ningún test HTTP y la forma probada (issue
// #50) es llamar al controller directo y mirar `{ status, body }`. Lo que aporta este archivo por
// encima de outbox-admin.test.ts —que ya cubre la aritmética y el saneo— es el CABLEADO: que el
// service arme los puertos sobre el store, que el 404 y el 400 salgan por donde tienen que salir,
// que el PUT rechace basura antes de guardarla y que guardar dispare el hook que le lleva el
// techo de peticiones/minuto al transporte de Channex (sin ese hook, el valor nuevo esperaría al
// próximo reinicio).
//
// Dobles en memoria, mismo estilo que list.test.ts: sin base, sin reloj real, sin flakes.

import { describe, it, expect } from 'bun:test'
import { ErrorContract } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import { AriOutboxController } from '../controller'
import { AriOutboxService, type AriOutboxStore } from '../service'
import { QUEUE_CONFIG_DEFAULTS, type QueueConfig, type QueueConfigStore } from '../usecases/outbox-admin'
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

/**
 * Sembrado pensado para los contadores: una `pending` virgen, una `pending` que ya falló una vez
 * (eso es "en reintento", no un estado de la tabla), una por cada estado cerrado y una de otro
 * hotel para ver que el filtro filtra.
 */
const SEMBRADO: AriOutboxRow[] = [
  fila({ id: 'p1', status: 'pending', attempts: 0 }),
  fila({ id: 'r1', status: 'pending', attempts: 2, lastError: 'Channex 502' }),
  fila({ id: 'w1', status: 'processing' }),
  fila({ id: 's1', status: 'sent', kind: 'inventory' }),
  fila({ id: 'f1', status: 'failed', attempts: 3, lastError: 'Channex 422: rate plan no mapeado' }),
  fila({ id: 'h2p', status: 'pending', hotelId: 'h2' }),
]

const matchea = (row: AriOutboxRow, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)

/** Store en memoria con la semántica de OrmRepository (igualdad exacta), incluido `count`. */
function makeStore(seed: AriOutboxRow[] = SEMBRADO) {
  const rows = seed.map((r) => ({ ...r }))
  const store: AriOutboxStore = {
    async create(row) { rows.push({ ...row }); return row },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id)
      if (!row) return null
      Object.assign(row, patch)
      return row
    },
    async updateWhere(where, patch) {
      const match = rows.filter((r) => matchea(r, where))
      for (const row of match) Object.assign(row, patch)
      return match.length
    },
    async findMany(query) { return rows.filter((r) => matchea(r, query)) },
    async count(filters) { return rows.filter((r) => matchea(r, filters)).length },
    async paginate(filters, options) {
      const match = rows.filter((r) => matchea(r, filters))
      const offset = options.offset ?? 0
      return { data: match.slice(offset, offset + options.limit), total: match.length }
    },
  }
  return { store, rows }
}

/** Config persistida en memoria, con la misma mezcla parcial que hace el store real. */
function makeConfigStore(inicial?: Partial<QueueConfig>) {
  let guardada: QueueConfig = { ...QUEUE_CONFIG_DEFAULTS, ...inicial }
  const config: QueueConfigStore = {
    async leer() { return { ...guardada } },
    async guardar(patch) {
      guardada = { ...guardada, ...patch } as QueueConfig
      return { ...guardada }
    },
  }
  return { config, leerGuardada: () => guardada }
}

function armar(seed?: AriOutboxRow[], cfg?: ReturnType<typeof makeConfigStore>) {
  const { store, rows } = makeStore(seed)
  const service = new AriOutboxService(store, LOG, cfg?.config)
  return { service, controller: new AriOutboxController(service, LOG), rows }
}

/** El request mínimo que el handler mira. El resto lo arma el router, no el controller. */
const req = (over: Record<string, unknown> = {}) => ({ query: {}, params: {}, body: null, ...over }) as any

describe('GET /api/admin/ari-outbox/stats', () => {
  it('devuelve 200 con los contadores, separando pending de retrying', async () => {
    const { controller } = armar()
    const res = await controller.stats(req())
    expect(res.status).toBe(200)
    // p1 y h2p nunca fallaron; r1 es pending con intentos gastados = en reintento.
    expect(res.body).toEqual({ pending: 2, retrying: 1, processing: 1, sent: 1, failed: 1, total: 6 })
  })

  it('respeta el filtro por hotel', async () => {
    const { controller } = armar()
    const res = await controller.stats(req({ query: { hotelId: 'h2' } }))
    expect(res.body).toEqual({ pending: 1, retrying: 0, processing: 0, sent: 0, failed: 0, total: 1 })
  })
})

describe('POST /api/admin/ari-outbox/:id/retry', () => {
  it('devuelve 200 y deja la fila failed lista para salir de nuevo', async () => {
    const { controller, rows } = armar()
    const res = await controller.retry(req({ params: { id: 'f1' } }))
    expect(res.status).toBe(200)
    expect((res.body as any).item.id).toBe('f1')

    const guardada = rows.find((r) => r.id === 'f1')!
    expect(guardada.status).toBe('pending')
    expect(guardada.attempts).toBe(0)
    // Sin limpiar el error y el dueño la fila quedaría mostrando un motivo viejo y sin poder
    // reclamarse en el próximo drain.
    expect(guardada.lastError).toBeNull()
    expect(guardada.claimedBy).toBeNull()
  })

  it('un id inexistente termina en NotFoundError (404), no en un 200 con item null', async () => {
    const { controller } = armar()
    const err = await controller.retry(req({ params: { id: 'no-existe' } })).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as ErrorContract).httpStatus).toBe(404)
  })

  it('sin id en la ruta devuelve 400 y no toca nada', async () => {
    const { controller, rows } = armar()
    const res = await controller.retry(req())
    expect(res.status).toBe(400)
    expect(rows.find((r) => r.id === 'f1')!.status).toBe('failed')
  })
})

describe('GET/PUT /api/admin/ari-outbox/config', () => {
  it('sin nada guardado devuelve 200 con los defaults del código', async () => {
    const { controller } = armar([], makeConfigStore())
    const res = await controller.getConfig(req())
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('sin puerto de config cableado el endpoint sigue respondiendo los defaults', async () => {
    const { controller } = armar([])
    expect((await controller.getConfig(req())).body).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('el PUT persiste el patch parcial y avisa al transporte con la config final', async () => {
    const cfg = makeConfigStore()
    const { controller, service } = armar([], cfg)
    const avisos: QueueConfig[] = []
    service.setSockets({ onQueueConfigChanged: async (c) => { avisos.push(c) } })

    const res = await controller.putConfig(req({ body: { maxPerMinute: 25 } }))
    expect(res.status).toBe(200)
    // El patch parcial NO puede pisar el otro campo con el default.
    expect(res.body).toEqual({ maxAttempts: QUEUE_CONFIG_DEFAULTS.maxAttempts, maxPerMinute: 25 })
    expect(cfg.leerGuardada()).toEqual({ maxAttempts: QUEUE_CONFIG_DEFAULTS.maxAttempts, maxPerMinute: 25 })
    // Sin este aviso el techo nuevo recién regiría en el próximo reinicio.
    expect(avisos).toEqual([{ maxAttempts: QUEUE_CONFIG_DEFAULTS.maxAttempts, maxPerMinute: 25 }])
  })

  it('un maxPerMinute que no es número se rechaza con 400 y no se guarda', async () => {
    const cfg = makeConfigStore()
    const { controller } = armar([], cfg)
    const err = await controller.putConfig(req({ body: { maxPerMinute: 'muchas' } })).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as ErrorContract).httpStatus).toBe(400)
    expect(cfg.leerGuardada()).toEqual({ ...QUEUE_CONFIG_DEFAULTS })
  })

  it('applyQueueConfig emite lo guardado al arrancar (lo llama composition-root)', async () => {
    const cfg = makeConfigStore({ maxPerMinute: 7 })
    const { service } = armar([], cfg)
    const avisos: QueueConfig[] = []
    service.setSockets({ onQueueConfigChanged: async (c) => { avisos.push(c) } })
    await service.applyQueueConfig()
    expect(avisos).toEqual([{ maxAttempts: QUEUE_CONFIG_DEFAULTS.maxAttempts, maxPerMinute: 7 }])
  })
})
