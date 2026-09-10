// settings-status.test.ts — Filas de "Protección del alta" y "Estado por servicio" (#102).
import { describe, it, expect } from 'vitest'
import { filasProteccionAlta, filasIntegraciones, CAPTCHA_DESACTIVADO } from './settings-status'
import type { SettingsStatus, ServicioEstado } from '../../services/Platform.service'

const NO: ServicioEstado = { configured: false, source: null }
const ENV: ServicioEstado = { configured: true, source: 'env' }
const PANEL: ServicioEstado = { configured: true, source: 'configuration' }

const ORDEN = ['stripe', 'stripeWebhook', 'turnstile', 'publicUrl', 'metaApp', 'resend', 'smtp', 'googleMaps', 'channex'] as const

function status(over: Partial<SettingsStatus> = {}): SettingsStatus {
  const base = Object.fromEntries(ORDEN.map((k) => [k, NO])) as SettingsStatus
  return { ...base, ...over }
}

describe('filasProteccionAlta', () => {
  it('sin turnstile la fila captcha dice exactamente el texto de aceptación', () => {
    const captcha = filasProteccionAlta(status())[0]
    expect(captcha.clave).toBe('captcha')
    expect(captcha.activo).toBe(false)
    expect(captcha.detalle).toBe('desactivado — `TURNSTILE_SECRET` en `backend/.env` + `VITE_TURNSTILE_SITE_KEY` en el build')
    expect(CAPTCHA_DESACTIVADO).toBe(captcha.detalle)
  })

  it('con turnstile la fila captcha está activa y nombra Turnstile', () => {
    const captcha = filasProteccionAlta(status({ turnstile: ENV }))[0]
    expect(captcha.activo).toBe(true)
    expect(captcha.detalle).toContain('Cloudflare Turnstile')
  })

  it('publicUrl presente → verificación de email activa; ausente → apagada con la variable', () => {
    const con = filasProteccionAlta(status({ publicUrl: ENV }))[1]
    expect(con.clave).toBe('verificacionEmail')
    expect(con.activo).toBe(true)
    expect(con.detalle).toContain('`PUBLIC_URL` presente')

    const sin = filasProteccionAlta(status())[1]
    expect(sin.activo).toBe(false)
    expect(sin.detalle).toBe('sin enlace de verificación — `PUBLIC_URL` en `backend/.env`')
  })

  it('rate-limit siempre activo (es código, no configuración)', () => {
    const fila = filasProteccionAlta(status())[2]
    expect(fila.clave).toBe('rateLimit')
    expect(fila.activo).toBe(true)
    expect(fila.detalle).toContain('REDIS_URL')
  })

  it('null (no se pudo leer) → 3 filas apagadas con estado desconocido', () => {
    const filas = filasProteccionAlta(null)
    expect(filas).toHaveLength(3)
    for (const f of filas) {
      expect(f.activo).toBe(false)
      expect(f.detalle).toBe('estado desconocido — no se pudo leer `/api/admin/settings/status`')
    }
  })
})

describe('filasIntegraciones', () => {
  it('devuelve 9 filas en el orden fijo', () => {
    const filas = filasIntegraciones(status())
    expect(filas).toHaveLength(9)
    expect(filas.map((f) => f.clave)).toEqual([...ORDEN])
    expect(filas.map((f) => f.nombre)).toEqual([
      'Stripe (plataforma)', 'Webhook de Stripe', 'Captcha Turnstile', 'URL pública',
      'App de Meta / WhatsApp', 'Resend', 'SMTP', 'Google Maps', 'Channex',
    ])
  })

  it('sin stripe la fila dice Falta con la variable', () => {
    const stripe = filasIntegraciones(status())[0]
    expect(stripe.configurado).toBe(false)
    expect(stripe.detalle).toBe('Falta — `STRIPE_SECRET_KEY`')
  })

  it('stripe source env → en el servidor; configuration → desde el panel', () => {
    expect(filasIntegraciones(status({ stripe: ENV }))[0].detalle).toBe('Configurado — en el servidor')
    expect(filasIntegraciones(status({ stripe: PANEL }))[0].detalle).toBe('Configurado — desde el panel')
    expect(filasIntegraciones(status({ stripe: PANEL }))[0].configurado).toBe(true)
  })

  it('cada faltante apunta a la variable o al lugar donde se setea', () => {
    const detalles = Object.fromEntries(filasIntegraciones(status()).map((f) => [f.clave, f.detalle]))
    expect(detalles.stripeWebhook).toBe('Falta — `STRIPE_WEBHOOK_SECRET_PLATFORM`')
    expect(detalles.turnstile).toBe('Falta — `TURNSTILE_SECRET`')
    expect(detalles.publicUrl).toBe('Falta — `PUBLIC_URL`')
    expect(detalles.metaApp).toBe('Falta — `META_APP_SECRET` o la tarjeta Meta de esta pestaña')
    expect(detalles.resend).toBe('Falta — API key en la pestaña Correo')
    expect(detalles.smtp).toBe('Falta — SMTP en la pestaña Correo')
    expect(detalles.googleMaps).toBe('Falta — clave en la tarjeta Google Maps')
    expect(detalles.channex).toBe('Falta — `CHANNEX_API_KEY` o la tarjeta Channex')
  })

  it('null → 9 filas, todas sin configurar con estado desconocido', () => {
    const filas = filasIntegraciones(null)
    expect(filas).toHaveLength(9)
    for (const f of filas) {
      expect(f.configurado).toBe(false)
      expect(f.detalle).toBe('estado desconocido')
    }
  })
})
