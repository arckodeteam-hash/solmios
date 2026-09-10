// monitoring/controller.ts — Adapta el request al service y devuelve { status, body }.
// Sin lógica: qué se mide y qué se omite lo decide el service. Lo propio de acá es validar lo
// poco que entra (REGLA #6/#11) y traducir un backup fallido a un 503 EXPLICATIVO: el design pide
// que "no hay pg_dump" o "superó el tope de tiempo" lleguen al operador con su motivo, no como un
// 500 genérico.

import { readFile } from 'node:fs/promises'
import { ErrorContract, validateSchema } from 'arckode-framework'
import type { HttpRequest, Logger } from 'arckode-framework'
import type { MonitoringService } from './service'
import type { MonitoringActor } from './types'
import { CreateBackupSchema, IdParamSchema, ListErrorsSchema } from './validators/schema'

const SERVICE_UNAVAILABLE = 503

function actorOf(req: HttpRequest): MonitoringActor {
  const user = (req.user ?? {}) as { id?: string; hotelId?: string }
  return { id: user.id ?? 'desconocido', hotelId: user.hotelId }
}

/** validateSchema TIRA ValidationError y el router la vuelve 400 (router.ts:105). */
function idOf(req: HttpRequest): string {
  return validateSchema(IdParamSchema, req.params ?? {}).id as string
}

export class MonitoringController {
  constructor(
    private readonly service: MonitoringService,
    private readonly logger: Logger,
  ) {}

  async api(_req: HttpRequest) {
    return { status: 200, body: this.service.apiMetrics() }
  }

  async errors(req: HttpRequest) {
    const q = validateSchema(ListErrorsSchema, (req.query ?? {}) as Record<string, string>)
    const items = await this.service.listErrors(q.limit)
    return { status: 200, body: { items } }
  }

  async removeError(req: HttpRequest) {
    await this.service.removeError(idOf(req))
    return { status: 204, body: null }
  }

  async system(_req: HttpRequest) {
    return { status: 200, body: await this.service.system() }
  }

  async queues(_req: HttpRequest) {
    return { status: 200, body: await this.service.queues() }
  }

  async listBackups(_req: HttpRequest) {
    return { status: 200, body: { items: await this.service.listBackups() } }
  }

  /** 201 con el archivo nuevo; un dump que no pudo correr es 503 con el motivo, no un 500 mudo. */
  async createBackup(req: HttpRequest) {
    validateSchema(CreateBackupSchema, req.body ?? {})
    try {
      const created = await this.service.createBackup(actorOf(req))
      return { status: 201, body: created }
    } catch (err: unknown) {
      if (err instanceof ErrorContract) throw err
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error('Monitoring: falló la creación del backup', { error: message })
      return { status: SERVICE_UNAVAILABLE, body: { error: message, code: 'BACKUP_FAILED' } }
    }
  }

  /**
   * Buffer como body: el server lo manda crudo (server.ts:138), sin el envelope JSON. Es el ÚNICO
   * mecanismo de binario del framework (`res.stream` es SSE y enmarca cada chunk en `data:`), por
   * eso el archivo entra entero en memoria. Desde un navegador (Accept-Encoding: gzip) el
   * `compression()` del framework lo serializaba como `{"type":"Buffer",…}` — lo evita el wrapper
   * `shared/middlewares/compression.ts` (jsonOnlyCompression) registrado en composition-root.
   */
  async downloadBackup(req: HttpRequest) {
    const { archivo, path } = await this.service.backupDownload(idOf(req), actorOf(req))
    const body = await readFile(path)
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${archivo.id.replace(/"/g, '')}"`,
        'Content-Length': String(body.length),
      },
      body,
    }
  }

  async removeBackup(req: HttpRequest) {
    await this.service.removeBackup(idOf(req), actorOf(req))
    return { status: 204, body: null }
  }
}
