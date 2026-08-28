// deletion-requests/usecases/emails.ts — HTML de los 2 correos del flujo: acuse de recibo
// al solicitante (si dejó email) y aviso al admin (siempre, para no perder el plazo de 15 días).
const esc = (s: string): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildAckEmail(opts: { fullName: string; requestNumber: string }): { subject: string; html: string } {
  const name = esc(opts.fullName || 'Hola')
  const number = esc(opts.requestNumber)
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
    <h2 style="color:#0f172a">Recibimos tu solicitud de eliminación de datos</h2>
    <p>${name}, confirmamos que recibimos tu pedido de eliminación de datos personales de SOLMI OS.</p>
    <p style="margin:16px 0"><b>Número de solicitud:</b> <span style="font-family:monospace">${number}</span></p>
    <p>Vamos a verificar tu identidad y te confirmamos por escrito cuando esté completo. Todo el proceso toma como máximo 30 días naturales.</p>
    <p style="font-size:13px;color:#64748b">SOLMI OS, S.R.L. · privacidad@solmios.com</p>
  </div>`
  return { subject: `Solicitud de eliminación de datos recibida — ${opts.requestNumber}`, html }
}

export function buildAdminAlertEmail(opts: {
  requestNumber: string; fullName: string; contactHandle: string; hotelName: string | null
}): { subject: string; html: string } {
  const name = esc(opts.fullName)
  const contact = esc(opts.contactHandle)
  const hotel = opts.hotelName ? esc(opts.hotelName) : '<em>no indicado</em>'
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
    <h2 style="color:#0f172a">Nueva solicitud de eliminación de datos</h2>
    <p><b>N.º:</b> ${esc(opts.requestNumber)}</p>
    <p><b>Nombre:</b> ${name}<br><b>Contacto:</b> ${contact}<br><b>Hotel/establecimiento:</b> ${hotel}</p>
    <p style="font-size:14px">Verificar identidad y responder dentro de los 15 días hábiles. Gestioná el estado desde Panel › Eliminación de Datos.</p>
  </div>`
  return { subject: `[Eliminación de datos] Nueva solicitud ${opts.requestNumber}`, html }
}
