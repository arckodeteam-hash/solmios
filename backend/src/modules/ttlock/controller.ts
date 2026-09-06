import type { HttpRequest, Logger, RepositoryAdapter } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { TtlockService } from './service'
import { UpdateTTLockConfigSchema, ConnectTTLockSchema, UpdateLockDeviceSchema, CreatePermanentCodeSchema, CreateMasterKeySchema } from './validators/schema'
import { hotelIdOfUserLegacy } from '../../shared/usecases/hotel-of-legacy'

export class TtlockController {
  constructor(
    private readonly service: TtlockService,
    private readonly logger: Logger,
    // Solo para el fallback de hotelOf() con tokens legacy sin hotelId embebido.
    // No va al service: TtlockService ya roza el límite de 200 líneas
    // (gate `arckode analyze`, ver comentario en hwDeps()).
    private readonly usersRepo?: RepositoryAdapter<any>,
  ) {}

  private async hotelOf(req: any): Promise<string | undefined> {
    const q = req?.query || {}
    // Seguridad (IDOR cross-tenant): el hotel sale del TOKEN, no de la query. Un usuario de hotel
    // NO puede apuntar a otro hotel pasando ?hotelId= (en ttlock eso permitía generar/abrir
    // cerraduras de otro hotel). Solo super_admin (platform) puede operar cross-hotel via query.
    const userHotel = req?.user?.hotelId
    if (userHotel && userHotel !== 'platform') return userHotel as string
    if (req?.user?.role === 'super_admin' && q.hotelId) return q.hotelId as string
    if (req?.user?.id && req?.user?.role !== 'super_admin') {
      const hotelId = await hotelIdOfUserLegacy(this.usersRepo, req.user.id)
      if (hotelId) return hotelId
    }
    return undefined
  }

  async getConfig(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    return { status: 200, body: await this.service.getConfig(id) }
  }

  async updateConfig(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    const data = validateSchema(UpdateTTLockConfigSchema, req.body) as any
    await this.service.updateConfig(id, data)
    return { status: 200, body: { success: true } }
  }

