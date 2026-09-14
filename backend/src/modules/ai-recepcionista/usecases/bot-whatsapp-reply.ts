// ai-recepcionista/usecases/bot-whatsapp-reply.ts — El bot de WhatsApp contesta al huésped.
//
// La vía legacy (QR/Baileys) mandaba sola la respuesta: `whatsapp-sessions.ts` toma lo que
// devuelve el pipeline y llama `sendWhatsAppMessage`. La vía oficial (Meta) no tenía ese paso:
// el webhook guardaba la respuesta y emitía `onBotReplied`, pero nadie la enviaba — el huésped
// escribía, el bot "contestaba" dentro del panel y al teléfono no llegaba nada.
//
// Este usecase es ese envío que faltaba, por el mismo puerto que usa la bandeja (connector
// `ai-recepcionista-whatsapp`). NO se usa `responderConversacion` porque ese flujo es de una
// persona: marca la conversación como atendida y silenciaría al bot.

import type { Logger } from 'arckode-framework'
import type { InboxDeps } from './inbox'

export interface BotReplyDeps {
  whatsapp: InboxDeps['whatsapp']
  registrarEnvio?: InboxDeps['registrarEnvio']
  logger: Logger
}

export interface RespuestaBotInput {
  conversationId: string
  hotelId: string
  /** Número del huésped, tal como llegó en el webhook (`from`). */
  phone: string
  text: string
}

/**
 * Envía por Meta la respuesta que el pipeline ya generó y guardó. Falla blanda: si el envío no
 * sale, la conversación queda igual (mensaje del bot guardado, ventana de 24 h abierta) y el
 * error se loguea — un fallo acá no puede tirar el procesamiento del webhook, que ya registró
 * el mensaje del huésped.
 */
export async function enviarRespuestaDelBot(
  deps: BotReplyDeps,
  input: RespuestaBotInput,
): Promise<{ enviado: boolean; motivo?: string }> {
  const texto = (input.text || '').trim()
  if (!texto) return { enviado: false, motivo: 'sin-texto' }
  if (!deps.whatsapp) return { enviado: false, motivo: 'sin-puerto' }

  try {
    const creds = await deps.whatsapp.credentialsFor(input.hotelId)
    if (!creds) return { enviado: false, motivo: 'sin-credenciales' }

    const envio = await deps.whatsapp.sendText(creds, { to: input.phone, text: texto })

    // Con el `wamid` anotado, los acuses de entrega que llegan al webhook actualizan esta fila
    // solos (connector whatsapp-delivery-status → findLogByProviderMessageId).
    await deps.registrarEnvio?.({
      channel: 'whatsapp',
      hotelId: input.hotelId,
      messageType: 'text',
      status: 'sent',
      recipient: input.phone,
      providerMessageId: envio.messageId,
      sentAt: new Date().toISOString(),
    })
    return { enviado: true }
  } catch (err) {
    deps.logger.warn('No se pudo enviar la respuesta del bot por WhatsApp', {
      conversationId: input.conversationId,
      hotelId: input.hotelId,
      error: deps.whatsapp.explicarError(err),
    })
    return { enviado: false, motivo: 'error-de-envio' }
  }
}
