// ai-recepcionista/usecases/whatsapp-connection.ts — Conectar y desconectar el WhatsApp de un hotel.
//
// Es la implementación del lado servidor del Embedded Signup: la ventana de Meta le devuelve al
// navegador un CÓDIGO de un solo uso, y acá se canjea por el token permanente del negocio del hotel.
// El canje exige el `app_secret`, que vive solo en el entorno del servidor — por eso este paso no
// puede hacerse en el navegador (ver `exchangeCode`).

import { ValidationError, ConflictError } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import type {
  WhatsappCloudCredentials, MetaAppCredentials, MetaPhoneNumberInfo, MetaWabaInfo,
} from '../../../services/whatsapp-cloud-client'
import { explicarErrorDeConexion } from '../../../services/whatsapp-cloud-client'

/** Las operaciones de Meta que usa la conexión. Se inyectan para poder testear sin red. */
export interface ConnectionClient {
  exchangeCode(app: MetaAppCredentials, code: string): Promise<{ accessToken: string }>
  subscribeApp(creds: WhatsappCloudCredentials): Promise<void>
  unsubscribeApp(creds: WhatsappCloudCredentials): Promise<void>
  registerPhoneNumber(creds: WhatsappCloudCredentials, pin: string): Promise<boolean>
  getPhoneNumber(creds: WhatsappCloudCredentials): Promise<MetaPhoneNumberInfo>
  getWabaInfo(creds: WhatsappCloudCredentials): Promise<MetaWabaInfo>
}

export interface ConnectionDeps {
  configRepo: any
  client: ConnectionClient
  /** `null` cuando faltan META_APP_ID/META_APP_SECRET: es una falla de despliegue, no del hotel. */
  app: MetaAppCredentials | null
  logger: Logger
  /** PIN de dos pasos del número. Configurable por si el hotel ya tenía uno puesto. */
  registrationPin?: string
}

export interface ConnectInput {
  code: string
  phoneNumberId: string
  wabaId: string
}

/** PIN por defecto para activar el número, usado en la verificación en dos pasos de Meta. */
const DEFAULT_PIN = '000000'

/** Error de configuración del servidor, no del hotel: por eso 503 y no 400. */
class ServidorSinConfigurar extends ConflictError {
  readonly status = 503
}

function appOrFail(deps: ConnectionDeps): MetaAppCredentials {
  if (!deps.app) {
    throw new ServidorSinConfigurar(
      'La conexión con Meta no está configurada en este servidor. Avisale al equipo de SOLMI OS.',
    )
  }
  return deps.app
}

/**
 * Conecta el WhatsApp del hotel a partir del código que devolvió la ventana de Meta.
 *
 * Orden deliberado: primero se consigue el token y se comprueba que sirve (suscripción + lectura),
 * y RECIÉN ahí se escribe en la base. Si algo falla en el medio, la fila queda como estaba: un
 * hotel "conectado" con un token que no funciona es peor que uno sin conectar, porque nadie
 * sospecha del que se ve verde.
 */
export async function connectWhatsapp(
  deps: ConnectionDeps,
  input: ConnectInput,
  hotelId: string,
  userId?: string,
): Promise<Record<string, unknown>> {
  if (!input.code) throw new ValidationError('Falta el permiso de Meta. Volvé a pulsar "Conectar WhatsApp".')
  if (!input.wabaId || !input.phoneNumberId) {
    throw new ValidationError('Meta no devolvió la cuenta ni el número. Completá la ventana sin cerrarla antes de terminar.')
  }
  const app = appOrFail(deps)

  let creds: WhatsappCloudCredentials
  let phone: MetaPhoneNumberInfo
  let waba: MetaWabaInfo
  try {
    const { accessToken } = await deps.client.exchangeCode(app, input.code)
    creds = { wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, accessToken }

    // Sin la suscripción el hotel queda sordo: recibe el alta pero ningún mensaje del huésped.
    await deps.client.subscribeApp(creds)
    // Un número ya registrado devuelve false, no explota: pasa cuando el hotel reconecta.
    await deps.client.registerPhoneNumber(creds, deps.registrationPin || DEFAULT_PIN)

    phone = await deps.client.getPhoneNumber(creds)
    waba = await deps.client.getWabaInfo(creds)
  } catch (err) {
    const motivo = explicarErrorDeConexion(err)
    deps.logger.warn('Conexión de WhatsApp fallida', { hotelId, motivo })
    await guardarError(deps, hotelId, motivo)
    throw new ValidationError(motivo)
  }

  const now = new Date().toISOString()
  const datos = {
    connectionMode: 'meta',
    connectionStatus: 'connected',
    phoneNumberId: input.phoneNumberId,
    wabaId: input.wabaId,
    accessToken: creds.accessToken,
    isActive: 1,
    displayPhoneNumber: phone.displayPhoneNumber,
    verifiedName: phone.verifiedName,
    qualityRating: phone.qualityRating ?? '',
    messagingLimit: phone.messagingLimit ?? '',
    businessName: waba.name,
    accountReviewStatus: waba.accountReviewStatus ?? '',
    connectedAt: now,
    connectedByUserId: userId ?? '',
    connectionError: '',
  }

  const existente = (await deps.configRepo.findMany({ hotelId }))[0]
  if (existente) {
    await deps.configRepo.update(existente.id, datos)
  } else {
    await deps.configRepo.create({ id: crypto.randomUUID(), hotelId, ...datos })
  }
  deps.logger.info('WhatsApp conectado', { hotelId, wabaId: input.wabaId })
  return (await deps.configRepo.findMany({ hotelId }))[0]
}

