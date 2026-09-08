// email-verification.ts — Verificación de email del alta (#421).
//
// El alta NO se bloquea: el hotel entra igual y usa el sistema, pero se le avisa hasta que
// verifique. El token viaja en claro en el link del correo; en la BD se guarda su HASH (sha256),
// para que un dump de `users` no regale accesos. Un solo uso, con vencimiento.

import { createHash, randomBytes } from 'node:crypto'
import type { RepositoryAdapter } from 'arckode-framework'

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000   // 24 h

export interface VerificationUser {
  id: string
  email?: string
  emailVerifiedAt?: string | null
  emailVerificationToken?: string | null
  emailVerificationExpires?: number | null
}

/** Hash del token para guardar/buscar. Nunca se persiste el token en claro. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Token nuevo: el `token` va en el link del correo; `tokenHash` + `expires` se guardan en el user. */
export function newVerificationToken(now: number = Date.now()): { token: string; tokenHash: string; expires: number } {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashToken(token), expires: now + TOKEN_TTL_MS }
}

export type VerifyOutcome = 'verified' | 'invalid' | 'expired' | 'already_verified'

/**
 * Marca el email como verificado si el token es válido. Los motivos se distinguen para dar mensajes
 * distintos, PERO nunca revelan si un email existe (se busca por hash de token, no por email).
 */
export async function verifyEmailToken(
  repo: RepositoryAdapter<VerificationUser>,
  token: string,
  now: number = Date.now(),
): Promise<VerifyOutcome> {
  if (!token) return 'invalid'
  const user = await repo.findOne({ emailVerificationToken: hashToken(token) })
  if (!user) return 'invalid'
  if (user.emailVerifiedAt) return 'already_verified'
  if (!user.emailVerificationExpires || user.emailVerificationExpires < now) return 'expired'
  await repo.update(user.id, {
    emailVerifiedAt: new Date(now).toISOString(),
    emailVerificationToken: null,       // un solo uso
    emailVerificationExpires: null,
  } as Partial<VerificationUser>)
  return 'verified'
}

/** Vigencia del enlace en horas, derivada de `TOKEN_TTL_MS` (nunca escrita a mano). */
const TOKEN_TTL_HOURS = TOKEN_TTL_MS / 3_600_000

/**
 * Asunto + HTML del ÚNICO correo del alta (#69): bienvenida y verificación juntas.
 * `link` se interpola tal cual (lo arma el backend); todo dato externo pasa por `escapeHtml`.
 * `trialDays` sólo se menciona si viene y es > 0: sin él no se promete ninguna prueba.
 */
export function welcomeVerificationEmail(link: string, hotelName: string, trialDays?: number): { subject: string; html: string } {
  const hotel = escapeHtml(hotelName)
  const trial = trialDays && trialDays > 0
    ? `\n      <p style="margin:12px 0 0;text-align:center;font-size:14px;color:#1a2b4c;">Su prueba gratuita de <strong>${trialDays} días</strong> ya está activa.</p>`
    : ''
  return {
    subject: 'Bienvenido a SolmiOS — verifique su correo',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 ${hotel}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Bienvenido a SOLMI OS</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola,</p>
    <p>Le damos la bienvenida a <strong>SOLMI OS</strong>. La cuenta de <strong>${hotel}</strong> ya está creada; sólo falta confirmar esta dirección de correo.</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 12px;text-align:center;"><a href="${link}" style="background:#0a1322;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Verificar mi correo</a></p>
      <p style="margin:0;text-align:center;font-size:13px;color:#6b7280;">El enlace es válido por ${TOKEN_TTL_HOURS} horas.</p>${trial}
    </div>
    <p style="font-size:13px;color:#6b7280;">Si no reconoce esta cuenta, ignore este correo.</p>
  </div>
</body>
</html>`,
  }
}

/** Regenera el token y reenvía el correo. Devuelve {sent:false} si ya está verificado o sin sender. */
export async function resendVerificationEmail(
  repo: RepositoryAdapter<VerificationUser & { name?: string; hotelId?: string }>,
  sender: { enqueue: (i: { to: string; subject: string; html: string; hotelId: string; relatedType?: string }) => Promise<string> } | undefined,
  appUrl: string,
  userId: string,
  // El correo identifica la CUENTA: el header lleva el nombre del hotel, no el del usuario.
  hotelRepo?: RepositoryAdapter<any>,
): Promise<{ sent: boolean }> {
  const u = await repo.findById(userId)
  if (!u) return { sent: false }
  if (u.emailVerifiedAt) return { sent: false }
  const v = newVerificationToken()
  await repo.update(u.id, { emailVerificationToken: v.tokenHash, emailVerificationExpires: v.expires } as any)
  if (!sender || !u.email) return { sent: false }
  const link = `${appUrl.replace(/\/$/, '')}/api/public/verify-email?token=${v.token}`
  // Sin `trialDays`: en el reenvío no se sabe si hay una prueba vigente.
  const mail = welcomeVerificationEmail(link, await resolveHotelName(hotelRepo, u))
  await sender.enqueue({ to: u.email, subject: mail.subject, html: mail.html, hotelId: u.hotelId || '', relatedType: 'email_verification' })
  return { sent: true }
}

/** Nombre del hotel para el header; cae al nombre del usuario si no se puede resolver. */
async function resolveHotelName(hotelRepo: RepositoryAdapter<any> | undefined, u: { name?: string; hotelId?: string }): Promise<string> {
  if (u.hotelId && hotelRepo) {
    try {
      // @ignore IDOR_RISK — `hotelId` sale del registro propio del usuario.
      const hotel = await hotelRepo.findById(u.hotelId)
      const name = (hotel as any)?.name
      if (name) return name
    } catch {
      // El correo sirve igual con el nombre de respaldo.
    }
  }
  return u.name || ''
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
