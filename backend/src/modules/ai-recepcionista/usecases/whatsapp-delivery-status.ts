// ai-recepcionista/usecases/whatsapp-delivery-status.ts — Estado de entrega que informa Meta.
//
// Cuando el hotel manda un mensaje, Meta acepta y devuelve un `wamid`. Eso es "enviado", NO
// "entregado": si el huésped lo recibió, si lo leyó, o si falló, llega minutos después por webhook.
// Sin esto el panel mostraría "enviado" para siempre y el hotel no sabría si el mensaje llegó.

import type { Logger } from 'arckode-framework'

/** Puerto para escribir en `message_logs`, que es tabla del módulo `marketing`. */
export interface DeliveryStatusPort {
  findByProviderMessageId(wamid: string): Promise<{ id: string; status?: string } | null>
  updateStatus(id: string, patch: { status: string; errorMessage?: string }): Promise<void>
}

/**
 * Orden de avance de un mensaje. Un webhook tardío no puede hacer retroceder el estado: Meta no
 * garantiza el orden de entrega de sus propias notificaciones, y ver "entregado" después de
 * "leído" haría dudar de todo el historial.
 */
const ORDEN: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 }

/** `failed` es terminal y no compite en la escala: si Meta dice que falló, falló. */
export function debeAvanzar(actual: string | undefined, nuevo: string): boolean {
  if (nuevo === 'failed') return true
  if (actual === 'failed') return false
  return (ORDEN[nuevo] ?? -1) > (ORDEN[actual ?? 'queued'] ?? 0)
}

export interface StatusPayload {
  id?: string
  status?: string
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

/**
 * Procesa el array `statuses` de un webhook de Meta.
 *
 * Un `wamid` que no existe localmente se ignora en silencio: puede ser de otro sistema conectado a
 * la misma cuenta, y devolver error haría que Meta reintente el webhook para siempre.
 */
export async function aplicarEstadosDeEntrega(
  deps: { port: DeliveryStatusPort; logger: Logger; explicarError?: (codigo: number, texto: string) => string },
  statuses: StatusPayload[],
): Promise<{ actualizados: number; ignorados: number }> {
  let actualizados = 0
  let ignorados = 0

  for (const s of statuses ?? []) {
    const wamid = s?.id
    const nuevo = s?.status
    if (!wamid || !nuevo) { ignorados++; continue }

    const fila = await deps.port.findByProviderMessageId(wamid)
    if (!fila) { ignorados++; continue }
    if (!debeAvanzar(fila.status, nuevo)) { ignorados++; continue }

    const err = s.errors?.[0]
    const motivo = err
      ? deps.explicarError?.(err.code ?? 0, err.title || err.message || '')
        ?? err.error_data?.details ?? err.title ?? err.message ?? 'Meta no entregó el mensaje'
      : undefined

    await deps.port.updateStatus(fila.id, { status: nuevo, ...(motivo ? { errorMessage: motivo } : {}) })
    actualizados++
  }

  if (actualizados) deps.logger.info('Estados de entrega actualizados', { actualizados, ignorados })
  return { actualizados, ignorados }
}
