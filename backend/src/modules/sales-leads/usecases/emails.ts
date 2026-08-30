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
