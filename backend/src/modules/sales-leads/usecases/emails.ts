// sales-leads/usecases/emails.ts — HTML de los 2 correos del flujo: acuse de recibo al lead
// y aviso al equipo de ventas (siempre, para no perder un lead entrante).
const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildAckEmail(opts: { fullName: string }): { subject: string; html: string } {
  const name = esc(opts.fullName || 'Hola')
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
    <h2 style="color:#0f172a">Recibimos tu consulta</h2>
    <p>${name}, gracias por tu interés en SOLMI OS. Nuestro equipo de ventas te va a contactar a la brevedad.</p>
    <p style="font-size:13px;color:#64748b">SOLMI OS, S.R.L. · ventas@solmios.com</p>
  </div>`
  return { subject: 'Recibimos tu consulta — SOLMI OS', html }
}

export function buildAdminAlertEmail(opts: {
  fullName: string; email: string; phone: string | null; hotelName: string | null
  roomsRange: string | null; message: string | null; planInterest: string | null
}): { subject: string; html: string } {
  const name = esc(opts.fullName)
  const email = esc(opts.email)
  const phone = opts.phone ? esc(opts.phone) : '<em>no indicado</em>'
  const hotel = opts.hotelName ? esc(opts.hotelName) : '<em>no indicado</em>'
  const rooms = opts.roomsRange ? esc(opts.roomsRange) : '<em>no indicado</em>'
  const plan = opts.planInterest ? esc(opts.planInterest) : '<em>ninguno (CTA genérico)</em>'
  const message = opts.message ? esc(opts.message).replace(/\n/g, '<br>') : '<em>sin mensaje</em>'
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
    <h2 style="color:#0f172a">Nuevo lead de ventas</h2>
    <p><b>Nombre:</b> ${name}<br><b>Email:</b> ${email}<br><b>Teléfono:</b> ${phone}</p>
    <p><b>Hotel/establecimiento:</b> ${hotel}<br><b>Habitaciones:</b> ${rooms}<br><b>Plan de interés:</b> ${plan}</p>
    <p><b>Mensaje:</b><br>${message}</p>
    <p style="font-size:14px">Gestioná el lead desde Panel › Leads de Ventas.</p>
  </div>`
  return { subject: `[Ventas] Nuevo lead — ${opts.fullName}`, html }
}

// ─── REQ-PIPE-04 (#145): aviso a ventas cuando un hotel se registra ─────────────────────────
//
// Hoy el alta manda un solo correo, al hotel. Ventas no se entera y el trial se enfría solo
// (15 de 19 vencidos en prod sin una llamada). Este correo sale en la MISMA petición del alta y
// trae todo para contactar en 5 minutos: WhatsApp con el texto ya escrito, email, teléfono y el
// link al pipeline. Es una función pura: el service decide a quién y cómo encolarlo.

export interface SignupAlertInput {
  hotelId: string
  hotelName: string
  ownerName: string
  email: string
  phone: string | null
  /** ISO-3166 alfa-2 del hotel; si no cargó, `whatsappUrlFor` asume DO. */
  country: string | null
  /** Nombre del plan elegido en el alta (resuelto por el service) o `null` si no eligió. */
  planName: string | null
  /** Base pública del panel (PUBLIC_URL). Vacío ⇒ link relativo, igual sirve como referencia. */
  appUrl: string
  /** `https://wa.me/1809...` ya en E.164, o `null` si el teléfono no da para armarlo. */
  whatsappUrl: string | null
}

/** Ruta del pipeline en el panel del super-admin. */
export const SALES_PIPELINE_PATH = '/admin/leads-ventas'

/**
 * Texto con el que el vendedor abre la conversación. Va en español y trata de "usted",
 * igual que el resto del copy de registro. `hotelName` es el gancho: la persona sabe de qué
 * le hablan. `platformName` viene de `configuration('plataforma')` (`resolvePlatformIdentity`),
 * nunca escrito acá (CFG-1): el nombre que carga el super-admin es el que se presenta.
 */
export function signupWhatsappText(ownerName: string, hotelName: string, platformName: string): string {
  const who = ownerName.trim() ? `Hola ${ownerName.trim()}` : 'Hola'
  return `${who}, le escribo de ${platformName.trim()}. Vi que acaba de registrar ${hotelName.trim()} en la plataforma y quería saber si le puedo ayudar a dejarlo andando. ¿Tiene unos minutos?`
}

export function buildSignupAlertEmail(input: SignupAlertInput): { subject: string; html: string } {
  const hotel = esc(input.hotelName)
  const owner = input.ownerName.trim() ? esc(input.ownerName) : '<em>no indicado</em>'
  const email = esc(input.email)
  const phone = input.phone?.trim() ? esc(input.phone) : '<em>no indicado</em>'
  const plan = input.planName ? esc(input.planName) : '<em>sin plan elegido</em>'
  const pipelineUrl = `${input.appUrl.replace(/\/$/, '')}${SALES_PIPELINE_PATH}`

  const whatsapp = input.whatsappUrl
    ? `<a href="${esc(input.whatsappUrl)}" style="display:inline-block;background:#25D366;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Escribir por WhatsApp</a>`
    : '<em>sin teléfono válido para WhatsApp — contactar por email</em>'

  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
    <h2 style="color:#0f172a">Hotel nuevo registrado: ${hotel}</h2>
    <p>Se acaba de registrar y arrancó su prueba. Contactarlo en los primeros minutos multiplica la conversión.</p>
    <p><b>Dueño:</b> ${owner}<br><b>Email:</b> <a href="mailto:${email}">${email}</a><br><b>Teléfono:</b> ${phone}<br><b>Plan elegido:</b> ${plan}</p>
    <p>${whatsapp}</p>
    <p style="font-size:14px"><a href="${esc(pipelineUrl)}">Ver en el pipeline de ventas</a></p>
  </div>`
  return { subject: `[Ventas] Hotel nuevo — ${input.hotelName}`, html }
}
