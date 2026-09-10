// usePasswordPolicy.ts — Política de contraseñas configurable por el admin (REQ-CFG-05).
//
// ESPEJO de backend/src/shared/usecases/password-policy.ts: la regla que decide
// es la del servidor (el cliente se puede saltear); esto lee la política por
// GET /api/auth/password-policy y la muestra ANTES de fallar, para que el
// usuario sepa qué se le pide sin tener que apretar el botón.
//
// Si cambian los mensajes o regexes del backend, cambian acá.
import { computed, onMounted, ref } from 'vue'
import { http } from '@/services/http'
import { PASSWORD_MAX } from './usePasswordStrength'

export interface PasswordPolicy {
  minLength: number
  requireUppercase: boolean
  requireNumbers: boolean
  requireSpecial: boolean
}

/** Mismos límites que POLICY_MIN_LENGTH / POLICY_MAX_LENGTH del backend. */
export const POLICY_MIN_LENGTH = 6
export const POLICY_MAX_LENGTH = 32

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 6,
  requireUppercase: false,
  requireNumbers: false,
  requireSpecial: false,
}

const UPPER_RE = /[A-ZÁÉÍÓÚÑ]/
const DIGIT_RE = /[0-9]/
const SPECIAL_RE = /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/

/** Basura → default; minLength fuera de rango → recortado a 6..32. */
export function normalizePasswordPolicy(raw: unknown): PasswordPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_PASSWORD_POLICY }
  const src = raw as Record<string, unknown>

  let minLength = Number(src.minLength)
  if (!Number.isFinite(minLength)) minLength = DEFAULT_PASSWORD_POLICY.minLength
  minLength = Math.round(Math.min(POLICY_MAX_LENGTH, Math.max(POLICY_MIN_LENGTH, minLength)))

  return {
    minLength,
    requireUppercase: !!src.requireUppercase,
    requireNumbers: !!src.requireNumbers,
    requireSpecial: !!src.requireSpecial,
  }
}

/** Lee la política del backend. Sirve con o sin sesión; ante error rige el default. */
export async function fetchPasswordPolicy(): Promise<PasswordPolicy> {
  try {
    const raw = await http.get<unknown>('/auth/password-policy')
    return normalizePasswordPolicy(raw)
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY }
  }
}

/**
 * Texto de ayuda: "Mínimo 10 caracteres, con al menos una mayúscula y un número".
 * `floor` es un piso extra que la pantalla impone por encima de la política
 * (el registro público exige 10 aunque el admin configure 6).
 */
export function describePasswordPolicy(p: PasswordPolicy, floor = 0): string {
  const min = Math.max(p.minLength, floor)
  const extras: string[] = []
  if (p.requireUppercase) extras.push('una mayúscula')
  if (p.requireNumbers) extras.push('un número')
  if (p.requireSpecial) extras.push('un carácter especial')

  let text = `Mínimo ${min} caracteres`
  if (extras.length === 0) return text
  const last = extras.pop() as string
  const list = extras.length ? `${extras.join(', ')} y ${last}` : last
  text += `, con al menos ${list}`
  return text
}

/** Primer motivo por el que la clave viola la política, o null si cumple. Mismos mensajes que el backend. */
export function checkPasswordPolicy(pwd: string, p: PasswordPolicy, floor = 0): string | null {
  const value = String(pwd ?? '')
  const min = Math.max(p.minLength, floor)
  if (value.length < min) return `La contraseña debe tener al menos ${min} caracteres`
  if (value.length > PASSWORD_MAX) return `La contraseña no puede superar los ${PASSWORD_MAX} caracteres`
  if (p.requireUppercase && !UPPER_RE.test(value)) return 'La contraseña debe tener al menos una mayúscula'
  if (p.requireNumbers && !DIGIT_RE.test(value)) return 'La contraseña debe tener al menos un número'
  if (p.requireSpecial && !SPECIAL_RE.test(value)) return 'La contraseña debe tener al menos un carácter especial'
  return null
}

const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ALNUM = LOWER + UPPER + DIGITS

function pick(chars: string): string {
  return chars.charAt(Math.floor(Math.random() * chars.length)) || 'a'
}

/**
 * Contraseña temporal aleatoria que cumple la política. Garantiza al menos una
 * mayúscula / un dígito / un '!' cuando la política los exige, y los mezcla
 * para que no queden siempre en la misma posición.
 */
export function generateCompliantPassword(p: PasswordPolicy, len = Math.max(8, p.minLength)): string {
  const length = Math.max(len, p.minLength)
  const chars: string[] = []
  if (p.requireUppercase) chars.push(pick(UPPER))
  if (p.requireNumbers) chars.push(pick(DIGITS))
  if (p.requireSpecial) chars.push('!')
  while (chars.length < length) chars.push(pick(ALNUM))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j] as string, chars[i] as string]
  }
  return chars.join('')
}

/**
 * Composable: carga la política al montar y expone el texto de ayuda y el
 * chequeo local. Hasta que llega la respuesta rige el default (6 caracteres).
 */
export function usePasswordPolicy(floor = 0) {
  const policy = ref<PasswordPolicy>({ ...DEFAULT_PASSWORD_POLICY })
  const loaded = ref(false)
  // `ready` es para quien arma un formulario en un instante, como los fields de
  // un modal o una clave auto-generada. Sin esperarlo, un clic antes de que
  // llegue el fetch usaría el default y el backend rechazaría lo que la pantalla
  // dio por bueno.
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>((resolve) => { resolveReady = resolve })

  onMounted(async () => {
    policy.value = await fetchPasswordPolicy()
    loaded.value = true
    resolveReady()
  })

  const hint = computed(() => describePasswordPolicy(policy.value, floor))
  const check = (pwd: string) => checkPasswordPolicy(pwd, policy.value, floor)

  return { policy, loaded, ready, hint, check }
}
