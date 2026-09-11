// captcha.ts — La barrera anti-robots del alta pública, configurable desde el panel.
//
// El alta es la única puerta abierta que escribe en la base. El rate-limit por IP frena la fuerza
// bruta desde una máquina, pero no a un bot distribuido creando hoteles basura: cada alta escribe
// hotel + usuario + roles + suscripción, así que un ataque ensucia la base y falsea las métricas.
//
// Antes esto era Turnstile y sólo Turnstile, cableado a dos variables de entorno. El problema no
// era el proveedor sino el camino: la site key viajaba como `VITE_TURNSTILE_SITE_KEY`, que es una
// variable de BUILD — activar el captcha exigía entrar al servidor, editar dos .env y recompilar el
// frontend. Con esto se prende, se apaga y se cambia de proveedor desde Configuración, sin deploy.
//
// Orden de precedencia, igual que `meta-app-config.ts`: **el entorno GANA**. Si hay
// `TURNSTILE_SECRET` en el servidor se usa ese, aunque el panel tenga otra cosa cargada. Quien
// tiene SSH no puede ser sobreescrito desde un navegador.

import { encryptCredentials, decryptCredentials, isEncryptionConfigured, maskSecret } from '../services/payment-gateway/crypto'

const CLAVE = 'captcha'
const HOTEL_PLATAFORMA = 'platform'

/** Si la verificación del proveedor no responde en este tiempo, se corta. */
const TIMEOUT_MS = 8000

export const CAPTCHA_PROVIDERS = ['turnstile', 'recaptcha', 'hcaptcha'] as const
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number]

/**
 * Lo que cambia entre un proveedor y otro. Los tres resuelven el mismo problema con la misma forma
 * (widget que produce un token + endpoint que lo valida contra un secreto), así que sostener los
 * tres cuesta esta tabla y nada más.
 *
 * `scriptUrl` y `globalName` los consume el frontend: se publican en `publicCaptchaConfig()` para
 * que la página de registro no tenga que conocer a cada proveedor.
 */
export const CAPTCHA_PROVIDER_META: Record<CaptchaProvider, {
  label: string
  verifyUrl: string
  scriptUrl: string
  /** Objeto que el script deja en `window` y que expone `.render()`. */
  globalName: string
  docsUrl: string
  hint: string
}> = {
  turnstile: {
    label: 'Cloudflare Turnstile',
    verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    scriptUrl: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    globalName: 'turnstile',
    docsUrl: 'https://dash.cloudflare.com/?to=/:account/turnstile',
    hint: 'Gratis y sin límite de verificaciones. No perfila al visitante.',
  },
  recaptcha: {
    label: 'Google reCAPTCHA v2',
    verifyUrl: 'https://www.google.com/recaptcha/api/siteverify',
    scriptUrl: 'https://www.google.com/recaptcha/api.js?render=explicit',
    globalName: 'grecaptcha',
    docsUrl: 'https://www.google.com/recaptcha/admin/create',
    hint: 'El más conocido. Usá el tipo "v2 — No soy un robot".',
  },
  hcaptcha: {
    label: 'hCaptcha',
    verifyUrl: 'https://api.hcaptcha.com/siteverify',
    scriptUrl: 'https://js.hcaptcha.com/1/api.js?render=explicit',
    globalName: 'hcaptcha',
    docsUrl: 'https://dashboard.hcaptcha.com/signup',
    hint: 'Alternativa centrada en privacidad, compatible con la API de Google.',
  },
}

export function isCaptchaProvider(v: unknown): v is CaptchaProvider {
  return typeof v === 'string' && (CAPTCHA_PROVIDERS as readonly string[]).includes(v)
}

export interface CaptchaConfig {
  /** `false` ⇒ el alta NO pide token. Ver `estadoCaptcha` para saber por qué está apagado. */
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  secret: string
  origin: 'entorno' | 'panel' | null
}

const APAGADO: CaptchaConfig = { enabled: false, provider: 'turnstile', siteKey: '', secret: '', origin: null }

async function leerConfig(configRepo: any): Promise<Record<string, unknown> | null> {
  try {
    const filas = await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key: CLAVE })
    const cruda = filas[0]?.value
    if (!cruda) return null
    const parsed = typeof cruda === 'string' ? JSON.parse(cruda) : cruda
    if (!parsed || typeof parsed !== 'object') return null
    // El secreto viaja cifrado en `enc`; lo demás (activo, proveedor, site key) es público y va
    // en claro para poder leerlo aunque el cifrado no esté configurado.
    const secretos = parsed.enc ? decryptCredentials(String(parsed.enc)) : {}
    return { ...parsed, ...secretos }
  } catch {
    return null
  }
}

