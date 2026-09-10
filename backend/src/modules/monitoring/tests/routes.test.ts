// monitoring/tests/routes.test.ts — Las 9 rutas del módulo a nivel de RUTA REAL (router.resolve).
//
// Monta el módulo `monitoring` REAL sobre un Router y un HotelAuth reales (mismo criterio que
// admin/tests/billing.test.ts) con un ORM en memoria CON DATOS y un BackupsStore REAL sobre un
// directorio temporal. Lo que se verifica no es que el handler exista, sino el guard de plataforma
// (merchant → 403 en las nueve, y NINGÚN archivo creado), el 404 de una descarga inexistente, el
// audit de crear/descargar y que lo que sale por HTTP sea lo que las fuentes miden.

import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Router } from 'arckode-framework'
import { makeAuth, fakeLogger } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { HttpMetricsStore } from '../../../shared/observability/metrics'
import { BackupsStore } from '../../../shared/observability/backups'
import type { BackupDump } from '../../../shared/observability/backup-dump'
import type { AuditEntry } from '../../../shared/usecases/audit'
import { MonitoringModule } from '../index'
import type { MonitoringService } from '../service'

const ENDPOINTS: Array<[string, string]> = [
  ['GET', '/api/admin/monitoring/api'],
  ['GET', '/api/admin/monitoring/errors'],
  ['DELETE', '/api/admin/monitoring/errors/err-1'],
  ['GET', '/api/admin/monitoring/system'],
  ['GET', '/api/admin/monitoring/queues'],
  ['GET', '/api/admin/backups'],
  ['POST', '/api/admin/backups'],
  ['GET', '/api/admin/backups/backup-a.sqlite/download'],
  ['DELETE', '/api/admin/backups/backup-a.sqlite'],
]

