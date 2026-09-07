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
