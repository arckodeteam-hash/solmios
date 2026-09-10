// usePasswordStrength.ts — Feedback en vivo de la contraseña mientras se escribe.
//
// ESPEJO de backend/src/shared/password-policy.ts. La validación que decide es
// la del servidor (el cliente se puede saltear); esto existe para que no haya
// que apretar "Crear cuenta" para enterarse de qué falta.
//
// Si cambian las reglas del backend, cambian acá. A este piso estático se le
// suma la política configurable por el admin (REQ-CFG-05), que llega por
// GET /api/auth/password-policy (ver usePasswordPolicy.ts) y puede subir el
// largo mínimo o exigir un carácter especial.
import { computed, type Ref } from 'vue'
import type { PasswordPolicy } from './usePasswordPolicy'

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

/** A partir de acá la contraseña se considera "Excelente" (ver `score`). */
const STRONG_LENGTH = 16

/** Las mismas de shared/password-policy.ts. */
const COMMON = new Set([
  'password', 'password1', 'password123', 'contrasena', 'contraseña',
  '12345678', '123456789', '1234567890', 'qwertyuiop', 'qwerty123',
  'admin1234', 'administrador', 'bienvenido', 'welcome123', 'iloveyou',
  'hotel1234', 'hotelhotel', 'demo1234', 'letmein123', 'abc12345',
])

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s._-]/g, '')
}

export interface PasswordRequirement {
  label: string
  met: boolean
}

export interface PasswordContext {
  email?: string
  name?: string
}

/**
 * Requisitos + fuerza de una contraseña reactiva.
 *
 * Devuelve los requisitos SIEMPRE (no solo los incumplidos) para poder
 * mostrarlos como checklist: saber qué falta desde el principio es mejor que
 * descubrirlo de a un error por intento.
 */
export function usePasswordStrength(
  password: Ref<string>,
  ctx: () => PasswordContext = () => ({}),
  policy: () => Partial<PasswordPolicy> | undefined = () => undefined,
) {
  const requirements = computed<PasswordRequirement[]>(() => {
    const pwd = password.value ?? ''
    const n = norm(pwd)
    const c = ctx()
    const p = policy() ?? {}
    // La política del admin puede subir el largo, nunca bajarlo del piso estático.
    const min = Math.max(PASSWORD_MIN, p.minLength ?? 0)

    const local = norm(String(c.email ?? '').split('@')[0] ?? '')
    const name = norm(String(c.name ?? ''))

    return [
      { label: `Al menos ${min} caracteres`, met: pwd.length >= min && pwd.length <= PASSWORD_MAX },
      { label: 'Una letra minúscula', met: /[a-záéíóúñ]/.test(pwd) },
      { label: 'Una letra mayúscula', met: /[A-ZÁÉÍÓÚÑ]/.test(pwd) },
      { label: 'Un número', met: /[0-9]/.test(pwd) },
      // Mayúscula y número ya son fijos del registro; lo único que la política suma es el especial.
      ...(p.requireSpecial
        ? [{ label: 'Un carácter especial', met: /[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/.test(pwd) }]
        : []),
      {
        label: 'No es una contraseña común ni tus datos',
        // Con la contraseña vacía este requisito daría "cumplido" y el checklist
        // arrancaría con un tilde verde sin haber escrito nada.
        met: pwd.length > 0
          && !COMMON.has(n)
          && !/^(.)\1+$/.test(pwd)
          && !(local.length >= 4 && n.includes(local))
          && !(name.length >= 4 && n.includes(name)),
      },
    ]
  })

  const metCount = computed(() => requirements.value.filter((r) => r.met).length)

  /** Todos los requisitos cumplidos: recién ahí el backend la va a aceptar. */
  const isValid = computed(() => requirements.value.every((r) => r.met))

  /**
   * 0–4, para la barra. Sin nada escrito es 0.
   *
   * Cumplir todos los requisitos llega a 3 ("Buena"), no al máximo: el último
   * escalón se gana con longitud, que es lo que de verdad encarece un ataque de
   * fuerza bruta. Si "Excelente" se lograra cumpliendo cada regla al mínimo,
   * la barra premiaría la contraseña más corta posible.
   */
  const score = computed(() => {
    if (!password.value) return 0
    const met = metCount.value
    const total = requirements.value.length
    if (met < total) return Math.min(2, Math.max(0, met - 1))
    return password.value.length >= STRONG_LENGTH ? 4 : 3
  })

  const label = computed(() => {
    if (!password.value) return ''
    return ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente'][score.value] ?? ''
  })

  /** Clase de color de la barra, del rojo al verde. */
  const barClass = computed(() =>
    ['bg-danger', 'bg-danger', 'bg-warning', 'bg-cyan', 'bg-success'][score.value] ?? 'bg-border',
  )

  return { requirements, isValid, score, label, barClass }
}
