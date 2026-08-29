import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { LockDeviceDTO, LockCodeDTO } from './types'
import { getAccessToken, listLocks, addKeyboardPassword, deleteKeyboardPassword, randomPin } from '../../services/ttlock-client'
import { generateCodeForReservation } from './usecases/ttlock-config'
import * as hw from './usecases/ttlock-hardware'
import type { TtlockQueries } from './usecases/ttlock-queries'
import { createMasterKeys } from './usecases/master-keys-hardware'
import { generateCodeIfAbsent as generateIfAbsent, keepSingleCode } from './usecases/reservation-codes'
import { purgeInactiveCodes } from './usecases/code-purge'
import { syncLocksForHotel } from './usecases/sync-locks'
function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }
export class TtlockService {
  constructor(
    private readonly lockDevicesRepo: RepositoryAdapter<LockDeviceDTO>,
    private readonly lockCodesRepo: RepositoryAdapter<LockCodeDTO>,
    private readonly logger: Logger,
    private readonly queries: TtlockQueries,
    private readonly auth?: any,
  ) {}

  async getConfig(hotelId: string): Promise<any> {
    return this.queries.getConfig(hotelId)
  }

  async updateConfig(hotelId: string, body: any): Promise<void> {
    return this.queries.updateConfig(hotelId, body)
  }

  async connect(hotelId: string, body: any): Promise<void> {
    return this.queries.connectConfig(hotelId, body, getAccessToken)
  }

  async listLocks(hotelId: string): Promise<any[]> {
    const locks = await this.lockDevicesRepo.findMany({ hotelId })
    const rooms = await this.queries.getRoomsByHotel(hotelId)
    const roomMap = new Map(rooms.map((r: any) => [r.id, r]))
    return locks.map(l => ({ ...l, roomNumber: roomMap.get(l.roomId)?.number || '—' }))
  }

  async syncLocks(hotelId: string): Promise<number> {
    return syncLocksForHotel({
      lockDevicesRepo: this.lockDevicesRepo as any,
      getTtlockConfig: (hid: string) => this.queries.getTtlockConfig(hid),
      listLocksFn: listLocks as any,
    }, hotelId)
  }

  async generateCode(hotelId: string, reservationId: string, customCode?: string): Promise<any> {
    const created = await generateCodeForReservation(
      reservationId, hotelId, this.lockDevicesRepo, this.lockCodesRepo,
      getAccessToken, addKeyboardPassword, randomPin,
      (hid: string) => this.queries.getTtlockConfig(hid),
      (id: string) => this.queries.findReservationById(id),
      (hid: string) => this.queries.findHotelById(hid),
      this.auth,
      customCode,
    )
    // Una reserva = UN código vigente: los anteriores de esa reserva se revocan (PIN físico
    // incluido). Va después de crear el nuevo para no dejarla sin código si la creación falla.
    await keepSingleCode({
      listByReservation: (rid: string) => this.lockCodesRepo.findMany({ reservationId: rid }),
      revoke: (cid: string) => this.revokeCode(cid, hotelId),
      log: this.logger,
    }, reservationId, created.id)
    return created
  }

  async listCodes(hotelId: string): Promise<any[]> {
    return this.queries.listCodesByHotel(hotelId)
  }

  // Operaciones de hardware (gateways, códigos activos, registros, apertura remota, borrado de PIN).
  // La lógica vive en `usecases/ttlock-hardware` (ownership + creds); acá solo se delega para no
  // volver el service un God Object (>200 líneas).
  private hwDeps() {
    return { lockDevicesRepo: this.lockDevicesRepo, lockCodesRepo: this.lockCodesRepo, queries: this.queries, auth: this.auth }
  }

  listGateways(hotelId: string): Promise<any[]> {
    return hw.getGateways(this.hwDeps(), hotelId)
  }

  listActiveCodes(hotelId: string, lockDeviceId: string): Promise<any[]> {
    return hw.getActiveCodes(this.hwDeps(), hotelId, lockDeviceId)
  }

  listLockRecords(hotelId: string, lockDeviceId: string, days = 30): Promise<any[]> {
    return hw.getRecords(this.hwDeps(), hotelId, lockDeviceId, days)
  }

  /** Abre la puerta en remoto (por gateway). */
  unlockLock(hotelId: string, lockDeviceId: string): Promise<void> {
    return hw.openLock(this.hwDeps(), hotelId, lockDeviceId)
  }

  /** Borra un PIN directo del hardware (tab "Activos") y sincroniza la fila de la BD. */
  deletePasscode(hotelId: string, lockDeviceId: string, keyboardPwdId: string): Promise<void> {
    return hw.removePasscode(this.hwDeps(), hotelId, lockDeviceId, keyboardPwdId)
  }

  /** Gateway(s) que alcanzan esta cerradura (con señal). */
  listLockGateways(hotelId: string, lockDeviceId: string): Promise<any[]> {
    return hw.getLockGateways(this.hwDeps(), hotelId, lockDeviceId)
  }

