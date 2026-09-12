// abandon-recovery/usecases/send-email.ts — Adaptador de envío (F3 3.14).
//
// Extraído de service.ts para mantenerlo < 200 líneas (regla del analyzer: God Object).

import type { AbandonEmailSender } from '../types'

/** Llama a `enqueue` si existe, si no cae a `send`. Defensivo: distintos EmailService
 *  exponen distintos nombres de método (reservas usa send, platform-emails usa enqueue).
 *  Sin sender (aún no cableado post-init) → null: el caller no marca el flag y reintenta. */
export async function sendAbandonEmail(
  email: AbandonEmailSender | null,
  to: string,
  subject: string,
  html: string,
): Promise<{ sent: boolean } | null> {
  if (!email) return null
  if (typeof email.enqueue === 'function') {
    return await email.enqueue(to, subject, html)
  }
  if (typeof email.send === 'function') {
    return await email.send(to, subject, html)
  }
  return null
}
