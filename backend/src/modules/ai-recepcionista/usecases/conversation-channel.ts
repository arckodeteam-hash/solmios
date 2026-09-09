// ai-recepcionista/usecases/conversation-channel.ts
//
// El canal por el que llegó la conversación decide qué tools puede usar el bot.
//
// `webchat` entra por `/api/ai/chat/:slug`, que es PÚBLICO y anónimo (solo rate-limit por IP);
// `whatsapp` entra por el webhook de Meta, firmado, que sí autentica el origen. La tool
// `generate_invoice` solo corre en canales autenticados: emitir una factura consume secuencia NCF,
// y un anónimo que la dispara puede agotar el numerador fiscal del hotel.
//
// Devuelve `undefined` si no se pudo determinar. El llamador es fail-closed: sin canal conocido,
// las tools sensibles NO corren (ver `generate_invoice` en llm-pipeline.ts).

export async function conversationChannel(
  conversationRepo: { findOne: (f: Record<string, unknown>) => Promise<{ channel?: string } | null> },
  conversationId: string,
  hotelId: string,
): Promise<string | undefined> {
  try {
    const conv = await conversationRepo.findOne({ id: conversationId, hotelId })
    return conv?.channel
  } catch {
    return undefined
  }
}
