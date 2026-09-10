// monitoring/tests/service.test.ts — El cableado del service: qué se omite cuando una fuente
// falla (REQ-MON-07), que crear y descargar un backup queden en el audit log con el usuario
// (REQ-MON-05), que un id inexistente sea 404 y que el sink de errores delegue al registro.
// Dobles en memoria para todo; el store de backups es un doble que cuenta llamadas.

import { describe, it, expect } from 'bun:test'
import { ErrorContract } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import type { AuditEntry } from '../../../shared/usecases/audit'
import type { BackupDump } from '../../../shared/observability/backup-dump'
import { MonitoringService, type MonitoringDeps } from '../service'
import { ErrorLogs, type ErrorLogsRepo } from '../usecases/error-logs'
import type { BackupFile, BackupsStorePort, ErrorLogRow } from '../types'

const LOG = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => LOG } as unknown as Logger
const ACTOR = { id: 'user-super_admin', hotelId: 'platform' }
const SNAPSHOT = { ventanaDesde: '2026-09-10T00:00:00.000Z', rutas: [], totales: { peticiones: 0, erroresPct: 0, avgMs: 0 } }
const SALUD = { proceso: { uptimeS: 10, memoriaRssMb: 80, memoriaHeapMb: 30, cpuPct: null }, so: { uptimeS: 100, cargas: [0.1, 0.2, 0.3], memoriaTotalMb: 8000, memoriaLibreMb: 4000 }, disco: { totalBytes: 100, libreBytes: 50, usadoPct: 50 } }

