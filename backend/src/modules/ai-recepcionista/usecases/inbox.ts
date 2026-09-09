// ai-recepcionista/usecases/inbox.ts — Bandeja de conversaciones de WhatsApp del hotel.
//
// El webhook ya recibía los mensajes del huésped, pero iban derecho al recepcionista automático:
// nadie del hotel podía verlos ni contestar a mano. Esto es esa mitad que faltaba.

import { ValidationError, ConflictError, NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { estadoDeVentana } from './conversation-window'

/** Cómo sale un mensaje al panel. */
export interface WhatsappSendPort {
  credentialsFor(hotelId: string): Promise<{ wabaId: string; phoneNumberId: string; accessToken: string } | null>
  sendText(
    creds: { wabaId: string; phoneNumberId: string; accessToken: string },
    input: { to: string; text: string },
  ): Promise<{ messageId: string }>
  explicarError(err: unknown): string
}

export interface InboxDeps {
  conversationRepo: RepositoryAdapter<any>
  messageRepo: RepositoryAdapter<any>
  whatsapp: WhatsappSendPort | null
  logger: Logger
  /** Anota el envío en `message_logs`. Opcional: sin él la respuesta sale igual, sin rastro. */
  registrarEnvio?: (dto: Record<string, unknown>) => Promise<void>
}

/** Estados de una conversación. `human` es el que silencia al bot. */
export type EstadoConversacion = 'active' | 'human' | 'closed'

/**
 * Listado de la bandeja: conversaciones de WhatsApp del hotel, la más movida primero.
 * La ventana de 24 h viene ya calculada para que el panel no tenga que hacerlo (y no dependa del
 * reloj del navegador, que puede estar mal).
 */
export async function listarBandeja(
  deps: InboxDeps,
  hotelId: string,
  opts: { estado?: EstadoConversacion } = {},
): Promise<Array<Record<string, unknown>>> {
  const filtro: Record<string, unknown> = { hotelId, channel: 'whatsapp' }
  if (opts.estado) filtro.status = opts.estado

  const conversaciones = await deps.conversationRepo.findMany(filtro as any)
  return conversaciones
    .sort((a: any, b: any) => String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? '')))
    .map((c: any) => ({
      id: c.id,
      guestName: c.guestName || null,
      guestPhone: c.guestPhone || null,
      guestId: c.guestId || null,
      status: c.status,
      assignedAgentId: c.assignedAgentId || null,
      lastMessageAt: c.lastMessageAt || null,
      unreadCount: Number(c.unreadCount ?? 0),
      ventana: estadoDeVentana(c.lastInboundAt),
    }))
}

