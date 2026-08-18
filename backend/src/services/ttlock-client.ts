// src/services/ttlock-client.ts — Cliente REAL de la API de Sciener/TTLock.
// OAuth2 "Resource Owner Password" + endpoints v3 de cerraduras.
// Docs: https://euopen.ttlock.com/doc/  (Sciener Open Platform)
//
// Las credenciales viven en `configuration` (key: ttlock_config), NUNCA en código.
// Regiones: eu (euapi.sciener.com) · us (api.us.sciener.com) · cn (api.sciener.com).

import { createHash, randomInt } from 'node:crypto'

const REGION_BASE: Record<string, string> = {
  eu: 'https://euapi.sciener.com',
  us: 'https://api.us.sciener.com',
  cn: 'https://api.sciener.com',
}

/**
 * Cómo se entrega el PIN a la cerradura física.
 * 1 = bluetooth (requiere un teléfono con la app al lado de la puerta)
 * 2 = gateway (remoto: el hotel tiene un gateway TTLock en la red)
 * 3 = NB-IoT
 */
export type TTLockAddType = 1 | 2 | 3
export const DEFAULT_ADD_TYPE: TTLockAddType = 2

/**
 * Genera un PIN numérico de seis dígitos para una cerradura TTLock.
 * Usa un CSPRNG (`crypto.randomInt`, no `Math.random`): el PIN es una credencial
 * física de acceso, un generador predecible permitiría adivinarlo. Rango completo
 * 000000-999999 con padding a 6 dígitos (Sciener espera el PIN como string numérico).
 */
export function randomPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function base(region?: string): string {
  return REGION_BASE[(region || 'eu').toLowerCase()] || REGION_BASE.eu
}

/** ms timestamp actual (la API de Sciener lo pide como `date`). */
function nowMs(): number { return Date.now() }

// --- Reintento con backoff para fallos TRANSITORIOS de la red/Sciener ---
// Máximo de intentos y demora base del backoff exponencial (200ms, 400ms, ...).
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `fetch` con reintento + backoff exponencial, SOLO para errores transitorios:
 *  - la red se cae / timeout → `fetch` tira → reintentamos.
 *  - HTTP 5xx (Sciener caído/inestable) → reintentamos.
 * NO reintenta:
 *  - HTTP 4xx (error de cliente permanente: token/params malos) → se devuelve tal cual.
 *  - errores de NEGOCIO de Sciener (`errcode != 0`), que viajan con HTTP 200 en el body →
 *    ni siquiera los ve este wrapper; los valida `assertOk` aguas abajo.
 * No toca la paginación: envuelve UNA request; el `for(;;)` de cada listado sigue igual.
 */
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init)
      // 5xx = transitorio: reintentar mientras queden intentos.
      if (res.status >= 500 && res.status <= 599 && attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_BASE_MS * 2 ** attempt)
        continue
      }
      return res
    } catch (e) {
      // fetch tiró → red/timeout: reintentar mientras queden intentos.
      lastErr = e
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_BASE_MS * 2 ** attempt)
        continue
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('TTLock: fallo de red tras varios reintentos')
}

/** Lee el body JSON de una response Sciener y normaliza errores. */
async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { _raw: text } }
}

function assertOk(data: any, fallback: string): void {
  // Sciener responde con errcode/errmsg (o errmsg en /oauth2/token como error_description).
  const code = data?.errcode ?? data?.errorCode
  const msg = data?.errmsg ?? data?.error_description ?? data?.error
  if (code !== undefined && code !== 0) throw new Error(`TTLock: ${msg || code}`)
  if (msg && (data?.error || data?.error_description)) throw new Error(`TTLock: ${msg}`)
  void fallback
}

export interface TTLockCreds {
  clientId: string
  clientSecret?: string
  username?: string
  password?: string
  accessToken?: string
  region?: string
  addType?: TTLockAddType
}

