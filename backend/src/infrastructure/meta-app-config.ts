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
}

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

/** Estado para la pantalla. Se llama en cada carga: no cachea, para no mentir tras un cambio. */
export async function estadoMetaApp(configRepo: any): Promise<EstadoMetaApp> {
  const delEntorno = process.env.META_APP_SECRET
  const guardado = delEntorno ? null : await leerConfig(configRepo)
  const secreto = delEntorno || (typeof guardado?.appSecret === 'string' ? guardado.appSecret : '')

  return {
    appId: String(guardado?.appId || process.env.META_APP_ID || APP_ID_POR_DEFECTO),
    graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
    configurado: !!secreto,
    origen: delEntorno ? 'entorno' : secreto ? 'panel' : null,
    pista: secreto ? maskSecret(secreto) : null,
    puedeGuardar: isEncryptionConfigured(),
  }
}

/**
 * Guarda el secreto cifrado.
 *
 * Se niega a guardar en claro: sin `PAYMENTS_ENCRYPTION_KEY` un dump de la tabla entregaría la
 * llave que firma los webhooks de todos los hoteles.
 */
export async function guardarMetaApp(
  configRepo: any,
  datos: { appId?: string; appSecret: string },
): Promise<EstadoMetaApp> {
  if (!isEncryptionConfigured()) {
    throw new Error('Falta PAYMENTS_ENCRYPTION_KEY en el servidor: no se puede guardar el secreto cifrado.')
  }
  const appSecret = String(datos.appSecret || '').trim()
  if (appSecret.length < 16) {
    throw new Error('Ese no parece el secreto de la app: es demasiado corto.')
  }

  const value = JSON.stringify({
    enc: encryptCredentials({ appId: datos.appId || APP_ID_POR_DEFECTO, appSecret }),
  })

  const filas = await configRepo.findMany({ hotelId: HOTEL_PLATAFORMA, key: CLAVE })
  if (filas[0]) await configRepo.update(filas[0].id, { value })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: HOTEL_PLATAFORMA, key: CLAVE, value })

  return estadoMetaApp(configRepo)
}
