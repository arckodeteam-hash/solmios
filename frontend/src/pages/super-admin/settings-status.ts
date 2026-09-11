// settings-status.ts — Lógica pura (sin Vue) de "Protección del alta" y "Estado por servicio"
// en /admin/settings (#102).
//
// Convierte `GET /api/admin/settings/status` en filas listas para pintar. Los nombres de las
// variables de entorno y los lugares donde se setea cada cosa viven ACÁ, no en el JSON del
// backend: ese endpoint no devuelve ningún string de más de 20 caracteres (así se garantiza
// que no filtra secretos), y la ayuda al operador ("qué falta y dónde") no necesita viajar.
// Vive aparte del .vue para poder testearse sin montar el componente.

import type { ServicioClave, ServicioEstado, SettingsStatus } from '../../services/Platform.service'

export interface FilaProteccion {
  clave: 'captcha' | 'verificacionEmail' | 'rateLimit'
  nombre: string
  activo: boolean
  detalle: string
}

export interface FilaIntegracion {
  clave: ServicioClave
  nombre: string
  configurado: boolean
  detalle: string
}

const DESCONOCIDO_PROTECCION = 'estado desconocido — no se pudo leer `/api/admin/settings/status`'
const DESCONOCIDO_INTEGRACION = 'estado desconocido'

/**
 * Texto cuando el captcha está apagado.
 *
 * Ya no manda a editar variables de entorno: desde #12 se prende en la tarjeta de arriba, y decir
 * "cargá TURNSTILE_SECRET" mandaba al super-admin al servidor para algo que puede hacer acá.
 */
export const CAPTCHA_DESACTIVADO =
  'desactivado — se activa en la tarjeta «Captcha del registro», acá arriba'

/**
 * Tres filas de solo lectura: captcha, verificación de email y rate-limit. Ninguna se
 * togglea desde el panel — son variables del servidor o código — por eso no hay switches.
 */
export function filasProteccionAlta(s: SettingsStatus | null): FilaProteccion[] {
  if (!s) {
    return [
      { clave: 'captcha', nombre: 'Captcha', activo: false, detalle: DESCONOCIDO_PROTECCION },
      { clave: 'verificacionEmail', nombre: 'Verificación de email', activo: false, detalle: DESCONOCIDO_PROTECCION },
      { clave: 'rateLimit', nombre: 'Rate-limit', activo: false, detalle: DESCONOCIDO_PROTECCION },
    ]
  }
  const captcha = !!s.turnstile?.configured
  const verificacion = !!s.publicUrl?.configured
  return [
    {
      clave: 'captcha',
      nombre: 'Captcha',
      activo: captcha,
      // El origen importa: con el secreto en el servidor la tarjeta de arriba no puede tocarlo, y
      // decir "activo" a secas dejaba al admin buscando el interruptor que no existe. Nombrar
      // siempre a Turnstile era directamente falso desde que se puede elegir proveedor (#12).
      detalle: captcha
        ? (s.turnstile?.source === 'env'
          ? 'activo — configurado en el servidor (`TURNSTILE_SECRET`), no se cambia desde el panel'
          : 'activo — configurado desde el panel, en la tarjeta de acá arriba')
        : CAPTCHA_DESACTIVADO,
    },
    {
      clave: 'verificacionEmail',
      nombre: 'Verificación de email',
      activo: verificacion,
      detalle: verificacion
        ? 'correo de verificación cableado (`PUBLIC_URL` presente) — el alta entra sin verificar y solo avisa'
        : 'sin enlace de verificación — `PUBLIC_URL` en `backend/.env`',
    },
    {
      // Es código, no configuración: siempre corre.
      clave: 'rateLimit',
      nombre: 'Rate-limit',
      activo: true,
      detalle: 'activo — por IP, en memoria del proceso; con `REDIS_URL` se comparte entre workers',
    },
  ]
}

/** Orden fijo de la lista y, por cada servicio, nombre legible + dónde se setea si falta. */
const INTEGRACIONES: ReadonlyArray<{ clave: ServicioClave; nombre: string; falta: string }> = [
  { clave: 'stripe', nombre: 'Stripe (plataforma)', falta: '`STRIPE_SECRET_KEY`' },
  { clave: 'stripeWebhook', nombre: 'Webhook de Stripe', falta: '`STRIPE_WEBHOOK_SECRET_PLATFORM`' },
  { clave: 'turnstile', nombre: 'Captcha Turnstile', falta: '`TURNSTILE_SECRET`' },
  { clave: 'publicUrl', nombre: 'URL pública', falta: '`PUBLIC_URL`' },
  { clave: 'metaApp', nombre: 'App de Meta / WhatsApp', falta: '`META_APP_SECRET` o la tarjeta Meta de esta pestaña' },
  { clave: 'resend', nombre: 'Resend', falta: 'API key en la pestaña Correo' },
  { clave: 'smtp', nombre: 'SMTP', falta: 'SMTP en la pestaña Correo' },
  { clave: 'googleMaps', nombre: 'Google Maps', falta: 'clave en la tarjeta Google Maps' },
  { clave: 'channex', nombre: 'Channex', falta: '`CHANNEX_API_KEY` o la tarjeta Channex' },
]

function detalleIntegracion(e: ServicioEstado | undefined, falta: string): string {
  if (e?.configured) {
    return e.source === 'configuration' ? 'Configurado — desde el panel' : 'Configurado — en el servidor'
  }
  return `Falta — ${falta}`
}

/** Nueve filas Configurado / Falta, siempre en el mismo orden. */
export function filasIntegraciones(s: SettingsStatus | null): FilaIntegracion[] {
  return INTEGRACIONES.map(({ clave, nombre, falta }) => {
    if (!s) return { clave, nombre, configurado: false, detalle: DESCONOCIDO_INTEGRACION }
    const e = s[clave]
    return { clave, nombre, configurado: !!e?.configured, detalle: detalleIntegracion(e, falta) }
  })
}
