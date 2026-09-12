// abandon-recovery/usecases/template.ts — Construcción del email + link (F3 3.14).
//
// Extraído de service.ts para mantenerlo < 200 líneas (regla del analyzer: God Object).
// Puro + sin IO: ideal para tests unitarios sin mockear orm ni email.

/** Paleta del email (inline CSS hex). Mismo look&feel Apple-system del panel. */
const EMAIL_PALETTE = {
  bg: '#f5f5f7',
  card: '#ffffff',
  textTitle: '#1d1d1f',
  textBody: '#3a3a3c',
  textMuted: '#86868b',
  ctaBg: '#0a84ff',
  ctaText: '#ffffff',
}

const EMAIL_SUBJECT = 'Completá tu reserva — te guardamos tus datos'

export function emailSubject(): string {
  return EMAIL_SUBJECT
}

/**
 * Arma el link de recuperación: el widget restaura el state desde
 * `?reservation=:id&token=:accessToken` (spec booking-unification R2).
 * Si falta base o slug, igual arma algo apuntando al dominio raíz (mal pero mejor que nada).
 *
 * El token en la URL es el `accessToken` de la reserva (NO es un token HMAC como el de
 * /api/public/reservations/:id — eso es para lectura; este es para reabrir el widget con
 * la selección previa).
 */
export function buildRecoveryLink(publicBaseUrl: string, hotelSlug: string, reservationId: string, accessToken: string): string {
  const base = (publicBaseUrl || '').replace(/\/$/, '')
  const path = hotelSlug ? `/book/${hotelSlug}` : '/book'
  const q = `?reservation=${encodeURIComponent(reservationId)}&token=${encodeURIComponent(accessToken)}`
  return base ? `${base}${path}${q}` : `${path}${q}`
}

/** Minutos por hora — para expresar TTLs "redondos" (múltiplos de 60 desde 2h) como horas. */
const MINUTES_PER_HOUR = 60

/** TTL por defecto (minutos) cuando el caller no lo pasa. Mismo valor que
 *  `bookingengine/usecases/config.ts` (DEFAULT_PENDING_TTL_MINUTES) — duplicado a propósito:
 *  no se importa entre módulos. */
const DEFAULT_TTL_MINUTES = 60

/**
 * Texto humano del TTL de pago (#266): "60 minutos", "90 minutos", "2 horas". Sólo pasa a
 * horas cuando es múltiplo exacto de 60 y ≥ 2h; el resto queda en minutos (simple y sin
 * ambigüedad para el huésped). Valores inválidos (NaN, ≤ 0) caen al default (60 min).
 */
export function formatPendingTtl(pendingTtlMinutes: number): string {
  const m = Number.isFinite(pendingTtlMinutes) && pendingTtlMinutes > 0 ? Math.round(pendingTtlMinutes) : DEFAULT_TTL_MINUTES
  if (m >= 2 * MINUTES_PER_HOUR && m % MINUTES_PER_HOUR === 0) {
    return `${m / MINUTES_PER_HOUR} horas`
  }
  return `${m} minutos`
}

/** Template HTML inline del email. Mantenemos inline (no depende de un archivo externo ni
 *  de AutoMessages). Si el hotel quiere customizar, F4 puede moverlo a auto_messages.
 *  `pendingTtlMinutes` (#266) es el TTL real de pago del hotel (booking_config.pendingTtlMinutes)
 *  para que el texto "vence en N minutos" coincida con lo que hace el cron de vencimiento. */
export function renderAbandonEmailHtml(opts: { link: string; reservationId: string; pendingTtlMinutes?: number }): string {
  const c = EMAIL_PALETTE
  const pendingTtl = formatPendingTtl(opts.pendingTtlMinutes ?? DEFAULT_TTL_MINUTES)
  return [
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `</head><body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; background:${c.bg}; margin:0; padding:24px;">`,
    `<div style="max-width:560px; margin:0 auto; background:${c.card}; border-radius:16px; padding:32px 24px; box-shadow:0 2px 16px rgba(0,0,0,0.06);">`,
    `<h1 style="margin:0 0 12px; font-size:22px; color:${c.textTitle};">Tu reserva te está esperando</h1>`,
    `<p style="margin:0 0 16px; color:${c.textBody}; line-height:1.5;">`,
    'Vimos que empezaste a reservar pero no terminaste. No te preocupes:',
    'nos guardamos tus datos para que retomes justo donde lo dejaste.',
    '</p>',
    '<a href="' + escapeHtml(opts.link) + '" ',
    `style="display:inline-block; background:${c.ctaBg}; color:${c.ctaText}; text-decoration:none; padding:14px 24px; border-radius:12px; font-weight:600; font-size:15px;">`,
    'Completar mi reserva</a>',
    `<p style="margin:24px 0 0; color:${c.textMuted}; font-size:12px; line-height:1.5;">`,
    'Si no querés continuar, ignorá este correo. El link caduca cuando la reserva',
    ` vence automáticamente si no se completa el pago en ${pendingTtl}.`,
    '</p>',
    '</div></body></html>',
  ].join('')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