/**
 * Sciener exige el password como MD5 hex de 32 chars en minúsculas
 * (según la doc oficial del endpoint /oauth2/token — campo password de
 * 32 caracteres, minúsculas, encriptado MD5).
 * Si ya viene hasheado se respeta, para no re-hashear un valor migrado.
 */
function md5Password(password: string): string {
  if (/^[a-f0-9]{32}$/.test(password)) return password
  return createHash('md5').update(password, 'utf8').digest('hex')
}

/** OAuth2 Resource Owner Password → { accessToken, refreshToken, uid }. */
export async function getAccessToken(c: TTLockCreds): Promise<{ accessToken: string; refreshToken?: string; uid?: string }> {
  if (!c.clientId || !c.clientSecret || !c.username || !c.password) {
    throw new Error('Faltan clientId/clientSecret/username/password de TTLock')
  }
  const res = await fetchWithRetry(`${base(c.region)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      username: c.username,
      password: md5Password(c.password),
    }),
  })
  const data = await readJson(res)
  if (!data?.access_token) {
    throw new Error(data?.error_description || data?.errmsg || 'TTLock: credenciales inválidas o sin permisos')
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, uid: data.uid }
}

export interface TTLockDevice {
  lockId: number
  lockName?: string
  lockAlias?: string
  lockMac?: string
  electricQuantity?: number
}

/** Lista TODAS las cerraduras de la cuenta TTLock (paginando). */
export async function listLocks(c: TTLockCreds): Promise<TTLockDevice[]> {
  if (!c.accessToken) throw new Error('Sin access_token de TTLock (conectá primero)')
  const all: TTLockDevice[] = []
  let pageNo = 1
  for (;;) {
    const qs = new URLSearchParams({
      clientId: c.clientId, accessToken: c.accessToken,
      pageNo: String(pageNo), pageSize: '50', date: String(nowMs()),
    })
    const data = await readJson(await fetchWithRetry(`${base(c.region)}/v3/lock/list?${qs}`))
    assertOk(data, 'listar cerraduras')
    const list: any[] = data?.list || []
    for (const l of list) {
      all.push({
        lockId: l.lockId,
        lockName: l.lockName,
        lockAlias: l.lockAlias,
        lockMac: l.lockMac,
        electricQuantity: l.electricQuantity,
      })
    }
    const total = Number(data?.total ?? 0)
    if (list.length < 50 || all.length >= total) break
    pageNo++
    if (pageNo > 20) break // salvaguarda
  }
  return all
}

/** Crea un PIN temporal en la cerradura FÍSICA. Devuelve { keyboardPwdId }. */
export async function addKeyboardPassword(
  c: TTLockCreds, lockId: number, password: string, startMs: number, endMs: number,
): Promise<{ keyboardPwdId?: string }> {
  const res = await fetchWithRetry(`${base(c.region)}/v3/keyboardPwd/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clientId: c.clientId,
      accessToken: c.accessToken!,
      lockId: String(lockId),
      keyboardPwd: password,
      startDate: String(startMs),
      endDate: String(endMs),
      addType: String(c.addType ?? DEFAULT_ADD_TYPE),
      date: String(nowMs()),
    }),
  })
  const data = await readJson(res)
  assertOk(data, 'crear PIN de cerradura')
  return { keyboardPwdId: data?.keyboardPwdId != null ? String(data.keyboardPwdId) : undefined }
}

/**
 * Borra el PIN de la cerradura FÍSICA. Sin esto, revocar/expirar un código solo cambia
 * una fila en la base y el huésped que ya se fue puede seguir abriendo la puerta.
 * `deleteType` usa la misma semántica que `addType` (2 = gateway).
 */
