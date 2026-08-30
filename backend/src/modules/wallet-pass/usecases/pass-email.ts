// wallet-pass/usecases/pass-email.ts — Email "Tu pase de reserva + código de acceso" (F3 3.9).
//
// Spec: wallet-pass/spec.md "Email al huésped con ambos links". Disparado tras generar el
// pass (en el connector `reservas-wallet`). HTML responsive con:
//   - Botón "Agregar a Apple Wallet" (si appleUrl).
//   - Botón "Agregar a Google Wallet" (si googleUrl).
//   - Sección fallback con lockCode en mono font grande + ícono de llave.
//   - Detalles de la reserva (hotel, fechas, habitación).
//
// Best-effort: si el huésped no tiene email (walk-in), no se encola — log 'skipped'.
// Si el EmailService no está inyectado (tests), devolvemos `{ status: 'skipped' }`.
//
// NO usa `enqueueNotification(event='wallet_pass')` porque ese flujo requiere plantilla
// registrada en notification-defaults. Acá el HTML se renderiza en runtime (los URLs son
// únicos por reserva) y se encola directo con `emailService.enqueue({ to, subject, html })`.
// Mismo patrón que `usuarios/email-verification.ts`.
import type { Logger } from 'arckode-framework'
import type { EmailService } from '../../../services/email-service'

/** Deps inyectadas desde composition-root (email-bootstrap cablea el EmailService). */
export interface PassEmailDeps {
  emailService: EmailService
  logger: Logger
}

/** Datos necesarios para armar el email. El caller los saca de la reserva + pass persistido. */
export interface PassEmailInput {
  to: string
  hotelId: string
  reservationId: string
  hotelName: string
  guestName: string
  checkIn: string
  checkOut: string
  /** Horario en que el código ABRE y deja de abrir ('HH:MM'). Es la ventana REAL cargada en la
   *  cerradura: sin esto el huésped recibe el PIN sin saber desde qué hora le sirve, y prueba
   *  la puerta antes de tiempo creyendo que el código no anda. */
  checkInTime?: string
  checkOutTime?: string
  roomNumber?: string
  lockCode: string
  appleUrl?: string | null
  googleUrl?: string | null
}

const SUBJECT_ES = 'Tu pase de reserva + código de acceso — {hotel_name}'
const APPLE_BUTTON_LABEL = 'Agregar a Apple Wallet'
const GOOGLE_BUTTON_LABEL = 'Agregar a Google Wallet'

/** Escapa texto para meterlo en HTML de forma segura (sin ngx/sanitize acá). */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Render del HTML del email. Público por separado del enqueue para que el test pueda
 * validarlo sin tener que mockear el EmailService.
 */
export function renderWalletPassEmail(input: PassEmailInput): string {
  const hotelName = esc(input.hotelName)
  const guestName = esc(input.guestName)
  const checkIn = esc(input.checkIn)
  const checkOut = esc(input.checkOut)
  // Vacío si el caller no las pasó: se degrada a solo fecha en vez de romper el correo.
  const checkInTime = input.checkInTime ? ` · ${esc(input.checkInTime)}` : ''
  const checkOutTime = input.checkOutTime ? ` · ${esc(input.checkOutTime)}` : ''
  const roomNumber = input.roomNumber ? esc(input.roomNumber) : '—'
  const lockCode = esc(input.lockCode)

  const appleBlock = input.appleUrl
    ? `<a href="${esc(input.appleUrl)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold;margin:4px 8px 4px 0;font-size:14px;">${APPLE_BUTTON_LABEL}</a>`
    : ''
  const googleBlock = input.googleUrl
    ? `<a href="${esc(input.googleUrl)}" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold;margin:4px 8px 4px 0;font-size:14px;">${GOOGLE_BUTTON_LABEL}</a>`
    : ''
  const buttons = (appleBlock || googleBlock)
    ? `<div style="margin:16px 0 8px;">${appleBlock}${googleBlock}</div>`
    : ''
  const buttonsHint = (appleBlock || googleBlock)
    ? '<p style="font-size:13px;color:#6b7280;margin:0 0 16px;">Tocá un botón para guardar el pase en tu celular.</p>'
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 ${hotelName}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Tu pase de reserva + código de acceso</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>${guestName}</strong>,</p>
    <p>Tu reserva está confirmada. Guardá tu pase digital para entrar sin pasar por recepción:</p>
    ${buttons}
    ${buttonsHint}
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:bold;">🔑 Tu código de acceso</p>
      <p style="margin:0;font-family:'Courier New',monospace;font-size:28px;letter-spacing:4px;color:#1a2b4c;font-weight:bold;text-align:center;background:#f3f4f6;padding:12px;border-radius:6px;">${lockCode}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280;text-align:center;">Si el pase digital no funciona, usá este código en el teclado de la puerta.</p>
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Habitación</td><td style="padding:6px 0;font-weight:bold;text-align:right;">${roomNumber}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">${checkIn}${checkInTime}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">${checkOut}${checkOutTime}</td></tr>
      </table>
    </div>
    <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">El código abre la puerta desde el <strong>${checkIn}${checkInTime || ''}</strong> y deja de funcionar el <strong>${checkOut}${checkOutTime || ''}</strong>. Si necesitás entrar antes o salir más tarde, avisale al hotel y te ajustamos el horario.</p>
    <p style="font-size:13px;color:#6b7280;">Localizador: <strong>${esc(input.reservationId)}</strong></p>
    <p style="font-size:13px;color:#6b7280;">¡Te esperamos!</p>
  </div>
</body>
</html>`
}

/**
 * Encola el email "Tu pase de reserva + código de acceso". Best-effort, no lanza.
 */
export async function sendWalletPassEmail(
  deps: PassEmailDeps,
  input: PassEmailInput,
): Promise<{ status: 'sent' | 'skipped' | 'failed' }> {
  if (!input.to) {
    deps.logger.info('wallet-pass email: sin destinatario (walk-in)', { reservationId: input.reservationId })
    return { status: 'skipped' }
  }
  try {
    const subject = SUBJECT_ES.replace('{hotel_name}', input.hotelName)
    const html = renderWalletPassEmail(input)
    const queueId = await deps.emailService.enqueue({
      to: input.to,
      subject,
      html,
      hotelId: input.hotelId,
      relatedType: 'wallet_pass',
      relatedId: input.reservationId,
    })
    deps.logger.info('wallet-pass email encolado', { reservationId: input.reservationId, to: input.to, queueId })
    return { status: 'sent' }
  } catch (e: unknown) {
    deps.logger.warn('wallet-pass email falló al encolar', {
      reservationId: input.reservationId, error: (e as Error).message,
    })
    return { status: 'failed' }
  }
}
