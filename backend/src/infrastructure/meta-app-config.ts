// infrastructure/meta-app-config.ts — Las credenciales de la APP de Meta, a nivel plataforma.
//
// Son distintas de las de cada hotel: el `app_secret` identifica a SOLMI OS ante Meta y firma los
// webhooks de TODOS los hoteles. Por eso vive acá y no en el panel de ningún hotel.
//
// Se puede cargar de dos formas y el orden importa:
//
//   1. Variables de entorno (`META_APP_SECRET`). Es lo preferible: solo lo toca quien entra al
//      servidor, y no queda en la base.
//   2. Esta pantalla, cifrado en `configuration`. Es el camino para quien no tiene SSH a mano.
//
// El entorno GANA siempre. Si alguien carga un secreto por la pantalla y en el servidor hay otro,
// el del servidor es el que se usa: de lo contrario un cambio desde el navegador podría romper la
// firma de los webhooks de todos los hoteles sin que nadie con acceso al servidor se entere.
//
// En la misma fila vive el TOKEN DE VERIFICACIÓN del webhook: la contraseña que Meta repite en el
// GET con el que da de alta la URL (`hub.verify_token`). Para ese la regla es la INVERSA — el panel
// gana y el entorno (`META_WEBHOOK_VERIFY_TOKEN`) queda de respaldo — porque no protege nada
// permanente: sólo decide si Meta acepta la URL en el momento del alta. Quien opera el panel de
// Meta es el que tiene que poder elegirlo, sin pedir un cambio de `.env` ni un reinicio.

import { ValidationError } from 'arckode-framework'
import { encryptCredentials, decryptCredentials, isEncryptionConfigured, maskSecret } from '../services/payment-gateway/crypto'

/** App pública de SOLMI OS. No es secreto: aparece en la URL del panel de Meta. */
export const APP_ID_POR_DEFECTO = '1727869705161184'
const CLAVE = 'meta_whatsapp'
const HOTEL_PLATAFORMA = 'platform'

export interface MetaAppCredentials {
  appId: string
  appSecret: string
  graphVersion?: string
}

/** Estado del token de verificación del webhook. NUNCA incluye el valor en claro. */
export interface EstadoTokenWebhook {
  configurado: boolean
  /** De dónde sale el que se está usando. Acá el PANEL gana sobre el entorno. */
  origen: 'entorno' | 'panel' | null
  pista: string | null
}

/** Lo que se le muestra al super_admin. NUNCA incluye el secreto en claro. */
export interface EstadoMetaApp {
  appId: string
  graphVersion: string
  /** ¿Hay secreto cargado, venga de donde venga? */
  configurado: boolean
  /** De dónde sale el que se está usando. */
  origen: 'entorno' | 'panel' | null
  /** Últimos caracteres, para reconocer cuál está puesto sin revelarlo. */
  pista: string | null
  /** Si el cifrado no está configurado, esta pantalla no puede guardar nada. */
  puedeGuardar: boolean
  /** URL que se pega en el panel de Meta como "Callback URL". Vacía si falta `PUBLIC_URL`. */
  webhookUrl: string
  webhookToken: EstadoTokenWebhook
}

/** Ruta canónica del webhook de WhatsApp (ver ai-recepcionista/index.ts). */
export const RUTA_WEBHOOK_WHATSAPP = '/api/ai/whatsapp/webhook'

async function leerConfig(configRepo: any): Promise<Record<string, unknown> | null> {
  const filas = await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key: CLAVE })
  const cruda = filas[0]?.value
  if (!cruda) return null
  try {
    const parsed = typeof cruda === 'string' ? JSON.parse(cruda) : cruda
    // Lo cifrado viene como { enc: 'v1:...' }; lo viejo o mal guardado se ignora en silencio.
    return parsed?.enc ? decryptCredentials(String(parsed.enc)) : null
  } catch {
    return null
  }
}

/**
 * Credenciales efectivas de la app: entorno primero, pantalla después.
 * `null` cuando no hay secreto en ninguno de los dos lados — el flujo de conexión responde 503.
 */
export async function resolverCredencialesApp(configRepo: any): Promise<MetaAppCredentials | null> {
  const delEntorno = process.env.META_APP_SECRET
  const graphVersion = process.env.META_GRAPH_VERSION || 'v26.0'

  if (delEntorno) {
    return { appId: process.env.META_APP_ID || APP_ID_POR_DEFECTO, appSecret: delEntorno, graphVersion }
  }

  const guardado = await leerConfig(configRepo)
  const secreto = typeof guardado?.appSecret === 'string' ? guardado.appSecret : ''
  if (!secreto) return null

  return {
    appId: String(guardado?.appId || process.env.META_APP_ID || APP_ID_POR_DEFECTO),
    appSecret: secreto,
    graphVersion,
  }
}