export async function deleteKeyboardPassword(
  c: TTLockCreds, lockId: number, keyboardPwdId: string,
): Promise<void> {
  const res = await fetchWithRetry(`${base(c.region)}/v3/keyboardPwd/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clientId: c.clientId,
      accessToken: c.accessToken!,
      lockId: String(lockId),
      keyboardPwdId: String(keyboardPwdId),
      deleteType: String(c.addType ?? DEFAULT_ADD_TYPE),
      date: String(nowMs()),
    }),
  })
  assertOk(await readJson(res), 'borrar PIN de cerradura')
}

export interface TTLockGateway {
  gatewayId: number
  gatewayName?: string
  gatewayMac?: string
  networkName?: string
  isOnline?: number
  lockNum?: number
  gatewayVersion?: number
}

/** Lista los gateways de la cuenta TTLock (paginando). `isOnline` 1 = conectado. */
export async function listGateways(c: TTLockCreds): Promise<TTLockGateway[]> {
  if (!c.accessToken) throw new Error('Sin access_token de TTLock (conectá primero)')
  const all: TTLockGateway[] = []
  let pageNo = 1
  for (;;) {
    const qs = new URLSearchParams({
      clientId: c.clientId, accessToken: c.accessToken,
      pageNo: String(pageNo), pageSize: '50', date: String(nowMs()),
    })
    const data = await readJson(await fetchWithRetry(`${base(c.region)}/v3/gateway/list?${qs}`))
    assertOk(data, 'listar gateways')
    const list: any[] = data?.list || []
    for (const g of list) {
      all.push({
        gatewayId: g.gatewayId, gatewayName: g.gatewayName, gatewayMac: g.gatewayMac,
        networkName: g.networkName, isOnline: g.isOnline, lockNum: g.lockNum, gatewayVersion: g.gatewayVersion,
      })
    }
    const total = Number(data?.total ?? 0)
    if (list.length < 50 || all.length >= total) break
    pageNo++
    if (pageNo > 20) break
  }
  return all
}

/**
 * Un código tal como vive HOY en la cerradura física (distinto de la tabla `lock_codes` de la BD).
 * `keyboardPwdType`: 1 permanente · 2 temporal · 3 período · 4 borrado, etc. (Sciener). `status` 1 = válido.
 */
export interface TTLockPasscode {
  keyboardPwdId: number
  keyboardPwd?: string
  keyboardPwdName?: string
  keyboardPwdType?: number
  startDate?: number
  endDate?: number
  status?: number
}

/** Lee los códigos (keyboardPwd) reales de UNA cerradura física, paginando. */
export async function listLockPasscodes(c: TTLockCreds, lockId: number): Promise<TTLockPasscode[]> {
  if (!c.accessToken) throw new Error('Sin access_token de TTLock (conectá primero)')
  const all: TTLockPasscode[] = []
  let pageNo = 1
  for (;;) {
    const qs = new URLSearchParams({
      clientId: c.clientId, accessToken: c.accessToken, lockId: String(lockId),
      pageNo: String(pageNo), pageSize: '50', date: String(nowMs()),
    })
    const data = await readJson(await fetchWithRetry(`${base(c.region)}/v3/lock/listKeyboardPwd?${qs}`))
    assertOk(data, 'listar códigos de la cerradura')
    const list: any[] = data?.list || []
    for (const p of list) {
      all.push({
        keyboardPwdId: p.keyboardPwdId, keyboardPwd: p.keyboardPwd,
        keyboardPwdName: p.keyboardPwdName ?? p.nickName, keyboardPwdType: p.keyboardPwdType,
        startDate: p.startDate, endDate: p.endDate, status: p.status,
      })
    }
    const total = Number(data?.total ?? 0)
    if (list.length < 50 || all.length >= total) break
    pageNo++
    if (pageNo > 20) break
  }
  return all
}

/**
 * Un registro de actividad de la cerradura (apertura, intento fallido, cambio de config).
 * `recordType` es el código del evento de Sciener; `success` 1 = OK, 0 = falló. `lockDate` en ms.
 */
export interface TTLockRecord {
  recordId: number
  recordType?: number
  success?: number
  keyboardPwd?: string
  keyName?: string
  username?: string
  lockDate?: number
}

/** Lee el historial de actividad de UNA cerradura física entre dos fechas (ms), paginando. */
export async function listLockRecords(c: TTLockCreds, lockId: number, startMs: number, endMs: number): Promise<TTLockRecord[]> {
  if (!c.accessToken) throw new Error('Sin access_token de TTLock (conectá primero)')
  const all: TTLockRecord[] = []
  let pageNo = 1
  for (;;) {
    const qs = new URLSearchParams({
      clientId: c.clientId, accessToken: c.accessToken, lockId: String(lockId),
      startDate: String(startMs), endDate: String(endMs),
      pageNo: String(pageNo), pageSize: '50', date: String(nowMs()),
    })
    const data = await readJson(await fetchWithRetry(`${base(c.region)}/v3/lockRecord/list?${qs}`))
    assertOk(data, 'listar registros de la cerradura')
    const list: any[] = data?.list || []
    for (const r of list) {
      all.push({
        recordId: r.recordId, recordType: r.recordType, success: r.success,
        keyboardPwd: r.keyboardPwd, keyName: r.keyName, username: r.username, lockDate: r.lockDate,
      })
    }
    const total = Number(data?.total ?? 0)
    if (list.length < 50 || all.length >= total) break
    pageNo++
    if (pageNo > 20) break
  }
  return all
}

/**
 * Abre la cerradura FÍSICA en remoto a través del gateway. Requiere que el gateway esté online y
 * en rango de la cerradura; si no, Sciener devuelve errcode y `assertOk` lanza.
 */
export async function unlockLock(c: TTLockCreds, lockId: number): Promise<void> {
  if (!c.accessToken) throw new Error('Sin access_token de TTLock (conectá primero)')
  const res = await fetchWithRetry(`${base(c.region)}/v3/lock/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clientId: c.clientId,
      accessToken: c.accessToken,
      lockId: String(lockId),
      date: String(nowMs()),
    }),
  })
  assertOk(await readJson(res), 'abrir la cerradura en remoto')
}

