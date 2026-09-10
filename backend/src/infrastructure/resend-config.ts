// infrastructure/resend-config.ts — La API key de Resend, a nivel plataforma.
//
// Resend es el respaldo de correo cuando no hay SMTP: `EmailService.resolveResendKey` la lee de
// `configuration` (hotelId 'platform', key 'resend_api_key') y la usa TAL CUAL, sin descifrar.
// Por eso acá se guarda como string plano y no cifrada como el secreto de Meta: cifrarla rompería
// el envío sin que nadie se entere hasta el primer correo que no llega.
//
// Lo que sale hacia el navegador es solo el estado (¿hay key? ¿cuáles son sus últimos 4?). La key
// completa NUNCA se devuelve: quien la cargó ya la tiene, y quien no, no la necesita para saber
// cuál está puesta.

import { ValidationError } from 'arckode-framework'

const CLAVE = 'resend_api_key'
const HOTEL_PLATAFORMA = 'platform'

/** Lo que se le muestra al super_admin. NUNCA incluye la key. */
export interface EstadoResend {
  configured: boolean
  /** Últimos 4 caracteres, para reconocer cuál está puesta sin revelarla. */
  last4: string | null
}

/**
 * Extrae la key de lo que haya en la fila, con la MISMA tolerancia que `resolveResendKey`:
 * string plano (lo que guarda esta pantalla) o `{ key }` / `{ api_key }` (formas viejas).
 * Si el criterio de lectura divergiera, la pantalla diría "configurada" y el envío fallaría.
 */
function extraerKey(cruda: unknown): string | null {
  let key: unknown = cruda
  if (cruda && typeof cruda === 'object') {
    const obj = cruda as { key?: unknown; api_key?: unknown }
    key = obj.key ?? obj.api_key
  }
  return typeof key === 'string' && key.trim() ? key.trim() : null
}

async function leerFilas(configRepo: any): Promise<any[]> {
  return (await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key: CLAVE })) as any[]
}

/** Estado para la pantalla. Se llama en cada carga: no cachea, para no mentir tras un cambio. */
export async function estadoResend(configRepo: any): Promise<EstadoResend> {
  const filas = await leerFilas(configRepo)
  const key = extraerKey(filas[0]?.value)
  return { configured: !!key, last4: key ? key.slice(-4) : null }
}

/**
 * Guarda la key como string plano (ver cabecera: `resolveResendKey` no descifra).
 * Vacía → 400: un PUT sin key no es "borrar", para eso está `borrarResend`.
 */
export async function guardarResend(configRepo: any, apiKey: string): Promise<EstadoResend> {
  const value = String(apiKey ?? '').trim()
  if (!value) throw new ValidationError('La API key de Resend no puede estar vacía')

  const filas = await leerFilas(configRepo)
  if (filas[0]) await configRepo.update(filas[0].id, { value })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: HOTEL_PLATAFORMA, key: CLAVE, value })

  return estadoResend(configRepo)
}

/** Quita la key. Borra TODAS las filas con esa clave: si quedó duplicada, una sola dejaría la key viva. */
export async function borrarResend(configRepo: any): Promise<EstadoResend> {
  const filas = await leerFilas(configRepo)
  for (const fila of filas) await configRepo.delete(fila.id)
  return estadoResend(configRepo)
}
