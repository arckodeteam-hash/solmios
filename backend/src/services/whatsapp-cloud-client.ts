// src/services/whatsapp-cloud-client.ts — Cliente REAL de la WhatsApp Business Platform (Meta).
//
// Cubre la Business Management API de PLANTILLAS: crear una, leer su estado de aprobación y
// borrarla. El envío de mensajes (Cloud API, `POST /{phoneNumberId}/messages`) es otra pieza:
// no vive acá todavía.
// Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
//
// Las credenciales (wabaId + accessToken) viven en la config de WhatsApp DEL HOTEL
// (`ai_whatsapp_config`), NUNCA en código ni en env: cada hotel conecta su propia cuenta de
// WhatsApp y por eso no hay un token de plataforma que sirva para todos.

/**
 * Versión del Graph API. `v26.0` es la que Meta tiene registrada para la app de SOLMI OS
 * (app 1727869705161184). Se puede pisar por hotel/entorno con `META_GRAPH_VERSION` para
 * probar una versión nueva sin tocar código.
 */
export const DEFAULT_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0'
const GRAPH_BASE = 'https://graph.facebook.com'

/** Meta corta las respuestas lentas igual; 15s evita colgar el request del panel. */
const TIMEOUT_MS = 15_000

export interface WhatsappCloudCredentials {
  /** WhatsApp Business Account ID — la "cuenta" dueña de las plantillas. NO es el App ID. */
  wabaId: string
  accessToken: string
  /** Número emisor. No se usa para plantillas, sí para enviar. */
  phoneNumberId?: string
  graphVersion?: string
}

/** Estados que devuelve Meta. `LOCAL` no es de Meta: es nuestro, para lo que nunca se envió. */
export type MetaTemplateStatus =
  | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL'

export type MetaTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'

export interface MetaTemplateComponent {
  type: 'BODY' | 'HEADER' | 'FOOTER' | 'BUTTONS'
  text?: string
  /** Valores de muestra: Meta RECHAZA una plantilla con variables y sin ejemplos. */
  example?: { body_text?: string[][] }
}

export interface CreateMetaTemplateInput {
  /** minúsculas, dígitos y guión bajo. Ver `metaTemplateName()` en el usecase. */
  name: string
  language: string
  category: MetaTemplateCategory
  components: MetaTemplateComponent[]
}

/**
 * Error de Meta con el detalle que sirve para mostrarle algo útil al hotel.
 * Meta manda dos mensajes: `message` (técnico) y `error_user_msg` (redactado para humanos).
 * Cuando existe el segundo, es el que hay que mostrar.
 */
export class WhatsappCloudError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly metaCode?: number,
    readonly metaSubcode?: number,
    readonly fbtraceId?: string,
  ) {
    super(message)
    this.name = 'WhatsappCloudError'
  }
}

function baseUrl(creds: WhatsappCloudCredentials): string {
  return `${GRAPH_BASE}/${creds.graphVersion || DEFAULT_GRAPH_VERSION}`
}

/**
 * `fetch` contra el Graph API con el token en el header (NUNCA en la query string: la URL
 * queda escrita en los logs de nginx y en el historial del proxy, el header no).
 */