/** Gateway(s) que alcanzan a UNA cerradura, con la señal (`rssi`, dBm; más cerca de 0 = mejor). */
export interface TTLockLockGateway {
  gatewayId: number
  gatewayName?: string
  gatewayMac?: string
  rssi?: number
}

export async function listLockGateways(c: TTLockCreds, lockId: number): Promise<TTLockLockGateway[]> {
  if (!c.accessToken) throw new Error('Sin access_token de TTLock (conectá primero)')
  const qs = new URLSearchParams({
    clientId: c.clientId, accessToken: c.accessToken, lockId: String(lockId), date: String(nowMs()),
  })
  const data = await readJson(await fetchWithRetry(`${base(c.region)}/v3/gateway/listByLock?${qs}`))
  assertOk(data, 'listar el gateway de la cerradura')
  return (data?.list || []).map((g: any) => ({
    gatewayId: g.gatewayId, gatewayName: g.gatewayName, gatewayMac: g.gatewayMac, rssi: g.rssi,
  }))
}

/**
 * Crea un código PERMANENTE (fijo) en la cerradura — no atado a reserva (staff, mantenimiento).
 * `keyboardPwdType=1` + `endDate=0` = permanente (verificado contra la API). Devuelve keyboardPwdId.
 */
export async function addPermanentPasscode(
  c: TTLockCreds, lockId: number, password: string, name?: string,
): Promise<{ keyboardPwdId?: string }> {
  const res = await fetchWithRetry(`${base(c.region)}/v3/keyboardPwd/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clientId: c.clientId,
      accessToken: c.accessToken!,
      lockId: String(lockId),
      keyboardPwd: password,
      keyboardPwdName: name || 'Fijo',
      keyboardPwdType: '1',
      startDate: String(nowMs()),
      endDate: '0',
      addType: String(c.addType ?? DEFAULT_ADD_TYPE),
      date: String(nowMs()),
    }),
  })
  const data = await readJson(res)
  assertOk(data, 'crear código permanente')
  return { keyboardPwdId: data?.keyboardPwdId != null ? String(data.keyboardPwdId) : undefined }
}
