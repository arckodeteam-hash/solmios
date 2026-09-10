// usuarios/usecases/password.ts — Flujos de contraseña: olvido, reset y cambio.
//
// `forgotPassword` no revela si el email existe (devuelve void igual): decir "ese usuario no
// existe" convierte el endpoint en un enumerador de cuentas.
//
// Reset y cambio invalidan el `token` de sesión: cambiar la contraseña tiene que echar a quien
// estuviera usando la anterior.

import type { RepositoryAdapter } from 'arckode-framework'
import { AuthError, NotFoundError } from 'arckode-framework'
import { assertPasswordPolicy } from '../../../shared/usecases/password-policy'

const RESET_TTL_MS = 60 * 60 * 1000 // 1 hora

export async function hashPassword(p: string): Promise<string> {
  return Bun.password.hash(p, 'bcrypt')
}

/** Acepta hashes bcrypt/argon2 y, por compatibilidad con datos viejos, texto plano. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2') || stored.startsWith('$argon2')) {
    try { return await Bun.password.verify(plain, stored) } catch { return false }
  }
  return stored === plain
}

export async function forgotPassword(repo: RepositoryAdapter<any>, email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase()
  const user = await repo.findOne({ email: normalizedEmail })
  if (!user) return // silencio deliberado: no filtrar qué emails existen
  await repo.update(user.id, {
    resetToken: crypto.randomUUID(),
    resetExpires: Date.now() + RESET_TTL_MS,
  })
}

export async function resetPassword(
  repo: RepositoryAdapter<any>,
  token: string,
  newPassword: string,
  configRepo?: RepositoryAdapter<any>,
): Promise<void> {
  const user = await repo.findOne({ resetToken: token })
  if (!user || user.resetExpires < Date.now()) throw new AuthError('Token inválido o expirado')
  // La política configurable (REQ-CFG-05) se aplica DESPUÉS de validar el token: sin él no hay flujo.
  await assertPasswordPolicy(configRepo, newPassword)
  const hashed = await hashPassword(newPassword)
  await repo.update(user.id, { password: hashed, token: null, resetToken: null, resetExpires: null })
}

export async function changePassword(
  repo: RepositoryAdapter<any>,
  id: string,
  currentPassword: string,
  newPassword: string,
  configRepo?: RepositoryAdapter<any>,
): Promise<void> {
  // Ownership: callerUserId === id se valida en el controller vía auth.assertOwnership().
  // Acá además se re-autentica con currentPassword.
  if (!id) throw new AuthError('userId requerido')
  const user = await repo.findById(id)
  if (!user) throw new NotFoundError('Usuario no encontrado')
  if (!(await verifyPassword(currentPassword, user.password))) {
    throw new AuthError('Contraseña actual incorrecta')
  }
  await assertPasswordPolicy(configRepo, newPassword)
  const hashed = await hashPassword(newPassword)
  await repo.update(id, { password: hashed, token: null })
}