async function graphFetch<T>(
  creds: WhatsappCloudCredentials,
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  if (!creds.accessToken) throw new WhatsappCloudError('Falta el token de acceso de Meta', 401)
  if (!creds.wabaId) throw new WhatsappCloudError('Falta el WABA ID (cuenta de WhatsApp) del hotel', 401)

  let res: Response
  try {
    res = await fetch(`${baseUrl(creds)}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err: unknown) {
    // Red caída o timeout: NO es un rechazo de Meta, es que no llegamos a preguntarle.
    const reason = err instanceof Error ? err.message : String(err)
    throw new WhatsappCloudError(`No se pudo contactar a Meta: ${reason}`, 503)
  }

  const raw = await res.text()
  let parsed: any = null
  try { parsed = raw ? JSON.parse(raw) : null } catch { /* Meta contestó algo que no es JSON */ }

  if (!res.ok) {
    const e = parsed?.error ?? {}
    const msg = e.error_user_msg || e.message || raw.slice(0, 300) || `HTTP ${res.status}`
    throw new WhatsappCloudError(msg, res.status, e.code, e.error_subcode, e.fbtrace_id)
  }
  return parsed as T
}

/**
 * Crea la plantilla en Meta y la deja en revisión. La respuesta trae el `id` y, normalmente,
 * `status: 'PENDING'` — la aprobación tarda de minutos a 24 h y llega después, por sync o webhook.
 */
export async function createMetaTemplate(
  creds: WhatsappCloudCredentials,
  input: CreateMetaTemplateInput,
): Promise<{ id: string; status: MetaTemplateStatus; category?: string }> {
  const body = await graphFetch<{ id: string; status?: string; category?: string }>(
    creds,
    `/${creds.wabaId}/message_templates`,
    { method: 'POST', body: input },
  )
  return {
    id: String(body.id),
    status: (body.status as MetaTemplateStatus) || 'PENDING',
    category: body.category,
  }
}

/**
 * Estado de UNA plantilla, consultada por su id de Meta.
 *
 * Se pregunta por plantilla y no por cuenta a propósito: el panel sincroniza la fila que el usuario
 * está mirando, y traer el catálogo entero para leer un solo campo desperdicia cuota de la API.
 */
export async function getMetaTemplateStatus(
  creds: WhatsappCloudCredentials,
  metaTemplateId: string,
): Promise<{ status: MetaTemplateStatus; rejectedReason?: string; category?: string }> {
  const body = await graphFetch<{ status?: string; rejected_reason?: string; category?: string }>(
    creds,
    `/${metaTemplateId}?fields=status,rejected_reason,category`,
  )
  return {
    status: (body.status as MetaTemplateStatus) || 'PENDING',
    // Meta manda 'NONE' cuando no hubo rechazo; convertirlo a undefined evita guardar la cadena
    // "NONE" como si fuera un motivo real.
    rejectedReason: body.rejected_reason && body.rejected_reason !== 'NONE' ? String(body.rejected_reason) : undefined,
    category: body.category,
  }
}

/**
 * Borra la plantilla en Meta POR NOMBRE (no por id: así lo define su API).
 * Borra todos los idiomas de esa plantilla.
 */
export async function deleteMetaTemplate(
  creds: WhatsappCloudCredentials,
  name: string,
): Promise<void> {
  await graphFetch(creds, `/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Conexión de un hotel (Embedded Signup)
// ─────────────────────────────────────────────────────────────────────────────

/** Credenciales de la APP, no del hotel. Viven en el entorno del servidor, nunca en la base. */
export interface MetaAppCredentials {
  appId: string
  appSecret: string
  graphVersion?: string
}

/**
 * Lee las credenciales de la app del entorno.
 * Devuelve `null` si falta alguna: es un problema de despliegue, no del hotel, y quien llama
 * tiene que poder distinguirlo para responder 503 en vez de culpar al usuario.
 */
export function appCredentialsFromEnv(): MetaAppCredentials | null {
  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return null
  return { appId, appSecret, graphVersion: process.env.META_GRAPH_VERSION }
}

/**
 * Canjea el código de un solo uso que devuelve la ventana de Meta por el token permanente del
 * negocio del hotel.
 *
 * Este paso EXIGE el `app_secret`, y por eso vive en el servidor: si el navegador pidiera el token
 * directo (`response_type: 'token'`), esa credencial —que puede escribirle a todos los huéspedes del
 * hotel— quedaría en el JavaScript de la página, al alcance de cualquiera con la consola abierta.
 *
 * El código vence en segundos y es de un solo uso: un reintento con el mismo código SIEMPRE falla.
 */
export async function exchangeCode(
  app: MetaAppCredentials,
  code: string,
): Promise<{ accessToken: string }> {
  const version = app.graphVersion || DEFAULT_GRAPH_VERSION
  const url = new URL(`${GRAPH_BASE}/${version}/oauth/access_token`)
  url.searchParams.set('client_id', app.appId)
  url.searchParams.set('client_secret', app.appSecret)
  url.searchParams.set('code', code)

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new WhatsappCloudError(`No se pudo contactar a Meta: ${reason}`, 503)
  }

  const raw = await res.text()
  let parsed: any = null
  try { parsed = raw ? JSON.parse(raw) : null } catch { /* no vino JSON */ }

  if (!res.ok || !parsed?.access_token) {
    const e = parsed?.error ?? {}
    const msg = e.error_user_msg || e.message || `HTTP ${res.status}`
    throw new WhatsappCloudError(msg, res.ok ? 502 : res.status, e.code, e.error_subcode, e.fbtrace_id)
  }
  return { accessToken: String(parsed.access_token) }
}

/**
 * Suscribe NUESTRA app a la cuenta de WhatsApp del hotel.
 * Sin esto los webhooks de ese hotel nunca llegan: el hotel queda "conectado" pero sordo.
 */
export async function subscribeApp(creds: WhatsappCloudCredentials): Promise<void> {
  await graphFetch(creds, `/${creds.wabaId}/subscribed_apps`, { method: 'POST' })
}

/** Da de baja la suscripción. Se hace ANTES de borrar los datos locales de la conexión. */
export async function unsubscribeApp(creds: WhatsappCloudCredentials): Promise<void> {
  await graphFetch(creds, `/${creds.wabaId}/subscribed_apps`, { method: 'DELETE' })
}

export interface MetaPhoneNumberInfo {
  displayPhoneNumber: string
  verifiedName: string
  qualityRating?: string
  messagingLimit?: string
  codeVerificationStatus?: string
}

/** Datos del número conectado: lo que el hotel mira en la tarjeta para saber que es el suyo. */
export async function getPhoneNumber(creds: WhatsappCloudCredentials): Promise<MetaPhoneNumberInfo> {
  const fields = 'display_phone_number,verified_name,quality_rating,messaging_limit_tier,code_verification_status'
  const body = await graphFetch<any>(creds, `/${creds.phoneNumberId}?fields=${fields}`)
  return {
    displayPhoneNumber: String(body?.display_phone_number ?? ''),
    verifiedName: String(body?.verified_name ?? ''),
    qualityRating: body?.quality_rating ? String(body.quality_rating) : undefined,
    messagingLimit: body?.messaging_limit_tier ? String(body.messaging_limit_tier) : undefined,
    codeVerificationStatus: body?.code_verification_status ? String(body.code_verification_status) : undefined,
  }
}

export interface MetaWabaInfo {
  name: string
  currency?: string
  accountReviewStatus?: string
}

/** Datos de la cuenta: a qué negocio pertenece el número y si Meta ya lo verificó. */
export async function getWabaInfo(creds: WhatsappCloudCredentials): Promise<MetaWabaInfo> {
  const body = await graphFetch<any>(creds, `/${creds.wabaId}?fields=name,currency,account_review_status`)
  return {
    name: String(body?.name ?? ''),
    currency: body?.currency ? String(body.currency) : undefined,
    accountReviewStatus: body?.account_review_status ? String(body.account_review_status) : undefined,
  }
}

/**
 * Activa el número en la nube de Meta con un PIN de dos pasos.
 *
 * Un número ya registrado devuelve error y eso NO es un fallo de la conexión: el hotel que
 * reconecta pasa por acá con el número ya activo. Se devuelve `false` en vez de tirar, para que
 * el flujo siga.
 */
export async function registerPhoneNumber(
  creds: WhatsappCloudCredentials,
  pin: string,
): Promise<boolean> {
  try {
    await graphFetch(creds, `/${creds.phoneNumberId}/register`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin },
    })
    return true
  } catch (err) {
    // 133005/133010: ya registrado, o registrado con otro PIN. El resto sí es un problema real.
    if (err instanceof WhatsappCloudError && (err.metaCode === 133005 || err.metaCode === 133010)) return false
    throw err
  }
}

