// monitoring/tests/error-logs.test.ts — Registro persistido de errores (REQ-MON-02).
//
// Lo que se afirma acá es el contrato del design: agrupación por (path, message) con contador,
// escritura fire-and-forget que NUNCA cambia la respuesta al cliente (se prueba con el middleware
// httpMetrics REAL y un repositorio que rechaza), orden por lastSeenAt desc y retención por días.
// Repositorio en memoria: sin base, sin reloj real.

import { describe, it, expect } from 'bun:test'
import type { Logger } from 'arckode-framework'
import { HttpMetricsStore } from '../../../shared/observability/metrics'
import { httpMetrics, type ErrorEvent } from '../../../shared/observability/http-metrics'
import { ErrorLogs, resolveRetentionDays, normalizeLimit, DEFAULT_ERROR_LOG_RETENTION_DAYS, type ErrorLogsRepo } from '../usecases/error-logs'
import type { ErrorLogRow } from '../types'

const warns: unknown[] = []
const LOG = { info: () => {}, warn: (...a: unknown[]) => { warns.push(a) }, error: () => {}, debug: () => {}, child: () => LOG } as unknown as Logger

const matchea = (row: ErrorLogRow, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)

/** Repo en memoria con la semántica de OrmRepository: igualdad exacta, orderBy y limit. */
function makeRepo(seed: ErrorLogRow[] = []) {
  const rows: ErrorLogRow[] = seed.map((r) => ({ ...r }))
  let seq = 0
  const repo: ErrorLogsRepo = {
    async findOne(where) { return rows.find((r) => matchea(r, where)) ?? null },
    async findMany(where = {}, options = {}) {
      let out = rows.filter((r) => matchea(r, where))
      const ob = Array.isArray(options.orderBy) ? options.orderBy[0] : options.orderBy
      if (ob) {
        const f = ob.field as keyof ErrorLogRow
        out = [...out].sort((a, b) => String(a[f]).localeCompare(String(b[f])) * (ob.dir === 'DESC' ? -1 : 1))
      }
      if (options.limit) out = out.slice(0, options.limit)
      return out
    },
    async create(data) { const row = { id: `e${++seq}`, ...data } as ErrorLogRow; rows.push(row); return row },
    async update(id, patch) { const row = rows.find((r) => r.id === id); if (!row) return null; Object.assign(row, patch); return row },
    async delete(id) { const i = rows.findIndex((r) => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true },
  }
  return { repo, rows }
}

const evento = (over: Partial<ErrorEvent> = {}): ErrorEvent => ({
  method: 'GET', path: '/api/reservas/:id', statusCode: 500, message: 'boom', ...over,
})

describe('ErrorLogs.record — agrupación por (path, message)', () => {
  it('12 errores iguales → UNA fila con count 12 y lastSeenAt de la última', async () => {
    const { repo, rows } = makeRepo()
    let t = 0
    const logs = new ErrorLogs(repo, LOG, { now: () => new Date(Date.UTC(2026, 8, 10, 12, 0, t++)) })
    // Disparados TODOS sin await: es exactamente cómo los llama el middleware.
    for (let i = 0; i < 12; i++) logs.record(evento({ stack: i === 0 ? 'Error: boom\n  at x' : undefined }))
    await logs.flush()

    expect(rows).toHaveLength(1)
    expect(rows[0]!.count).toBe(12)
    expect(rows[0]!.firstSeenAt).toBe('2026-09-10T12:00:00.000Z')
    expect(rows[0]!.lastSeenAt).toBe('2026-09-10T12:00:11.000Z')
    expect(rows[0]!.stack).toBe('Error: boom\n  at x')
    expect(rows[0]!.method).toBe('GET')
    expect(rows[0]!.statusCode).toBe(500)
  })

  it('distinto path o distinto mensaje → filas distintas', async () => {
    const { repo, rows } = makeRepo()
    const logs = new ErrorLogs(repo, LOG)
    logs.record(evento())
    logs.record(evento({ path: '/api/hoteles' }))
    logs.record(evento({ message: 'otro' }))
    logs.record(evento({ hotelId: 'h1' }))
    await logs.flush()
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.path === '/api/reservas/:id' && r.message === 'boom')!.count).toBe(2)
    expect(rows.find((r) => r.path === '/api/reservas/:id' && r.message === 'boom')!.hotelId).toBeNull()
  })

  it('un 429 sin mensaje se guarda con "HTTP 429" como mensaje', async () => {
    const { repo, rows } = makeRepo()
    const logs = new ErrorLogs(repo, LOG)
    logs.record(evento({ statusCode: 429, message: '' }))
    await logs.flush()
    expect(rows[0]!.message).toBe('HTTP 429')
  })
})