/**
 * Configuración efectiva: entorno primero, panel después.
 *
 * Sin secreto NO hay captcha, venga de donde venga: es deliberado para poder levantar en local y
 * desplegar antes de tener claves. El precio es que apagarlo es indistinguible a simple vista de
 * tenerlo prendido, así que el arranque lo avisa por log y la pantalla de Configuración lo muestra.
 */
export async function resolveCaptchaConfig(configRepo: any): Promise<CaptchaConfig> {
  const delEntorno = process.env.TURNSTILE_SECRET
  if (delEntorno) {
    return {
      enabled: true,
      provider: 'turnstile',
      siteKey: process.env.TURNSTILE_SITE_KEY || process.env.VITE_TURNSTILE_SITE_KEY || '',
      secret: delEntorno,
      origin: 'entorno',
    }
  }

  const guardado = await leerConfig(configRepo)
  if (!guardado) return { ...APAGADO }

  const provider = isCaptchaProvider(guardado.provider) ? guardado.provider : 'turnstile'
  const secret = typeof guardado.secret === 'string' ? guardado.secret : ''
  const siteKey = typeof guardado.siteKey === 'string' ? guardado.siteKey : ''
  // El interruptor del panel apaga sin borrar las claves: volver a prenderlo no obliga a
  // recargarlas. Sin secreto o sin site key no hay nada que exigir, esté como esté el interruptor.
  const enabled = guardado.enabled === true && !!secret && !!siteKey

  return { enabled, provider, siteKey, secret, origin: enabled ? 'panel' : null }
}

export interface CaptchaResult {
  ok: boolean
  /** Motivo para el log. No se le muestra al visitante. */
  reason?: string
}

/**
 * Valida el token contra el proveedor configurado. Devuelve `ok:false` en vez de tirar: para quien
 * intenta registrarse, un captcha inválido es un error de formulario, no una caída del servidor.
 *
 * Los tres proveedores comparten el mismo contrato de verificación (`POST` con `secret` +
 * `response`, respuesta `{success, "error-codes"}`), que es lo que permite una sola función.
 *
 * `remoteIp` es opcional pero recomendado: los tres lo usan para puntuar.
 */
