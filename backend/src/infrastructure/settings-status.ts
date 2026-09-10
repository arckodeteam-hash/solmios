// infrastructure/settings-status.ts — Estado (solo lectura) de los servicios de plataforma.
//
// Le dice al super_admin qué está configurado y de dónde sale (entorno o panel), sin devolver
// jamás un valor ni una pista: acá no viajan últimos 4, ni máscaras, ni longitudes. Solo
// `configured` + `source`. Quien necesita ver la pista tiene las pantallas específicas.
//
// Cada entrada reusa el MISMO criterio que el código que consume el servicio (captcha, Meta,
// Resend, SMTP, Maps, Channex): si el criterio divergiera, la pantalla diría "configurado" y
// el servicio fallaría, o al revés.

import { isCaptchaEnabled } from './captcha'
import { estadoMetaApp } from './meta-app-config'
import { estadoResend } from './resend-config'
import { normalizeSmtpConfig } from '../services/email-service'

const HOTEL_PLATAFORMA = 'platform'

export type ServicioClave =
  | 'stripe'
  | 'stripeWebhook'
  | 'turnstile'
  | 'publicUrl'
  | 'metaApp'
  | 'resend'
  | 'smtp'
  | 'googleMaps'
  | 'channex'

/** `source` null ⇔ `configured` false. NUNCA lleva el valor ni parte de él. */
export interface EstadoServicio {
  configured: boolean
  source: 'env' | 'configuration' | null
}

export type EstadoServicios = Record<ServicioClave, EstadoServicio>

const NO: EstadoServicio = { configured: false, source: null }
const ENV: EstadoServicio = { configured: true, source: 'env' }
const PANEL: EstadoServicio = { configured: true, source: 'configuration' }

/** Lee la primera fila `configuration(platform, key)` y la parsea con la tolerancia string/JSON del repo. */
async function leerPlataforma(configRepo: any, key: string): Promise<Record<string, unknown> | null> {
  try {
    const filas = (await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key })) as any[]
    const cruda = filas?.[0]?.value
    if (!cruda) return null
    const parsed = typeof cruda === 'string' ? JSON.parse(cruda) : cruda
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function hayString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/** Mismo criterio que `EmailService.resolveSmtpConfig` (platform, keys `email_config` y `smtp`). */
async function estadoSmtp(configRepo: any): Promise<EstadoServicio> {
  for (const key of ['email_config', 'smtp']) {
    if (normalizeSmtpConfig(await leerPlataforma(configRepo, key))) return PANEL
  }
  return NO
}

/** Mismo criterio que `resolveGoogleMapsKey` en public-hotel-info: `{apiKey}` no vacío. */
async function estadoGoogleMaps(configRepo: any): Promise<EstadoServicio> {
  const cfg = await leerPlataforma(configRepo, 'google_maps')
  return hayString(cfg?.apiKey) ? PANEL : NO
}

/**
 * Misma fuente que `GET /api/admin/channex-config` (`configuration(platform, 'channex').apiKey`).
 * En Channex el panel GANA sobre `CHANNEX_API_KEY` (ver `ChannexUseCase.platform`), así que se
 * reporta en ese orden para no decir "env" cuando lo que se usa es lo del panel.
 */
async function estadoChannex(configRepo: any): Promise<EstadoServicio> {
  const cfg = await leerPlataforma(configRepo, 'channex')
  if (hayString(cfg?.apiKey)) return PANEL
  return process.env.CHANNEX_API_KEY ? ENV : NO
}

/** Estado para la pantalla. Se llama en cada carga: no cachea, para no mentir tras un cambio. */
export async function estadoServicios(configRepo: any): Promise<EstadoServicios> {
  const [meta, resend, smtp, googleMaps, channex] = await Promise.all([
    estadoMetaApp(configRepo),
    estadoResend(configRepo),
    estadoSmtp(configRepo),
    estadoGoogleMaps(configRepo),
    estadoChannex(configRepo),
  ])

  return {
    // Stripe de PLATAFORMA (suscripciones SaaS: create-checkout-session, upgrade-plan,
    // handle-stripe-event) llama `StripeService.getConfig()` SIN hotelId, y sin hotelId
    // `stripe-service.ts` cae directo a `envConfig()` = solo STRIPE_SECRET_KEY. La fila
    // `configuration.stripe_config` es legacy POR HOTEL y nunca se consulta acá: mirarla sería un falso positivo.
    stripe: process.env.STRIPE_SECRET_KEY ? ENV : NO,
    stripeWebhook: process.env.STRIPE_WEBHOOK_SECRET_PLATFORM ? ENV : NO,
    turnstile: isCaptchaEnabled() ? ENV : NO,
    publicUrl: process.env.PUBLIC_URL ? ENV : NO,
    metaApp: meta.origen === 'entorno' ? ENV : meta.origen === 'panel' ? PANEL : NO,
    resend: resend.configured ? PANEL : NO,
    smtp,
    googleMaps,
    channex,
  }
}