describe('ErrorLogs.record — fire-and-forget', () => {
  it('un repositorio que rechaza no lanza, no rechaza y queda logueado', async () => {
    warns.length = 0
    const repo: ErrorLogsRepo = {
      findOne: async () => { throw new Error('db caída') },
      findMany: async () => [], create: async () => { throw new Error('db caída') }, update: async () => null, delete: async () => false,
    }
    const logs = new ErrorLogs(repo, LOG)
    expect(() => logs.record(evento())).not.toThrow()
    await logs.flush()
    expect(warns.length).toBe(1)
    // La cadena sigue viva: el siguiente registro no queda pegado al fallo anterior.
    logs.record(evento())
    await logs.flush()
    expect(warns.length).toBe(2)
  })

  it('con el middleware real, un repo que rechaza no cambia la respuesta del handler', async () => {
    const repo: ErrorLogsRepo = {
      findOne: async () => { throw new Error('db caída') },
      findMany: async () => [], create: async () => { throw new Error('db caída') }, update: async () => null, delete: async () => false,
    }
    const logs = new ErrorLogs(repo, LOG)
    const mw = httpMetrics(new HttpMetricsStore(), { onError: (e) => logs.record(e) })
    const req = { method: 'GET', path: '/api/reservas/44', params: {}, query: {}, headers: {}, body: null, id: 'r1' } as any
    const esperado = { status: 500, body: { error: 'se rompió' } }
    const res = await mw(req, async () => esperado)
    expect(res).toBe(esperado)
    await logs.flush()

    const lanzado = new Error('excepción del handler')
    const err = await mw(req, async () => { throw lanzado }).then(() => null, (e) => e)
    expect(err).toBe(lanzado)
    await logs.flush()
  })
})

describe('ErrorLogs.list / remove', () => {
  const fila = (id: string, lastSeenAt: string): ErrorLogRow => ({
    id, method: 'GET', path: `/p/${id}`, statusCode: 500, message: 'm', count: 1, firstSeenAt: lastSeenAt, lastSeenAt,
  })

  it('lista más reciente primero y respeta el limit', async () => {
    const { repo } = makeRepo([fila('a', '2026-09-01T00:00:00.000Z'), fila('b', '2026-09-09T00:00:00.000Z'), fila('c', '2026-09-05T00:00:00.000Z')])
    const logs = new ErrorLogs(repo, LOG)
    expect((await logs.list()).map((r) => r.id)).toEqual(['b', 'c', 'a'])
    expect((await logs.list(2)).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('remove devuelve false para un id inexistente y true cuando borra', async () => {
    const { repo, rows } = makeRepo([fila('a', '2026-09-01T00:00:00.000Z')])
    const logs = new ErrorLogs(repo, LOG)
    expect(await logs.remove('nope')).toBe(false)
    expect(await logs.remove('a')).toBe(true)
    expect(rows).toHaveLength(0)
  })

  it('normalizeLimit: basura → default, tope duro de 200', () => {
    expect(normalizeLimit(undefined)).toBe(50)
    expect(normalizeLimit('todas')).toBe(50)
    expect(normalizeLimit(0)).toBe(50)
    expect(normalizeLimit(7)).toBe(7)
    expect(normalizeLimit(9999)).toBe(200)
  })
})

describe('ErrorLogs.purge — retención por días', () => {
  const fila = (id: string, lastSeenAt: string): ErrorLogRow => ({
    id, method: 'GET', path: `/p/${id}`, statusCode: 500, message: 'm', count: 1, firstSeenAt: lastSeenAt, lastSeenAt,
  })

  it('con filas viejas y nuevas sobreviven sólo las nuevas', async () => {
    const ahora = new Date('2026-09-10T00:00:00.000Z')
    const { repo, rows } = makeRepo([
      fila('vieja1', '2026-07-01T00:00:00.000Z'),
      fila('vieja2', '2026-08-10T23:59:59.000Z'), // 30 días y un segundo
      fila('nueva1', '2026-08-11T00:00:01.000Z'),
      fila('nueva2', '2026-09-09T12:00:00.000Z'),
    ])
    const logs = new ErrorLogs(repo, LOG, { retentionDays: 30, now: () => ahora })
    expect(await logs.purge()).toBe(2)
    expect(rows.map((r) => r.id).sort()).toEqual(['nueva1', 'nueva2'])
  })

  it('resolveRetentionDays: ERROR_LOG_RETENTION_DAYS válido manda; basura → 30', () => {
    expect(resolveRetentionDays({ ERROR_LOG_RETENTION_DAYS: '7' })).toBe(7)
    expect(resolveRetentionDays({ ERROR_LOG_RETENTION_DAYS: '0' })).toBe(DEFAULT_ERROR_LOG_RETENTION_DAYS)
    expect(resolveRetentionDays({ ERROR_LOG_RETENTION_DAYS: 'mucho' })).toBe(DEFAULT_ERROR_LOG_RETENTION_DAYS)
    expect(resolveRetentionDays({})).toBe(DEFAULT_ERROR_LOG_RETENTION_DAYS)
    expect(new ErrorLogs(makeRepo().repo, LOG, { retentionDays: 5 }).retentionDays).toBe(5)
  })
})
