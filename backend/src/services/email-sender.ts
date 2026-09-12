// services/email-sender.ts — Puerto de envío de notificaciones (DIP / ISP).
//
// Los casos de uso (capa de dominio) dependen de esta abstracción, NO de la
// infraestructura concreta (EmailService con SMTP/Resend). Permite sustituir el
// proveedor o usar un no-op (NullEmailSender) sin tocar los use cases.
//
// NotificationInput vive aquí (no en email-service) para evitar dependencia circular:
// EmailSender → NotificationInput → notification-defaults; EmailService implementa
// EmailSender, pero los use cases solo importan este puerto.

import type { NotificationEvent, NotificationLanguage } from './notification-defaults'

/** Adjunto de email (#270: el recibo PDF viaja en la cola como base64, serializable a JSON). */
export interface EmailAttachment {
  filename: string
  contentType: string
  contentBase64: string
}

/**
 * Adjunto DIFERIDO (#270): un marcador que se persiste en la fila de la cola y que el worker
 * resuelve a un `EmailAttachment` justo antes de enviar. Existe porque generar el recibo PDF
 * lanza un Chromium (15 s + 10 s de timeouts): hacerlo en el request que encola —el webhook de
 * Stripe o el retorno de Azul/CardNet— lo bloqueaba y N pagos simultáneos eran N Chromiums sin
 * tope. El worker procesa una fila por vez, así que el navegador se lanza de a uno. Si la
 * resolución falla, el correo sale sin adjunto (el huésped tiene el botón de descarga igual).
 */
export interface DeferredEmailAttachment {
  kind: 'receipt'
  reservationId: string
  filename: string
}

export type EmailAttachmentInput = EmailAttachment | DeferredEmailAttachment

export function isDeferredAttachment(a: unknown): a is DeferredEmailAttachment {
  return !!a && typeof a === 'object'
    && (a as DeferredEmailAttachment).kind === 'receipt'
    && typeof (a as DeferredEmailAttachment).reservationId === 'string'
    && typeof (a as DeferredEmailAttachment).filename === 'string'
}

export function isInlineAttachment(a: unknown): a is EmailAttachment {
  return !!a && typeof a === 'object'
    && typeof (a as EmailAttachment).filename === 'string'
    && typeof (a as EmailAttachment).contentBase64 === 'string'
}

/** Resuelve un marcador diferido a un adjunto real; `null` = sin adjunto. Lo inyecta la infraestructura. */
export type DeferredAttachmentResolver = (marker: DeferredEmailAttachment) => Promise<EmailAttachment | null>

/** Input para resolver + renderizar + encolar una notificación por (event, language). */
export interface NotificationInput {
  to: string
  hotelId: string
  event: NotificationEvent
  language: NotificationLanguage
  variables: Record<string, string | number>
  /** Origen para trazabilidad (ej: 'reservation', 'checkin'). */
  relatedType?: string
  relatedId?: string
  /** Adjuntos opcionales (#270: recibo PDF, en línea o como marcador diferido). */
  attachments?: EmailAttachmentInput[]
}

/**
 * Puerto de envío de notificaciones transaccionales (DIP/ISP).
 * Contrato mínimo que los use cases consumen; EmailService es la implementación de producción.
 */
export interface EmailSender {
  enqueueNotification(input: NotificationInput): Promise<string>
}

/**
 * Null Object: no-op cuando aún no se inyectó el EmailService real.
 * Elimina los `if (emailService)` esparcidos en los use cases (LSP: sustituible, no guard).
 */
export class NullEmailSender implements EmailSender {
  async enqueueNotification(_input: NotificationInput): Promise<string> {
    return ''
  }
}