  async connect(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      const data = validateSchema(ConnectTTLockSchema, req.body) as any
      await this.service.connect(id, data)
      return { status: 200, body: { success: true, connected: true } }
    } catch (e: any) {
      // 400, no 502: credenciales mal cargadas son un error del input. Además nginx/Cloudflare
      // reescriben el body de un 502 y el usuario perdía el motivo real del rechazo.
      return { status: 400, body: { error: e.message || 'No se pudo conectar con TTLock' } }
    }
  }

  async listLocks(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 200, body: { data: [] } }
    return { status: 200, body: { data: await this.service.listLocks(id) } }
  }

  async syncLocks(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      const synced = await this.service.syncLocks(id)
      return { status: 200, body: { success: true, synced, message: `${synced} cerradura(s) sincronizada(s)` } }
    } catch (e: any) {
      return { status: 400, body: { error: e.message } }
    }
  }

  async generateCode(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    // Creación manual: body { code } opcional con el PIN elegido por el staff (4-9 dígitos).
    const custom = typeof (req.body as any)?.code === 'string' ? (req.body as any).code.trim() : ''
    if (custom && !/^\d{4,9}$/.test(custom)) {
      return { status: 400, body: { error: 'El código manual debe tener entre 4 y 9 dígitos' } }
    }
    try {
      const code = await this.service.generateCode(id, req.params.reservationId, custom || undefined)
      return { status: 201, body: code }
    } catch (e: any) {
      if (e.message.includes('no encontrado')) return { status: 404, body: { error: e.message } }
      if (e.message.includes('Sin acceso')) return { status: 403, body: { error: e.message } }
      return { status: 400, body: { error: e.message } }
    }
  }

  async listCodes(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 200, body: { data: [] } }
    return { status: 200, body: { data: await this.service.listCodes(id) } }
  }

  async listGateways(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 200, body: { data: [] } }
    try {
      return { status: 200, body: { data: await this.service.listGateways(id) } }
    } catch (e: any) {
      return { status: 400, body: { error: e.message } }
    }
  }

  async listActiveCodes(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      return { status: 200, body: { data: await this.service.listActiveCodes(id, req.params.id) } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudieron leer los códigos de la cerradura' } }
    }
  }

  async listRecords(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      return { status: 200, body: { data: await this.service.listLockRecords(id, req.params.id) } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudo leer el historial de la cerradura' } }
    }
  }

  async unlock(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      await this.service.unlockLock(id, req.params.id)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudo abrir la cerradura' } }
    }
  }

  async lock(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      await this.service.lockLock(id, req.params.id)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      // El texto de Sciener llega tal cual: es lo que distingue "gateway fuera de rango" de
      // "esta cerradura no cierra en remoto", y el usuario necesita saber cuál de las dos es.
      return { status: 400, body: { error: e.message || 'No se pudo cerrar la cerradura' } }
    }
  }

  async deletePasscode(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      await this.service.deletePasscode(id, req.params.id, req.params.pwdId)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudo borrar el código de la cerradura' } }
    }
  }

  async listLockGateways(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 200, body: { data: [] } }
    try {
      return { status: 200, body: { data: await this.service.listLockGateways(id, req.params.id) } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudo leer el gateway de la cerradura' } }
    }
  }

  async createPermanentCode(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      const data = validateSchema(CreatePermanentCodeSchema, req.body || {}) as any
      const created = await this.service.createPermanentCode(id, req.params.id, data.code, data.name)
      return { status: 201, body: created }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudo crear el código fijo' } }
    }
  }

  async revokeCode(req: HttpRequest) {
    // Sin el hotel del token, revokeCode aceptaba cualquier codeId de cualquier hotel (IDOR).
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      await this.service.revokeCode(req.params.id, id)
      return { status: 200, body: { success: true } }
    } catch (e: any) {
      if (e.message?.includes('no encontrado')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudo revocar el código' } }
    }
  }

  /** Limpieza masiva: borra de la BD los códigos históricos (revoked/expired) de una cerradura. */
  async purgeCodes(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      const deleted = await this.service.purgeInactiveCodes(id, req.params.id)
      return { status: 200, body: { success: true, deleted } }
    } catch (e: any) {
      if (e.message?.includes('no encontrada')) return { status: 404, body: { error: e.message } }
      return { status: 400, body: { error: e.message || 'No se pudieron borrar los códigos históricos' } }
    }
  }

  /** Limpieza masiva GLOBAL: históricos (revoked/expired) de TODAS las cerraduras del hotel. */
  async purgeAllCodes(req: HttpRequest) {
    const id = await this.hotelOf(req)
    if (!id) return { status: 401, body: { error: 'Hotel no encontrado' } }
    try {
      const deleted = await this.service.purgeInactiveCodes(id)
      return { status: 200, body: { success: true, deleted } }
    } catch (e: any) {
      return { status: 400, body: { error: e.message || 'No se pudieron borrar los códigos históricos' } }
    }
  }

  async updateLock(req: HttpRequest) {
    const id = await this.hotelOf(req)
    const data = validateSchema(UpdateLockDeviceSchema, req.body) as any
    return { status: 200, body: await this.service.updateLock(req.params.id, data, id) }
  }

  // ─── Llaves maestras ──────────────────────────────────────────────────────
  // Un PIN por persona que abre todas las puertas del hotel. Las rutas están
  // restringidas al gerente: una llave que abre todo no la emite recepción.

  async listMasterKeys(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    return { status: 200, body: { data: await this.service.masterKeys().list(hotelId) } }
  }

  async createMasterKey(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    const data = validateSchema(CreateMasterKeySchema, req.body ?? {}) as any
    const actor = (req.user as any)?.id ?? ''
    return { status: 201, body: await this.service.masterKeys().create(hotelId, data, actor) }
  }

  async revokeMasterKey(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    const actor = (req.user as any)?.id ?? ''
    return { status: 200, body: await this.service.masterKeys().revoke(hotelId, req.params.id, actor) }
  }

  /** Qué puertas abre la llave y cuáles no (para poder sumar o quitar). */
  async masterKeyLocks(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    return { status: 200, body: { data: await this.service.masterKeys().locksOf(hotelId, req.params.id) } }
  }

  /** Suma una puerta a la llave, con el mismo PIN. */
  async addMasterKeyLock(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    await this.service.masterKeys().addLock(hotelId, req.params.id, req.params.lockId)
    return { status: 200, body: { success: true } }
  }

  /** Le quita una puerta a la llave (borra el PIN de esa cerradura). */
  async removeMasterKeyLock(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    await this.service.masterKeys().removeLock(hotelId, req.params.id, req.params.lockId)
    return { status: 200, body: { success: true } }
  }

  /** Dónde y cuándo entró esa persona con su llave. */
  async masterKeyAccessLog(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 401, body: { error: 'Hotel no encontrado' } }
    const days = Number(req.query['days']) || undefined
    return { status: 200, body: { data: await this.service.masterKeys().accessLog(hotelId, req.params.id, days) } }
  }
}