  /** Crea un código fijo (permanente) de staff en la cerradura. */
  createPermanentCode(hotelId: string, lockDeviceId: string, code?: string, name?: string): Promise<any> {
    return hw.createPermanentCode(this.hwDeps(), hotelId, lockDeviceId, code, name)
  }
  private masterKeysUc?: ReturnType<typeof createMasterKeys>
  /** Llaves maestras: un PIN por persona, aplicado a TODAS las cerraduras del hotel. */
  masterKeys() { return (this.masterKeysUc ??= createMasterKeys(this.lockDevicesRepo, this.lockCodesRepo, this.hwDeps())) }

  /** Generación automática (seña pagada): delega al usecase — ver usecases/reservation-codes.ts. */
  async generateCodeIfAbsent(hotelId: string, reservationId: string): Promise<any> {
    return generateIfAbsent({
      listCodesByHotel: (hid: string) => this.queries.listCodesByHotel(hid),
      findReservationById: (id: string) => this.queries.findReservationById(id),
      findLocksByRoom: (roomId: string) => this.lockDevicesRepo.findMany({ roomId }),
      generate: (hid: string, rid: string) => this.generateCode(hid, rid),
    }, hotelId, reservationId)
  }

  /**
   * Borra el PIN de la cerradura FÍSICA. Si TTLock falla, propagamos: marcar el código como
   * revocado en la base mientras la puerta sigue abriéndose con ese PIN es peor que fallar fuerte.
   */
  private async removePinFromLock(code: any): Promise<void> {
    if (!code?.ttlockKeyboardPwdId || !code?.hotelId) return
    const lock = await this.lockDevicesRepo.findById(code.lockId) as any
    if (this.auth && lock) this.auth.assertOwnership(lock.hotelId, code.hotelId, undefined, 'super_admin')
    if (!lock?.ttlockLockId) return
    const cfg = await this.queries.getTtlockConfig(code.hotelId)
    if (!cfg?.accessToken) throw new Error('TTLock no conectado: no se pudo borrar el PIN de la cerradura')
    await deleteKeyboardPassword(
      { clientId: cfg.clientId, accessToken: cfg.accessToken, region: cfg.region, addType: cfg.addType },
      Number(lock.ttlockLockId),
      String(code.ttlockKeyboardPwdId),
    )
  }

  async revokeCode(codeId: string, hotelId?: string): Promise<void> {
    const code = await this.lockCodesRepo.findById(codeId) as any
    if (!code) throw new Error('Código no encontrado')
    if (this.auth) this.auth.assertOwnership(code.hotelId, hotelId, undefined, 'super_admin')
    await this.removePinFromLock(code)
    await this.lockCodesRepo.update(codeId, { status: 'revoked' })
  }
  /** Borra de la BD los históricos (revoked/expired) de la cerradura — usecases/code-purge.ts. Sin lockDeviceId: TODO el hotel. */
  purgeInactiveCodes(hotelId: string, lockDeviceId?: string): Promise<number> {
    return purgeInactiveCodes({ lockDevicesRepo: this.lockDevicesRepo, lockCodesRepo: this.lockCodesRepo, auth: this.auth }, hotelId, lockDeviceId)
  }

  async expireCodesByReservation(reservationId: string): Promise<void> {
    const codes = await this.lockCodesRepo.findMany({ reservationId }) as any[]
    for (const c of codes) {
      // 'pending' (emitido con la cerradura offline) también se cierra al checkout: sin
      // ttlockKeyboardPwdId `removePinFromLock` es no-op, así que no toca hardware, pero la
      // fila deja de figurar como vigente.
      if (c.status !== 'active' && c.status !== 'pending') continue
      // El checkout no puede fallar porque una cerradura no responda: logueamos y seguimos.
      // PERO si el borrado físico falla, el PIN SIGUE ABRIENDO LA PUERTA: marcarlo 'expired'
      // sería mentir (seguridad). Lo dejamos en 'expire_failed' — un estado distinto de 'expired'
      // que refleja el fallo y permite reintentar/auditar. No requiere columna nueva: `status` es
      // texto libre (sin CHECK) y 'expire_failed' no cuenta como vigente (active/pending) ni como
      // revocado limpio (expired/revoked).
      try {
        await this.removePinFromLock(c)
      } catch (e: any) {
        this.logger.error(`No se pudo borrar el PIN ${c.id} de la cerradura, el código SIGUE ACTIVO: ${e?.message || e}`)
        await this.lockCodesRepo.update(c.id, { status: 'expire_failed' })
        continue
      }
      await this.lockCodesRepo.update(c.id, { status: 'expired' })
    }
  }

  async updateLock(lockId: string, body: any, hotelId?: string): Promise<any> {
    // Ownership ANTES de escribir — sino el write cross-tenant se persiste aunque
    // después tire ForbiddenError (orden roto).
    const lock = await this.lockDevicesRepo.findById(lockId) as any
    if (this.auth && lock) this.auth.assertOwnership(lock.hotelId, hotelId, undefined, 'super_admin')
    const patch: Partial<Omit<LockDeviceDTO, 'id'>> = {}
    if (body.roomId !== undefined) patch.roomId = body.roomId
    if (body.name !== undefined) patch.name = body.name
    if (body.autoCodesEnabled !== undefined) patch.autoCodesEnabled = body.autoCodesEnabled
    await this.lockDevicesRepo.update(lockId, patch)
    // Devolvemos el lock ya validado + el patch, sin re-consultar (evita un segundo findById).
    return { ...(lock || {}), ...patch, id: lockId }
  }
}
