// platform-emails/types.ts — DTOs de API. El schema de DB vive en ./model.ts.

export type PlatformEmailEvent =
  | 'welcome'
  | 'trial_ending'
  | 'trial_expired'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'subscription_renewal_auto'
  | 'subscription_renewal_manual'
  | 'subscription_suspended'
  | 'subscription_reactivated'
  // Pedido de conexión de una OTA (REQ-CAN-07). Los dispara `canales` vía el puerto que cablea
  // email-bootstrap; el hotel los recibe al agendarse la cita, al conectarse y al rechazarse.
  | 'channel_request_scheduled'
  | 'channel_request_connected'
  | 'channel_request_rejected'

export interface PlatformEmailTemplateDTO {
  id: string
  event: PlatformEmailEvent
  subject: string
  body: string
  variables: string
  isActive: boolean
  createdAt?: string
  updatedAt?: string
}

export interface UpdatePlatformEmailTemplateDTO {
  subject?: string
  body?: string
  isActive?: boolean
}

/** Sender inyectado (mismo contrato que `usuarios/usecases/email-verification.ts`). */
export interface PlatformEmailSender {
  enqueue: (input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string }) => Promise<string>
}

export type CurrentUser = { id: string; role: string; hotelId?: string; userType?: string }
