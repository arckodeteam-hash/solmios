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
  /** Adjuntos opcionales (#270: recibo PDF). */
  attachments?: EmailAttachment[]
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