/** Carga la conversación con su hilo y la marca leída: abrirla ES haberla leído. */
export async function abrirConversacion(
  deps: InboxDeps,
  id: string,
  hotelId: string,
): Promise<Record<string, unknown>> {
  const conv = await conversacionDelHotel(deps, id, hotelId)

  const mensajes = await deps.messageRepo.findMany({ conversationId: id } as any)
  if (Number(conv.unreadCount ?? 0) > 0) await deps.conversationRepo.update(id, { unreadCount: 0 } as any)

  return {
    id: conv.id,
    guestName: conv.guestName || null,
    guestPhone: conv.guestPhone || null,
    status: conv.status,
    assignedAgentId: conv.assignedAgentId || null,
    ventana: estadoDeVentana(conv.lastInboundAt),
    mensajes: mensajes
      .sort((a: any, b: any) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
      .map((m: any) => ({
        id: m.id,
        sender: m.sender,
        senderUserId: m.senderUserId || null,
        content: m.content,
        createdAt: m.createdAt,
      })),
  }
}

/**
 * Una persona toma la conversación: el bot deja de responderla.
 *
 * Sin esto el huésped recibe dos respuestas al mismo tiempo —la del recepcionista y la del modelo—
 * y el hotel queda como incoherente. Es la falla más visible que puede tener una bandeja.
 */
export async function tomarConversacion(
  deps: InboxDeps,
  id: string,
  hotelId: string,
  userId: string,
): Promise<void> {
  const conv = await conversacionDelHotel(deps, id, hotelId)
  if (conv.status === 'human' && conv.assignedAgentId && conv.assignedAgentId !== userId) {
    throw new ConflictError('Otra persona del equipo ya está atendiendo esta conversación.')
  }
  await deps.conversationRepo.update(id, { status: 'human', assignedAgentId: userId } as any)
}

/** La suelta: el bot vuelve a hacerse cargo. */
export async function soltarConversacion(deps: InboxDeps, id: string, hotelId: string): Promise<void> {
  await conversacionDelHotel(deps, id, hotelId)
  await deps.conversationRepo.update(id, { status: 'active', assignedAgentId: null } as any)
}

/**
 * Responde al huésped con texto libre.
 *
 * La ventana se recalcula ACÁ, en el servidor: el contador del navegador es informativo y un reloj
 * mal puesto haría intentar un envío que Meta rechaza y cobra igual.
 */
export async function responderConversacion(
  deps: InboxDeps,
  id: string,
  hotelId: string,
  texto: string,
  userId: string,
): Promise<Record<string, unknown>> {
  if (!texto?.trim()) throw new ValidationError('Escribí el mensaje antes de enviarlo.')
  if (!deps.whatsapp) throw new ConflictError('El envío por WhatsApp no está disponible en este servidor.')

  const conv = await conversacionDelHotel(deps, id, hotelId)
  if (!estadoDeVentana(conv.lastInboundAt).abierta) {
    throw new ConflictError(
      'Pasaron más de 24 horas desde el último mensaje del huésped. Para volver a escribirle hay que usar una plantilla aprobada.',
    )
  }
  if (!conv.guestPhone) throw new ValidationError('Esta conversación no tiene un número de teléfono asociado.')

  const creds = await deps.whatsapp.credentialsFor(hotelId)
  if (!creds) throw new ConflictError('Este hotel todavía no conectó su WhatsApp.')

  let messageId = ''
  try {
    const envio = await deps.whatsapp.sendText(creds, { to: String(conv.guestPhone), text: texto })
    messageId = envio.messageId
  } catch (err) {
    throw new ConflictError(deps.whatsapp.explicarError(err))
  }

  const ahora = new Date().toISOString()
  const mensaje = await deps.messageRepo.create({
    id: crypto.randomUUID(),
    conversationId: id,
    hotelId,
    sender: 'agent',
    senderUserId: userId,
    content: texto,
    contentType: 'text',
    metadata: { providerMessageId: messageId },
  } as any)

  await deps.conversationRepo.update(id, { lastMessageAt: ahora } as any)

  // El rastro en `message_logs` es lo que hace que el envío aparezca en Historial de Envíos junto
  // con el resto. Si el connector no lo cableó, la respuesta ya salió: no se deshace por el log.
  if (deps.registrarEnvio) {
    await deps.registrarEnvio({
      hotelId, guestId: conv.guestId || null, channel: 'whatsapp_api', messageType: 'whatsapp',
      status: 'sent', recipient: conv.guestPhone, providerMessageId: messageId, sentAt: ahora,
    }).catch((e: unknown) => deps.logger.warn('No se pudo registrar la respuesta en el historial', { id, error: String(e) }))
  }

  return { id: mensaje.id, providerMessageId: messageId, sentAt: ahora }
}

/**
 * Carga la conversación comprobando que es del hotel de quien pregunta.
 * El filtro por `hotelId` va en la consulta, no después: es la misma regla multi-tenant del resto.
 */
async function conversacionDelHotel(deps: InboxDeps, id: string, hotelId: string): Promise<any> {
  // @ignore IDOR_RISK — la pertenencia se valida en la línea siguiente, antes de devolver nada.
  const conv = await deps.conversationRepo.findById(id)
  if (!conv || conv.hotelId !== hotelId) throw new NotFoundError('Conversación no encontrada')
  return conv
}

/**
 * Anota un mensaje entrante del huésped: reabre la ventana de 24 h y suma a los no leídos.
 * Devuelve `true` si el bot debe CALLARSE porque una persona tomó la conversación.
 *
 * Se llama antes de procesar el mensaje: si el pipeline del modelo falla, el mensaje del huésped
 * tiene que quedar registrado igual.
 */
export async function registrarEntrante(
  deps: InboxDeps,
  conversationId: string,
  hotelId: string,
): Promise<boolean> {
  // @ignore IDOR_RISK — viene del webhook, que ya validó la firma y el hotel de la URL.
  const conv = await deps.conversationRepo.findById(conversationId)
  if (!conv || conv.hotelId !== hotelId) return false

  const patch: Record<string, unknown> = {
    lastInboundAt: new Date().toISOString(),
    unreadCount: Number(conv.unreadCount ?? 0) + 1,
  }
  // Una conversación cerrada que recibe un mensaje vuelve a la bandeja: para el huésped es la misma
  // charla, y dejarla cerrada la haría invisible para el hotel.
  if (conv.status === 'closed') patch.status = 'active'

  await deps.conversationRepo.update(conversationId, patch as any)
  return conv.status === 'human'
}