/** Deja anotado el último error para que la tarjeta diga QUÉ pasó, no solo "no conectado". */
async function guardarError(deps: ConnectionDeps, hotelId: string, motivo: string): Promise<void> {
  try {
    const existente = (await deps.configRepo.findMany({ hotelId }))[0]
    if (existente) await deps.configRepo.update(existente.id, { connectionError: motivo })
  } catch {
    // Que no se pueda anotar el error no debe tapar el error original.
  }
}

/**
 * Da de baja la conexión.
 *
 * La suscripción se quita en Meta ANTES de limpiar lo local, y si Meta falla no se limpia nada: un
 * hotel "desconectado" acá pero suscripto allá seguiría recibiendo webhooks que ya nadie atiende, y
 * desde el panel no habría forma de reintentar la baja.
 *
 * `baileysCredentials` NO se toca: no es lo que se está dando de baja.
 */
export async function disconnectWhatsapp(deps: ConnectionDeps, hotelId: string): Promise<void> {
  const existente = (await deps.configRepo.findMany({ hotelId }))[0]
  if (!existente?.accessToken || !existente?.wabaId) {
    throw new ConflictError('Este hotel no tiene una conexión de WhatsApp para dar de baja.')
  }

  try {
    await deps.client.unsubscribeApp({
      wabaId: String(existente.wabaId),
      accessToken: String(existente.accessToken),
      phoneNumberId: String(existente.phoneNumberId ?? ''),
    })
  } catch (err) {
    const motivo = explicarErrorDeConexion(err)
    deps.logger.warn('Baja de WhatsApp rechazada por Meta', { hotelId, motivo })
    throw new ConflictError(`Meta no aceptó dar de baja la conexión: ${motivo}`)
  }

  await deps.configRepo.update(existente.id, {
    connectionMode: 'none',
    connectionStatus: 'disconnected',
    accessToken: '',
    phoneNumberId: '',
    wabaId: '',
    displayPhoneNumber: '',
    verifiedName: '',
    businessName: '',
    qualityRating: '',
    messagingLimit: '',
    accountReviewStatus: '',
    connectedAt: '',
    connectedByUserId: '',
    connectionError: '',
    isActive: 0,
  })
  deps.logger.info('WhatsApp desconectado', { hotelId })
}

/** Estados que muestra la tarjeta. `legacy_baileys` es la vinculación vieja por código QR. */
export type EstadoConexion = 'disconnected' | 'connected' | 'error' | 'legacy_baileys'

/**
 * Proyección para la tarjeta del panel. NUNCA incluye el token: es la misma regla que
 * `redactWhatsappConfig`, y acá importa igual porque esta respuesta va al navegador.
 */
export function proyectarConexion(config: any): Record<string, unknown> {
  if (!config) return { estado: 'disconnected' as EstadoConexion }

  const tieneMeta = config.connectionMode === 'meta' && !!config.accessToken
  const tieneBaileys = config.connectionMode === 'baileys' && !!config.baileysCredentials
  const estado: EstadoConexion = tieneMeta
    ? 'connected'
    : tieneBaileys
      ? 'legacy_baileys'
      : config.connectionError
        ? 'error'
        : 'disconnected'

  return {
    estado,
    displayPhoneNumber: config.displayPhoneNumber || null,
    verifiedName: config.verifiedName || null,
    businessName: config.businessName || null,
    qualityRating: config.qualityRating || null,
    messagingLimit: config.messagingLimit || null,
    accountReviewStatus: config.accountReviewStatus || null,
    connectedAt: config.connectedAt || null,
    connectionError: config.connectionError || null,
  }
}

/**
 * Qué hoteles tienen WhatsApp conectado. SOLO LECTURA y solo para el super_admin: es una
 * herramienta de soporte ("¿este hotel puede mandar mensajes?"), no un lugar para configurar.
 * Configurar sigue siendo del hotel, en su propio panel.
 *
 * Nunca incluye tokens: devuelve lo mismo que ve el hotel en su tarjeta.
 */
export async function listarConexiones(configRepo: any): Promise<Array<Record<string, unknown>>> {
  const filas = await configRepo.findMany({})
  return filas
    .map((c: any) => ({ hotelId: c.hotelId, ...proyectarConexion(c) }))
    // Los que nunca conectaron nada no aportan a la lista de soporte.
    .filter((c: any) => c.estado !== 'disconnected')
    .sort((a: any, b: any) => String(b.connectedAt ?? '').localeCompare(String(a.connectedAt ?? '')))
}