/**
 * Pasa un error de Meta a algo que el hotel pueda leer y accionar.
 *
 * Los mensajes crudos de Meta son para desarrolladores ("(#100) Invalid parameter") y no dicen qué
 * hacer. Esta tabla cubre los casos que aparecen de verdad al conectar; el resto cae al mensaje
 * original, que es mejor que un texto genérico.
 */
export function explicarErrorDeConexion(err: unknown): string {
  if (!(err instanceof WhatsappCloudError)) {
    return err instanceof Error ? err.message : String(err)
  }
  switch (err.metaCode) {
    case 190:
      return 'El permiso de Meta venció o fue revocado. Volvé a pulsar "Conectar WhatsApp".'
    case 100:
      // El código de un solo uso ya usado o vencido cae acá: es lo más frecuente al reintentar.
      return 'El permiso de Meta venció. Volvé a pulsar "Conectar WhatsApp" y completá la ventana sin cerrarla.'
    case 200:
    case 10:
      return 'Meta no le dio a SOLMI OS permiso sobre esa cuenta de WhatsApp. Revisá que hayas autorizado la cuenta correcta.'
    case 133005:
      return 'Ese número ya está registrado en la nube de Meta con otro PIN de verificación.'
    default:
      if (err.httpStatus >= 500) return `Meta no respondió: ${err.message}. Probá de nuevo en unos minutos.`
      return err.message
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Envío de mensajes (Cloud API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manda una plantilla APROBADA. Es el único modo de iniciar una conversación: fuera de la ventana
 * de 24 h desde el último mensaje del huésped, Meta rechaza cualquier otra cosa.
 *
 * `parameters` va en el MISMO orden en que se registró la plantilla (`metaVariableOrder`): Meta las
 * numera por posición, así que un orden distinto le pone el nombre del hotel donde va el del huésped.
 */
export async function sendTemplateMessage(
  creds: WhatsappCloudCredentials,
  input: { to: string; name: string; language: string; parameters?: string[] },
): Promise<{ messageId: string }> {
  const components = input.parameters?.length
    ? [{ type: 'body', parameters: input.parameters.map((text) => ({ type: 'text', text })) }]
    : undefined

  const body = await graphFetch<any>(creds, `/${creds.phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'template',
      template: { name: input.name, language: { code: input.language }, ...(components ? { components } : {}) },
    },
  })
  return { messageId: String(body?.messages?.[0]?.id ?? '') }
}

/** Texto libre. Solo funciona con la ventana de 24 h abierta; si no, Meta responde 131047. */
export async function sendTextMessage(
  creds: WhatsappCloudCredentials,
  input: { to: string; text: string },
): Promise<{ messageId: string }> {
  const body = await graphFetch<any>(creds, `/${creds.phoneNumberId}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'text',
      // `preview_url: false` evita que WhatsApp expanda un link de la reserva en una tarjeta que
      // muestre datos del huésped en la vista previa del chat.
      text: { body: input.text, preview_url: false },
    },
  })
  return { messageId: String(body?.messages?.[0]?.id ?? '') }
}

/**
 * Traduce los fallos de envío más comunes a algo que el recepcionista pueda entender y accionar.
 * "El número no tiene WhatsApp" y "el huésped bloqueó al hotel" son cosas distintas para quien
 * está atendiendo, aunque Meta las devuelva con la misma cara.
 */
export function explicarErrorDeEnvio(err: unknown): string {
  if (!(err instanceof WhatsappCloudError)) {
    return err instanceof Error ? err.message : String(err)
  }
  switch (err.metaCode) {
    // El más frecuente mientras la app está en modo desarrollo: Meta solo entrega a los números
    // que se registraron a mano en la consola. Sin este texto, la prueba parece un bug del PMS.
    case 131030:
      return 'Ese número no está en la lista de prueba de Meta. Mientras la app esté en modo desarrollo, solo se puede escribir a los teléfonos registrados en la consola de WhatsApp.'
    case 131047:
      return 'Pasaron más de 24 horas desde el último mensaje del huésped: solo se le puede escribir con una plantilla aprobada.'
    case 131026:
      return 'Ese número no tiene WhatsApp, o no puede recibir mensajes del hotel.'
    case 131049:
    case 131050:
      return 'WhatsApp no entregó el mensaje para cuidar la experiencia del huésped (recibió demasiados mensajes parecidos).'
    case 132000:
      return 'La plantilla no coincide con la que Meta aprobó: cambió la cantidad de variables.'
    case 132001:
      return 'Esa plantilla no existe o todavía no está aprobada en la cuenta del hotel.'
    case 131031:
      return 'Meta suspendió la cuenta de WhatsApp del hotel.'
    case 130429:
      return 'Se alcanzó el límite de mensajes por hora de la cuenta. Probá más tarde.'
    default:
      if (err.httpStatus >= 500) return `Meta no respondió: ${err.message}. El mensaje no se envió.`
      return err.message
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumo (lo que Meta factura)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsumoPorCategoria {
  /** YYYY-MM-DD */
  date: string
  /** MARKETING | UTILITY | AUTHENTICATION | SERVICE */
  category: string
  /** Conversaciones de 24 h: la unidad que Meta cobra. */
  conversations: number
  cost: number
  currency?: string
}

/**
 * Trae de Meta el consumo real de la cuenta, por día y categoría.
 *
 * Se pregunta a Meta en vez de contar nuestros `message_logs` porque Meta no cobra por mensaje sino
 * por conversación de 24 h, con precio distinto según la categoría. Un número calculado por
 * nosotros no coincidiría con su factura, y esa diferencia la termina discutiendo el hotel.
 *
 * Devuelve `[]` cuando la cuenta no tuvo conversaciones facturables en el período: es un resultado
 * válido, no un error.
 */
export async function getConversationUsage(
  creds: WhatsappCloudCredentials,
  desde: Date,
  hasta: Date,
): Promise<ConsumoPorCategoria[]> {
  const start = Math.floor(desde.getTime() / 1000)
  const end = Math.floor(hasta.getTime() / 1000)
  // La sintaxis de campo anidado es de Meta: los parámetros van DENTRO del nombre del campo.
  const campo = `conversation_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    `.dimensions(["CONVERSATION_CATEGORY"])`

  const body = await graphFetch<any>(creds, `/${creds.wabaId}?fields=${encodeURIComponent(campo)}`)
  const puntos = body?.conversation_analytics?.data?.[0]?.data_points ?? []

  return puntos.map((p: any) => ({
    date: new Date((p.start ?? 0) * 1000).toISOString().slice(0, 10),
    category: String(p.conversation_category ?? 'UNKNOWN'),
    conversations: Number(p.conversation ?? 0),
    cost: Number(p.cost ?? 0),
    currency: p.currency ? String(p.currency) : undefined,
  }))
}
