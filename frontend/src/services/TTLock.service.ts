import { http } from './http'

export interface LockDevice {
  id?: string
  hotelId?: string
  roomId?: string
  ttlockLockId?: string
  name?: string
  mac?: string
  batteryLevel?: number
  status?: string
  roomNumber?: string
  /** Auto-generar el código al pagarse la seña, por cerradura. */
  autoCodesEnabled?: boolean
}

export interface LockCode {
  id?: string
  lockId: string
  reservationId: string
  code: string
  codeType?: string
  startDate: string
  endDate: string
  /** 'expire_failed' = el checkout no pudo borrar el PIN físico: la fila NO es un histórico limpio. */
  status: 'pending' | 'active' | 'revoked' | 'expired' | 'expire_failed'
  sentVia?: string
  sentAt?: string
}

export interface LockGateway {
  gatewayId: number
  gatewayName?: string
  gatewayMac?: string
  networkName?: string
  isOnline?: number
  lockNum?: number
}

export interface LockActiveCode {
  keyboardPwdId: number
  keyboardPwd?: string
  keyboardPwdName?: string
  /** 1 permanente · 2 temporal · 3 período · 4 borrado (Sciener). */
  keyboardPwdType?: number
  startDate?: number
  endDate?: number
  status?: number
}

export interface LockRecord {
  recordId: number
  /** Código del evento de Sciener (4 = apertura con código, 1 = app, etc.). */
  recordType?: number
  /** 1 = OK · 0 = falló. */
  success?: number
  keyboardPwd?: string
  keyName?: string
  username?: string
  lockDate?: number
  /**
   * De quién es el código que abrió, resuelto por el backend. El hardware solo
   * devuelve el número: "abrió 118205" no dice quién entró.
   */
  holder?: string
  /** `master` = llave maestra de una persona · `guest` = código de una reserva. */
  holderType?: 'master' | 'guest' | ''
  holderUserId?: string
  reservationId?: string
}

export interface LockGatewayLink {
  gatewayId: number
  gatewayName?: string
  gatewayMac?: string
  /** Señal del gateway a la cerradura (dBm). Más cerca de 0 = mejor. */
  rssi?: number
}

export interface TTLockConfig {
  clientId?: string
  clientSecret?: string
  username?: string
  password?: string
  region?: string
  accountId?: string
  accessToken?: string
  /** Entrega del PIN a la cerradura: 1 bluetooth · 2 gateway · 3 NB-IoT */
  addType?: number
  configured: boolean
  connected?: boolean
  /** El backend nunca devuelve el secret/password; estos flags dicen si ya están guardados. */
  hasSecret?: boolean
  hasPassword?: boolean
}

/** Llave maestra: un PIN de una persona, vivo en todas las cerraduras a la vez. */
export interface MasterKey {
  masterKeyId: string
  userId: string
  label: string
  code: string
  /** `partial` = está viva pero no llegó a todas las puertas. */
  status: 'active' | 'revoked' | 'partial'
  locksApplied: number
  locksTotal: number
  createdAt?: string
}

/** Resultado de aplicar la llave: en qué puertas entró y en cuáles no. */
export interface MasterKeyApplyResult {
  masterKeyId: string
  code: string
  applied: { lockId: string; lockName: string }[]
  failed: { lockId: string; lockName: string; reason: string }[]
}

/** Una puerta del hotel y si esta llave la abre o no. */
export interface MasterKeyLock {
  lockId: string
  lockName: string
  roomId?: string
  applied: boolean
}

/** Una apertura registrada por la cerradura con esa llave. */
export interface MasterKeyAccess {
  lockId: string
  lockName: string
  roomId?: string
  at: string
  success: boolean
}

