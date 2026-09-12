// abandon-recovery/usecases/send-email.ts — Adaptador de envío (F3 3.14).
//
// Extraído de service.ts para mantenerlo < 200 líneas (regla del analyzer: God Object).

import type { AbandonEmailSender } from '../types'

export interface SendAbandonEmailInput {
  to: string
  subject: string
  html: string
  /** Obligatorio para `EmailService.enqueue` (multi-tenancy). */
  hotelId: string
  /** Id de la reserva — trazabilidad en la cola (`relatedType: 'reservation'`). */
  relatedId: string
}

/** Llama a `enqueue` (firma real de EmailService: objeto + devuelve el id de la fila) y
 *  normaliza a `{ sent }`. Fallback a `send` para doubles/legacy que sólo exponen ese nombre.
 *  Sin sender (aún no cableado post-init) → null: el caller no marca el flag y reintenta. */
export async function sendAbandonEmail(
  email: AbandonEmailSender | null,
  input: SendAbandonEmailInput,
): Promise<{ sent: boolean } | null> {
  if (!email) return null
  const { to, subject, html, hotelId, relatedId } = input
  if (typeof email.enqueue === 'function') {
    const id = await email.enqueue({ to, subject, html, hotelId, relatedType: 'reservation', relatedId })
    return { sent: typeof id === 'string' && id.length > 0 }
  }
  if (typeof email.send === 'function') {
    return await email.send(to, subject, html)
  }
  return null
}
