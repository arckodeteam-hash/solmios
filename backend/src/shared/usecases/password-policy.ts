// password-policy.ts — Política de contraseñas CONFIGURABLE por el admin (REQ-CFG-05).
//
// A diferencia de `shared/password-policy.ts` (la regla estática del alta
// pública), esta se lee de la tabla Configuration con hotelId='platform' y
// key='security_policy'. Si no hay fila o el valor no sirve, rige el default.
import { ValidationError } from 'arckode-framework'
import { PASSWORD_MAX } from '../password-policy'

export const SECURITY_POLICY_KEY = 'security_policy'
/** Piso: coincide con el min:6 del schema estático de usuarios. */
export const POLICY_MIN_LENGTH = 6
export const POLICY_MAX_LENGTH = 32

export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireNumbers: boolean
  requireSpecial: boolean
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 6,
  requireUppercase: false,
  requireNumbers: false,
  requireSpecial: false,
}

/** La columna value es json: el ORM puede devolver objeto o string. */
function safeParse(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

/** Devuelve una política válida a partir de lo que haya guardado: basura → default. */
export function normalizePasswordPolicy(raw: unknown): PasswordPolicy {
  const obj = safeParse(raw)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...DEFAULT_PASSWORD_POLICY }
  const src = obj as Record<string, unknown>

  let minLength = Number(src.minLength)
  if (!Number.isFinite(minLength)) minLength = DEFAULT_PASSWORD_POLICY.minLength
  minLength = Math.round(Math.min(POLICY_MAX_LENGTH, Math.max(POLICY_MIN_LENGTH, minLength)))

  return {
    minLength,
    requireUppercase: Boolean(src.requireUppercase),
    requireNumbers: Boolean(src.requireNumbers),
    requireSpecial: Boolean(src.requireSpecial),
  }
}

type ConfigRepo = { findMany: (f: any) => Promise<any[]> } | undefined | null

/** Lee configuration(hotelId='platform', key='security_policy'). Sin fila o error → DEFAULT. */
export async function readPasswordPolicy(configRepo: ConfigRepo): Promise<PasswordPolicy> {
  if (!configRepo) return { ...DEFAULT_PASSWORD_POLICY }
  try {
    const rows = await configRepo.findMany({ hotelId: 'platform', key: SECURITY_POLICY_KEY })
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row) return { ...DEFAULT_PASSWORD_POLICY }
    return normalizePasswordPolicy(row.value)
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY }
  }
}

/** Primer motivo por el que la clave viola la política, o null si cumple. */
export function validatePassword(password: string, policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY): string | null {
  const pwd = String(password ?? '')
  if (pwd.length < policy.minLength) return `La contraseña debe tener al menos ${policy.minLength} caracteres`
  if (pwd.length > PASSWORD_MAX) return `La contraseña no puede superar los ${PASSWORD_MAX} caracteres`
  if (policy.requireUppercase && !/[A-ZÁÉÍÓÚÑ]/.test(pwd)) return 'La contraseña debe tener al menos una mayúscula'
  if (policy.requireNumbers && !/[0-9]/.test(pwd)) return 'La contraseña debe tener al menos un número'
  if (policy.requireSpecial && !/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(pwd)) return 'La contraseña debe tener al menos un carácter especial'
  return null
}

/** Azúcar para los flujos que fijan contraseña: lee la política y lanza si viola. */
export async function assertPasswordPolicy(configRepo: ConfigRepo, password: string): Promise<void> {
  const policy = await readPasswordPolicy(configRepo)
  const issue = validatePassword(password, policy)
  if (issue) throw new ValidationError(issue)
}

/** Handler de GET /api/auth/password-policy (público, sin secretos). */
export async function passwordPolicyHandler(configRepo: ConfigRepo): Promise<{ status: number; body: PasswordPolicy }> {
  return { status: 200, body: await readPasswordPolicy(configRepo) }
}