export const TTLockService = {
  getConfig: () => http.get<TTLockConfig>('/ttlock/config'),
  saveConfig: (config: Partial<TTLockConfig>) => http.put<{ success: boolean }>('/ttlock/config', config),
  /** OAuth2 Resource Owner Password: valida usuario+password contra TTLock y guarda el access_token. */
  connect: (data: { username?: string; password?: string; clientId?: string; clientSecret?: string; region?: string }) =>
    http.post<{ success: boolean; connected: boolean }>('/ttlock/connect', data),
  listLocks: () => http.get<{ data: LockDevice[] }>('/ttlock/locks'),
  listCodes: () => http.get<{ data: LockCode[] }>('/ttlock/codes'),
  sync: () => http.post<{ success: boolean; synced: number; message?: string }>('/ttlock/sync'),
  updateLock: (id: string, patch: { roomId?: string; name?: string; autoCodesEnabled?: boolean }) =>
    http.put<LockDevice>(`/ttlock/lock/${id}`, patch),
  generateCode: (reservationId: string, code?: string) =>
    http.post<LockCode>(`/ttlock/generate-code/${reservationId}`, code ? { code } : {}),
  revokeCode: (id: string) => http.delete<{ success: boolean }>(`/ttlock/code/${id}`),
  /** Borra de la BD los códigos históricos (revoked/expired) de una cerradura. */
  purgeRevokedCodes: (lockId: string) => http.delete<{ success: boolean; deleted: number }>(`/ttlock/lock/${lockId}/codes/revoked`),
  /** Purga GLOBAL: históricos (revoked/expired) de TODAS las cerraduras del hotel. */
  purgeRevokedCodesAll: () => http.delete<{ success: boolean; deleted: number }>('/ttlock/codes/revoked'),
  /** Gateways de la cuenta TTLock del hotel. */
  listGateways: () => http.get<{ data: LockGateway[] }>('/ttlock/gateways'),
  /** Códigos REALES vivos en el hardware de una cerradura (lockId = id de lock_devices). */
  listActiveCodes: (lockId: string) => http.get<{ data: LockActiveCode[] }>(`/ttlock/locks/${lockId}/active-codes`),
  /** Historial de actividad (aperturas/intentos) de una cerradura (últimos 30 días). */
  listLockRecords: (lockId: string) => http.get<{ data: LockRecord[] }>(`/ttlock/locks/${lockId}/records`),
  /** Abre la puerta en remoto por el gateway. */
  unlockLock: (lockId: string) => http.post<{ success: boolean }>(`/ttlock/locks/${lockId}/unlock`),
  /** Cierra la puerta en remoto. Falla con el mensaje de TTLock si el modelo no lo soporta
   *  (muchas cerraduras son de resorte y no tienen motor para echar el pestillo). */
  lockLock: (lockId: string) => http.post<{ success: boolean }>(`/ttlock/locks/${lockId}/lock`),
  /** Borra un PIN directo del hardware (keyboardPwdId de la cerradura). */
  deletePasscode: (lockId: string, pwdId: string | number) => http.delete<{ success: boolean }>(`/ttlock/locks/${lockId}/passcodes/${pwdId}`),
  /** Gateway(s) que alcanzan esta cerradura (con señal). */
  listLockGateways: (lockId: string) => http.get<{ data: LockGatewayLink[] }>(`/ttlock/locks/${lockId}/gateways`),
  /** Crea un código fijo (permanente) de staff en la cerradura. `code` opcional (se genera si falta). */
  createPermanentCode: (lockId: string, body: { code?: string; name?: string }) => http.post<{ code: string; keyboardPwdId?: string }>(`/ttlock/locks/${lockId}/permanent-codes`, body),

  // ─── Llaves maestras ────────────────────────────────────────────────────
  // Un PIN por PERSONA que abre todas las puertas del hotel. Solo el gerente.
  listMasterKeys: () => http.get<{ data: MasterKey[] }>('/ttlock/master-keys'),
  /** Aplica el mismo PIN en todas las cerraduras. Responde en cuáles entró y en cuáles no. */
  createMasterKey: (body: { userId: string; code?: string; label?: string }) =>
    http.post<MasterKeyApplyResult>('/ttlock/master-keys', body),
  /** Borra la llave del hardware de todas las cerraduras. */
  revokeMasterKey: (masterKeyId: string) =>
    http.delete<{ revoked: number; failed: { lockName: string; reason: string }[] }>(`/ttlock/master-keys/${masterKeyId}`),
  /** Dónde y cuándo entró esa persona con su llave. */
  masterKeyAccessLog: (masterKeyId: string, days?: number) =>
    http.get<{ data: MasterKeyAccess[] }>(`/ttlock/master-keys/${masterKeyId}/access-log${days ? `?days=${days}` : ''}`),
  /** Qué puertas abre la llave y cuáles no. */
  masterKeyLocks: (masterKeyId: string) =>
    http.get<{ data: MasterKeyLock[] }>(`/ttlock/master-keys/${masterKeyId}/locks`),
  /** Suma una puerta a la llave, con el mismo PIN. */
  addMasterKeyLock: (masterKeyId: string, lockId: string) =>
    http.post<{ success: boolean }>(`/ttlock/master-keys/${masterKeyId}/locks/${lockId}`),
  /** Le quita una puerta a la llave (borra el PIN de esa cerradura). */
  removeMasterKeyLock: (masterKeyId: string, lockId: string) =>
    http.delete<{ success: boolean }>(`/ttlock/master-keys/${masterKeyId}/locks/${lockId}`),
}