function makeErrorLogs(seed: ErrorLogRow[] = []) {
  const rows = [...seed]
  const repo: ErrorLogsRepo = {
    findOne: async () => null,
    findMany: async () => rows,
    create: async (d) => { const row = { id: `e${rows.length + 1}`, ...d } as ErrorLogRow; rows.push(row); return row },
    update: async () => null,
    delete: async (id) => { const i = rows.findIndex((r) => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true },
  }
  return { errorLogs: new ErrorLogs(repo, LOG), rows }
}

/** Store de backups en memoria: `create` fabrica un archivo nuevo, `find` es coincidencia exacta. */
function makeBackups(seed: BackupFile[] = []) {
  const files = [...seed]
  const llamadas: string[] = []
  const store: BackupsStorePort = {
    async list() { llamadas.push('list'); return [...files] },
    async find(id) { return files.find((f) => f.id === id) ?? null },
    async pathOf(id) { const f = files.find((x) => x.id === id); return f ? `/tmp/backups/${f.id}` : null },
    async remove(id) { const i = files.findIndex((f) => f.id === id); if (i < 0) return false; files.splice(i, 1); return true },
    async create(dump) {
      llamadas.push(`create:${dump.motor}`)
      const archivo = { id: `backup-nuevo.${dump.extension}`, bytes: 1234, creadoEn: '2026-09-10T12:00:00.000Z' }
      files.push(archivo)
      return { archivo, eliminados: [] }
    },
  }
  const dump: BackupDump = { motor: 'sqlite', extension: 'sqlite', run: async () => {} }
  return { store, dump, files, llamadas }
}

function armar(over: Partial<MonitoringDeps> = {}) {
  const { errorLogs, rows } = makeErrorLogs()
  const backups = makeBackups([{ id: 'backup-viejo.sqlite', bytes: 10, creadoEn: '2026-09-01T00:00:00.000Z' }])
  const deps: MonitoringDeps = {
    metrics: { snapshot: () => SNAPSHOT },
    systemHealth: { read: async () => SALUD },
    uploads: { read: async () => ({ bytes: 5, archivos: 1, calculadoEn: '2026-09-10T00:00:00.000Z' }) },
    dbHealth: async () => ({ motor: 'sqlite' as const, tamanoBytes: 2048, tablas: 40 }),
    backups: { store: backups.store, dump: backups.dump },
    errorLogs,
    queues: { email: { findMany: async () => [], count: async () => 0 }, webhooks: { findMany: async () => [], count: async () => 0 } },
    ...over,
  }
  const service = new MonitoringService(deps, LOG)
  const auditadas: AuditEntry[] = []
  service.setAuditDeps({ record: async (e) => { auditadas.push(e) } })
  return { service, auditadas, backups, errorRows: rows, errorLogs }
}

describe('MonitoringService — lecturas', () => {
  it('apiMetrics devuelve el snapshot del store de métricas tal cual', () => {
    expect(armar().service.apiMetrics()).toBe(SNAPSHOT)
  })

  it('system arma proceso/so/disco/uploads/db cuando todo mide', async () => {
    const out = await armar().service.system()
    expect(out).toEqual({ proceso: SALUD.proceso, so: SALUD.so, disco: SALUD.disco, uploads: { bytes: 5, archivos: 1, calculadoEn: '2026-09-10T00:00:00.000Z' }, db: { motor: 'sqlite', tamanoBytes: 2048, tablas: 40 } })
  })

  it('system OMITE la fuente que falla o no está cableada, sin inventar ceros', async () => {
    const { service } = armar({ dbHealth: async () => { throw new Error('base caída') }, uploads: undefined })
    const out = await service.system()
    expect(out.proceso).toEqual(SALUD.proceso)
    expect('db' in out).toBe(false)
    expect('uploads' in out).toBe(false)
  })

  it('queues devuelve ariOutbox null hasta que el conector inyecta el puerto', async () => {
    const { service } = armar()
    expect((await service.queues()).ariOutbox).toBeNull()
    service.setAriOutboxPort({ stats: async () => ({ pending: 1, processing: 0, sent: 0, failed: 0, retrying: 0, total: 1 }) })
    expect((await service.queues()).ariOutbox?.pending).toBe(1)
  })
})

describe('MonitoringService — errores', () => {
  it('recordError delega en el registro (fire-and-forget) y listErrors lo devuelve', async () => {
    const { service, errorLogs, errorRows } = armar()
    service.recordError({ method: 'GET', path: '/api/x', statusCode: 500, message: 'boom' })
    await errorLogs.flush()
    expect(errorRows).toHaveLength(1)
    expect((await service.listErrors())[0]!.message).toBe('boom')
  })

  it('removeError con id inexistente → NotFoundError (404)', async () => {
    const err = await armar().service.removeError('nope').then(() => null, (e) => e)
    expect((err as ErrorContract).httpStatus).toBe(404)
  })
})

describe('MonitoringService — backups', () => {
  it('createBackup crea el archivo, lo audita con el usuario y avisa por sockets', async () => {
    const { service, auditadas, backups } = armar()
    const avisos: string[] = []
    service.setSockets({ onBackupCreated: async (c) => { avisos.push(c.archivo.id) } })
    const created = await service.createBackup(ACTOR)
    expect(created.archivo.id).toBe('backup-nuevo.sqlite')
    expect(backups.llamadas).toContain('create:sqlite')
    expect(auditadas).toHaveLength(1)
    expect(auditadas[0]).toMatchObject({ userId: 'user-super_admin', action: 'backup.create', entity: 'backup', entityId: 'backup-nuevo.sqlite' })
    expect(avisos).toEqual(['backup-nuevo.sqlite'])
  })

  it('backupDownload resuelve la ruta por coincidencia exacta y audita la descarga', async () => {
    const { service, auditadas } = armar()
    const out = await service.backupDownload('backup-viejo.sqlite', ACTOR)
    expect(out.path).toBe('/tmp/backups/backup-viejo.sqlite')
    expect(out.archivo.bytes).toBe(10)
    expect(auditadas).toHaveLength(1)
    expect(auditadas[0]).toMatchObject({ userId: 'user-super_admin', action: 'backup.download', entityId: 'backup-viejo.sqlite' })
  })

  it('descarga con id inexistente → 404 y NADA en el audit log', async () => {
    const { service, auditadas } = armar()
    const err = await service.backupDownload('../../etc/passwd', ACTOR).then(() => null, (e) => e)
    expect((err as ErrorContract).httpStatus).toBe(404)
    expect(auditadas).toHaveLength(0)
  })

  it('un audit log caído no frena el backup', async () => {
    const { service } = armar()
    service.setAuditDeps({ record: async () => { throw new Error('auditlog caído') } })
    expect((await service.createBackup(ACTOR)).archivo.id).toBe('backup-nuevo.sqlite')
  })

  it('removeBackup borra el existente y 404 para el inexistente', async () => {
    const { service, backups } = armar()
    await service.removeBackup('backup-viejo.sqlite', ACTOR)
    expect(backups.files).toHaveLength(0)
    const err = await service.removeBackup('backup-viejo.sqlite', ACTOR).then(() => null, (e) => e)
    expect((err as ErrorContract).httpStatus).toBe(404)
  })

  it('sin puerto de backups cableado las operaciones responden 404 explicativo', async () => {
    const { service } = armar({ backups: undefined })
    const err = await service.listBackups().then(() => null, (e) => e)
    expect((err as ErrorContract).httpStatus).toBe(404)
  })
})