function tokenGuardado(guardado: Record<string, unknown> | null): string {
  return typeof guardado?.webhookVerifyToken === 'string' ? guardado.webhookVerifyToken : ''
}

/**
 * Token de verificación efectivo del webhook: panel primero, entorno después (ver cabecera).
 * `null` cuando no hay ninguno — el GET de alta de Meta responde 403.
 */
export async function resolverTokenVerificacionWebhook(configRepo: any): Promise<string | null> {
  const delPanel = tokenGuardado(await leerConfig(configRepo))
  return delPanel || process.env.META_WEBHOOK_VERIFY_TOKEN || null
}

function estadoTokenWebhook(guardado: Record<string, unknown> | null): EstadoTokenWebhook {
  const delPanel = tokenGuardado(guardado)
  const delEntorno = process.env.META_WEBHOOK_VERIFY_TOKEN || ''
  const efectivo = delPanel || delEntorno
  return {
    configurado: !!efectivo,
    origen: delPanel ? 'panel' : delEntorno ? 'entorno' : null,
    pista: efectivo ? maskSecret(efectivo) : null,
  }
}

/** Estado para la pantalla. Se llama en cada carga: no cachea, para no mentir tras un cambio. */
export async function estadoMetaApp(configRepo: any): Promise<EstadoMetaApp> {
  const delEntorno = process.env.META_APP_SECRET
  // La fila se lee siempre: aunque el secreto venga del servidor, el token del webhook puede
  // estar en el panel.
  const guardado = await leerConfig(configRepo)
  const secreto = delEntorno || (typeof guardado?.appSecret === 'string' ? guardado.appSecret : '')
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')

  return {
    appId: String(guardado?.appId || process.env.META_APP_ID || APP_ID_POR_DEFECTO),
    graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
    configurado: !!secreto,
    origen: delEntorno ? 'entorno' : secreto ? 'panel' : null,
    pista: secreto ? maskSecret(secreto) : null,
    puedeGuardar: isEncryptionConfigured(),
    webhookUrl: base ? `${base}${RUTA_WEBHOOK_WHATSAPP}` : '',
    webhookToken: estadoTokenWebhook(guardado),
  }
}

/**
 * Guarda el secreto y/o el token de verificación, cifrados en la misma fila.
 *
 * Cada campo que viene vacío CONSERVA lo que ya había: cambiar el token del webhook no puede
 * borrar el secreto de la app, ni al revés. Sin ninguno de los dos, no hay nada que guardar (400).
 *
 * Se niega a guardar en claro: sin `PAYMENTS_ENCRYPTION_KEY` un dump de la tabla entregaría la
 * llave que firma los webhooks de todos los hoteles.
 */
export async function guardarMetaApp(
  configRepo: any,
  datos: { appId?: string; appSecret?: string; webhookVerifyToken?: string },
): Promise<EstadoMetaApp> {
  if (!isEncryptionConfigured()) {
    throw new Error('Falta PAYMENTS_ENCRYPTION_KEY en el servidor: no se puede guardar el secreto cifrado.')
  }
  const appSecretNuevo = String(datos.appSecret || '').trim()
  const tokenNuevo = String(datos.webhookVerifyToken || '').trim()
  if (!appSecretNuevo && !tokenNuevo) {
    throw new ValidationError('No hay nada que guardar: cargá la clave secreta o el token de verificación.')
  }
  if (appSecretNuevo && appSecretNuevo.length < 16) {
    throw new ValidationError('Ese no parece el secreto de la app: es demasiado corto.')
  }
  if (tokenNuevo && tokenNuevo.length < 8) {
    throw new ValidationError('El token de verificación es demasiado corto: usá al menos 8 caracteres.')
  }

  const previo = await leerConfig(configRepo)
  const appSecret = appSecretNuevo || (typeof previo?.appSecret === 'string' ? previo.appSecret : '')
  const webhookVerifyToken = tokenNuevo || tokenGuardado(previo)

  const value = JSON.stringify({
    enc: encryptCredentials({
      appId: datos.appId || String(previo?.appId || '') || APP_ID_POR_DEFECTO,
      appSecret,
      webhookVerifyToken,
    }),
  })

  const filas = await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key: CLAVE })
  if (filas[0]) await configRepo.update(filas[0].id, { value })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: HOTEL_PLATAFORMA, key: CLAVE, value })

  return estadoMetaApp(configRepo)
}