export async function verifyCaptcha(cfg: CaptchaConfig, token: string, remoteIp?: string): Promise<CaptchaResult> {
  if (!cfg.enabled || !cfg.secret) return { ok: true, reason: 'captcha deshabilitado' }
  if (!token) return { ok: false, reason: 'token vacío' }

  const body = new URLSearchParams({ secret: cfg.secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  // AbortController y no confiar en el timeout del runtime: sin esto, una demora del proveedor
  // cuelga el request del alta hasta que el cliente corta.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(CAPTCHA_PROVIDER_META[cfg.provider].verifyUrl, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, reason: `siteverify HTTP ${res.status}` }
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }
    return { ok: false, reason: (data['error-codes'] ?? ['sin detalle']).join(',') }
  } catch (err) {
    // Proveedor caído o timeout. Se RECHAZA en vez de dejar pasar: si el captcha está activado es
    // porque el alta necesita esa barrera, y abrirla ante un fallo de red la vuelve inútil justo
    // cuando hay un ataque.
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : String((err as Error)?.message ?? err)
    return { ok: false, reason: `siteverify inaccesible: ${reason}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Lo que necesita la PÁGINA DE REGISTRO. Público a propósito; jamás incluye el secreto. */
export interface PublicCaptchaConfig {
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  scriptUrl: string
  globalName: string
}

export async function publicCaptchaConfig(configRepo: any): Promise<PublicCaptchaConfig> {
  const cfg = await resolveCaptchaConfig(configRepo)
  const meta = CAPTCHA_PROVIDER_META[cfg.provider]
  // Con el captcha prendido pero sin site key el widget no puede dibujarse; se informa apagado
  // para que el registro no quede con un hueco donde debería haber una casilla.
  const usable = cfg.enabled && !!cfg.siteKey
  return {
    enabled: usable,
    provider: cfg.provider,
    siteKey: usable ? cfg.siteKey : '',
    scriptUrl: meta.scriptUrl,
    globalName: meta.globalName,
  }
}

/** Lo que ve el super-admin en Configuración. NUNCA incluye el secreto en claro. */
export interface EstadoCaptcha {
  enabled: boolean
  provider: CaptchaProvider
  siteKey: string
  /** ¿Hay secreto cargado, venga de donde venga? */
  configurado: boolean
  origen: 'entorno' | 'panel' | null
  /** Últimos caracteres del secreto, para reconocer cuál está puesto sin revelarlo. */
  pista: string | null
  /** Sin clave de cifrado esta pantalla no puede guardar el secreto. */
  puedeGuardar: boolean
  /** Catálogo para el desplegable: no se duplica la lista en el frontend. */
  proveedores: Array<{ value: CaptchaProvider; label: string; docsUrl: string; hint: string }>
}

const CATALOGO = CAPTCHA_PROVIDERS.map((value) => ({
  value,
  label: CAPTCHA_PROVIDER_META[value].label,
  docsUrl: CAPTCHA_PROVIDER_META[value].docsUrl,
  hint: CAPTCHA_PROVIDER_META[value].hint,
}))

/** Estado para la pantalla. No cachea: tras un cambio no puede mentir. */
export async function estadoCaptcha(configRepo: any): Promise<EstadoCaptcha> {
  const delEntorno = process.env.TURNSTILE_SECRET
  const guardado = delEntorno ? null : await leerConfig(configRepo)
  const secreto = delEntorno || (typeof guardado?.secret === 'string' ? guardado.secret : '')
  const provider = delEntorno ? 'turnstile' : (isCaptchaProvider(guardado?.provider) ? guardado.provider : 'turnstile')

  return {
    enabled: delEntorno ? true : guardado?.enabled === true,
    provider,
    siteKey: delEntorno
      ? (process.env.TURNSTILE_SITE_KEY || process.env.VITE_TURNSTILE_SITE_KEY || '')
      : String(guardado?.siteKey ?? ''),
    configurado: !!secreto,
    origen: delEntorno ? 'entorno' : secreto ? 'panel' : null,
    pista: secreto ? maskSecret(secreto) : null,
    // Con el secreto en el entorno la pantalla es de sólo lectura: no puede pisar lo del servidor.
    puedeGuardar: !delEntorno && isEncryptionConfigured(),
    proveedores: CATALOGO,
  }
}

export interface GuardarCaptchaInput {
  enabled?: boolean
  provider?: string
  siteKey?: string
  /** Vacío = se conserva el ya guardado (la pantalla nunca muestra el secreto). */
  secret?: string
}

/**
 * Guarda la configuración; el secreto va cifrado.
 *
 * Se niega a guardar en claro: un dump de `configuration` entregaría la llave que valida el
 * captcha de la plataforma. Misma disciplina que `meta-app-config.ts`.
 */
export async function guardarCaptcha(configRepo: any, datos: GuardarCaptchaInput): Promise<EstadoCaptcha> {
  if (process.env.TURNSTILE_SECRET) {
    throw new Error('El captcha está configurado por variables de entorno en el servidor: esta pantalla no puede pisarlo.')
  }
  if (!isEncryptionConfigured()) {
    throw new Error('Falta PAYMENTS_ENCRYPTION_KEY en el servidor: no se puede guardar el secreto cifrado.')
  }

  const previo = (await leerConfig(configRepo)) ?? {}
  const provider = isCaptchaProvider(datos.provider) ? datos.provider : (isCaptchaProvider(previo.provider) ? previo.provider : 'turnstile')
  const siteKey = (datos.siteKey ?? String(previo.siteKey ?? '')).trim()
  // Secreto vacío = no se toca el guardado. Es lo que permite cambiar de proveedor o apagar el
  // captcha sin tener que ir a buscar la clave de nuevo.
  const secret = (datos.secret ?? '').trim() || String(previo.secret ?? '')
  const enabled = datos.enabled ?? previo.enabled === true

  // Prender sin claves dejaría el registro pidiendo un captcha que no se puede dibujar: se avisa
  // acá en vez de romper el alta pública.
  if (enabled && (!siteKey || !secret)) {
    throw new Error('Para activar el captcha hacen falta la clave pública (site key) y la clave secreta.')
  }

  const value = JSON.stringify({
    enabled,
    provider,
    siteKey,
    ...(secret ? { enc: encryptCredentials({ secret }) } : {}),
  })

  const filas = await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key: CLAVE })
  if (filas[0]) await configRepo.update(filas[0].id, { value })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: HOTEL_PLATAFORMA, key: CLAVE, value })

  return estadoCaptcha(configRepo)
}
