// settings-email.ts — Lógica pura (sin Vue) de la pestaña Email de /admin/settings (#100).
//
// Validación del destino de la prueba de correo y armado del mensaje de resultado. Vive
// aparte del .vue para poder testearse sin montar el componente.

/** Misma regex que valida el backend en POST /admin/email/test: si acá pasa, allá también. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** ¿Es un email con forma válida? (trim incluido) */
function esEmail(v: string): boolean {
  return EMAIL_RE.test(String(v ?? '').trim())
}

/**
 * Valida el destino de la prueba. Devuelve el mensaje de error en español para mostrar
 * inline, o null si es válido. Con error NO se llama al backend.
 */
export function validarDestinoPrueba(to: string): string | null {
  const v = String(to ?? '').trim()
  if (!v) return 'Cargá un email de destino para la prueba'
  if (!esEmail(v)) return 'El destino no es un email válido'
  return null
}

/**
 * Destino por defecto de la prueba: el email de soporte si es válido; si no, el remitente
 * SMTP si es válido; si no, vacío (el usuario lo completa a mano).
 */
export function destinoPruebaPorDefecto(supportEmail: string, fromEmail: string): string {
  const soporte = String(supportEmail ?? '').trim()
  if (esEmail(soporte)) return soporte
  const remitente = String(fromEmail ?? '').trim()
  if (esEmail(remitente)) return remitente
  return ''
}

/** Texto del resultado exitoso: deja claro por qué vía salió (smtp o resend). */
export function mensajeResultadoPrueba(provider: string, to: string): string {
  return `Enviado vía ${provider} a ${to}`
}