/** ORM en memoria con orderBy/limit y count por filtros: lo que usan OrmRepository y las lecturas. */
function ormWith(tables: Record<string, any[]>): any {
  const store: Record<string, any[]> = JSON.parse(JSON.stringify(tables))
  const match = (row: any, filters: Record<string, unknown> = {}) =>
    Object.entries(filters).every(([k, v]) => row[k] === v)
  const orm: any = {
    define() { return orm },
    findMany: async (table: string, filters?: any, options: any = {}) => {
      let out = (store[table] ?? []).filter((r) => match(r, filters))
      const ob = Array.isArray(options.orderBy) ? options.orderBy[0] : options.orderBy
      if (ob) out = [...out].sort((a, b) => String(a[ob.field] ?? '').localeCompare(String(b[ob.field] ?? '')) * (ob.dir === 'DESC' ? -1 : 1))
      if (options.limit) out = out.slice(0, options.limit)
      return out
    },
    findById: async (table: string, id: string) => (store[table] ?? []).find((r) => r.id === id) ?? null,
    findOne: async (table: string, filters?: any) => (store[table] ?? []).find((r) => match(r, filters)) ?? null,
    create: async (table: string, data: any) => { const row = { id: `${table}-${(store[table] ?? []).length + 1}`, ...data }; store[table] = [...(store[table] ?? []), row]; return row },
    update: async (table: string, id: string, data: any) => { const row = (store[table] ?? []).find((r) => r.id === id); if (row) Object.assign(row, data); return row ?? null },
    delete: async (table: string, id: string) => { const rows = store[table] ?? []; const i = rows.findIndex((r) => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true },
    count: async (table: string, filters?: any) => (store[table] ?? []).filter((r) => match(r, filters)).length,
    paginate: async (table: string) => ({ data: store[table] ?? [], total: (store[table] ?? []).length, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
    store,
  }
  return orm
}

const ERRORS = [
  { id: 'err-1', method: 'GET', path: '/api/reservas/:id', statusCode: 500, message: 'boom', count: 3, firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-09T00:00:00.000Z' },
  { id: 'err-2', method: 'POST', path: '/api/pagos', statusCode: 503, message: 'gateway', count: 1, firstSeenAt: '2026-09-10T00:00:00.000Z', lastSeenAt: '2026-09-10T00:00:00.000Z' },
]
const EMAILS = [
  { id: 'm1', status: 'pending' }, { id: 'm2', status: 'pending' }, { id: 'm3', status: 'pending' }, { id: 'm4', status: 'pending' },
  { id: 'm5', status: 'failed' }, { id: 'm6', status: 'sent', updatedAt: '2026-09-10T08:00:00.000Z' },
]
const DELIVERIES = [
  { id: 'd1', webhookId: 'w1', event: 'reservation.created', statusCode: 500, success: 0, attemptedAt: '2026-09-10T09:05:00.000Z' },
  { id: 'd2', webhookId: 'w1', event: 'reservation.created', statusCode: 200, success: 1, attemptedAt: '2026-09-10T09:00:00.000Z' },
]

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function mount(dumpOverride?: BackupDump) {
  const dir = mkdtempSync(join(tmpdir(), 'monitoring-routes-'))
  dirs.push(dir)
  const corridas: string[] = []
  const dump: BackupDump = dumpOverride ?? { motor: 'sqlite', extension: 'sqlite', run: async ({ destino }) => { corridas.push(destino); await writeFile(destino, 'contenido-del-backup') } }
  const store = new BackupsStore({ dir, retentionCount: 5 })
  const metrics = new HttpMetricsStore()
  metrics.record({ method: 'GET', route: '/api/hoteles', status: 200, durationMs: 12 })

  const router = new Router()
  const auth = makeAuth()
  const orm = ormWith({ ErrorLogs: ERRORS, EmailQueue: EMAILS, WebhookDelivery: DELIVERIES })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
  const mod = MonitoringModule({
    metrics,
    systemHealth: { read: async () => ({ proceso: { uptimeS: 5, memoriaRssMb: 50, memoriaHeapMb: 20, cpuPct: 1.5 }, so: { uptimeS: 900, cargas: [0.5, 0.4, 0.3], memoriaTotalMb: 8000, memoriaLibreMb: 4000 } }) },
    dbHealth: async () => ({ motor: 'sqlite' as const, tamanoBytes: 4096, tablas: 12 }),
    backups: { store, dump },
  })
  // `as any` igual que `mountModule` del helper: se inyectan solo los deps que el módulo usa.
  const service = (mod as any).create({ logger: fakeLogger(), orm, cache, router, auth }) as MonitoringService
  const auditadas: AuditEntry[] = []
  service.setAuditDeps({ record: async (e) => { auditadas.push(e) } })
  service.setAriOutboxPort({ stats: async () => ({ pending: 2, processing: 0, sent: 7, failed: 1, retrying: 0, total: 10 }) })

  const admin = { authorization: `Bearer ${auth.createToken({ id: 'user-super_admin', role: 'super_admin', hotelId: 'platform', userType: 'admin' })}` }
  const merchant = { authorization: `Bearer ${auth.createToken({ id: 'user-hotel_admin', role: 'hotel_admin', hotelId: 'h1', userType: 'merchant' })}` }
  const call = (method: string, path: string, headers?: Record<string, string>, body: unknown = null) =>
    router.resolve(method, path, { ...(headers ? { headers } : {}), query: {}, body })
  return { router, orm, admin, merchant, call, dir, corridas, auditadas, service }
}

describe('guard de plataforma — merchant → 403 en los 9 endpoints', () => {
  it('un merchant autenticado no entra a ninguna ruta y no se crea ningún archivo', async () => {
    const { call, merchant, dir, corridas, auditadas } = mount()
    for (const [method, path] of ENDPOINTS) {
      const res = await call(method, path, merchant)
      expect(`${method} ${path} → ${res.status}`).toBe(`${method} ${path} → 403`)
    }
    expect(corridas).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(auditadas).toEqual([])
  })

  it('sin token → 401 en todas', async () => {
    const { call } = mount()
    for (const [method, path] of ENDPOINTS) expect((await call(method, path)).status).toBe(401)
  })
})

describe('GET /api/admin/monitoring/*', () => {
  it('api devuelve el snapshot de métricas con la ruta registrada', async () => {
    const { call, admin } = mount()
    const res = await call('GET', '/api/admin/monitoring/api', admin)
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.totales.peticiones).toBe(1)
    expect(body.rutas[0]).toMatchObject({ ruta: '/api/hoteles', metodo: 'GET', count: 1 })
    expect(typeof body.ventanaDesde).toBe('string')
  })

  it('errors lista más reciente primero y DELETE /:id la saca (404 si no está)', async () => {
    const { call, admin, orm } = mount()
    const res = await call('GET', '/api/admin/monitoring/errors', admin)
    expect(res.status).toBe(200)
    expect((res.body as any).items.map((e: any) => e.id)).toEqual(['err-2', 'err-1'])

    expect((await call('DELETE', '/api/admin/monitoring/errors/err-1', admin)).status).toBe(204)
    expect(orm.store.ErrorLogs.map((e: any) => e.id)).toEqual(['err-2'])
    expect((await call('DELETE', '/api/admin/monitoring/errors/err-1', admin)).status).toBe(404)
  })

  it('errors?limit=abc → 400 (validación de query)', async () => {
    const { router, admin } = mount()
    const res = await router.resolve('GET', '/api/admin/monitoring/errors', { headers: admin, query: { limit: 'abc' } })
    expect(res.status).toBe(400)
  })

  it('system trae proceso/so/db de los puertos y omite lo no cableado (uploads)', async () => {
    const { call, admin } = mount()
    const res = await call('GET', '/api/admin/monitoring/system', admin)
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.proceso.cpuPct).toBe(1.5)
    expect(body.db).toEqual({ motor: 'sqlite', tamanoBytes: 4096, tablas: 12 })
    expect('uploads' in body).toBe(false)
    expect('disco' in body).toBe(false)
  })

  it('queues junta email (4 pendientes), ari-outbox (por el puerto) y la entrega fallida con su 500', async () => {
    const { call, admin } = mount()
    const res = await call('GET', '/api/admin/monitoring/queues', admin)
    expect(res.status).toBe(200)
    const body = res.body as any
    expect(body.email).toMatchObject({ pending: 4, failed: 1, sent: 1, total: 6, ultimoProcesadoEn: '2026-09-10T08:00:00.000Z' })
    expect(body.ariOutbox).toEqual({ pending: 2, processing: 0, sent: 7, failed: 1, retrying: 0, total: 10 })
    expect(body.webhooks.ultimasEntregas[0]).toMatchObject({ id: 'd1', event: 'reservation.created', statusCode: 500, success: false })
  })
})

describe('/api/admin/backups — crear, listar, descargar, borrar', () => {
  it('POST crea el archivo en el directorio, lo audita y GET lo lista', async () => {
    const { call, admin, dir, corridas, auditadas } = mount()
    const res = await call('POST', '/api/admin/backups', admin, {})
    expect(res.status).toBe(201)
    const creado = (res.body as any).archivo
    expect(creado.id).toMatch(/^backup-.*\.sqlite$/)
    expect(corridas).toHaveLength(1)
    expect(readdirSync(dir)).toEqual([creado.id])
    expect(auditadas).toHaveLength(1)
    expect(auditadas[0]).toMatchObject({ userId: 'user-super_admin', action: 'backup.create', entityId: creado.id })

    const list = await call('GET', '/api/admin/backups', admin)
    expect(list.status).toBe(200)
    expect((list.body as any).items.map((f: any) => f.id)).toEqual([creado.id])
  })

  it('un dump que falla (binario ausente) → 503 con el motivo, sin archivo y sin audit', async () => {
    const roto: BackupDump = { motor: 'postgres', extension: 'sql', run: async () => { throw new Error('No se encontró el binario pg_dump en el servidor') } }
    const { call, admin, dir, auditadas } = mount(roto)
    const res = await call('POST', '/api/admin/backups', admin, {})
    expect(res.status).toBe(503)
    expect((res.body as any).error).toContain('pg_dump')
    expect(readdirSync(dir)).toEqual([])
    expect(auditadas).toEqual([])
  })

  it('GET /:id/download devuelve el archivo crudo (Buffer) con headers de descarga y lo audita', async () => {
    const { call, admin, auditadas } = mount()
    const creado = ((await call('POST', '/api/admin/backups', admin, {})).body as any).archivo
    const res = await call('GET', `/api/admin/backups/${creado.id}/download`, admin)
    expect(res.status).toBe(200)
    expect(Buffer.isBuffer(res.body)).toBe(true)
    expect((res.body as Buffer).toString()).toBe('contenido-del-backup')
    expect(res.headers?.['Content-Type']).toBe('application/octet-stream')
    expect(res.headers?.['Content-Disposition']).toBe(`attachment; filename="${creado.id}"`)
    expect(auditadas.map((a) => a.action)).toEqual(['backup.create', 'backup.download'])
    expect(auditadas[1]).toMatchObject({ userId: 'user-super_admin', entityId: creado.id })
  })

  it('descarga con id inexistente → 404 y sin audit; con traversal en el id → 400/404', async () => {
    const { call, admin, auditadas } = mount()
    expect((await call('GET', '/api/admin/backups/no-existe.sqlite/download', admin)).status).toBe(404)
    const traversal = await call('GET', '/api/admin/backups/..%2F..%2Fetc%2Fpasswd/download', admin)
    expect([400, 404]).toContain(traversal.status)
    expect(auditadas).toEqual([])
  })

  it('DELETE /:id borra el archivo del directorio; repetirlo → 404', async () => {
    const { call, admin, dir } = mount()
    const creado = ((await call('POST', '/api/admin/backups', admin, {})).body as any).archivo
    expect((await call('DELETE', `/api/admin/backups/${creado.id}`, admin)).status).toBe(204)
    expect(readdirSync(dir)).toEqual([])
    expect((await call('DELETE', `/api/admin/backups/${creado.id}`, admin)).status).toBe(404)
  })
})
