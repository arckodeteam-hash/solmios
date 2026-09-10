// platform-emails/types.ts — DTOs de API. El schema de DB vive en ./model.ts.

export type PlatformEmailEvent =
  | 'welcome'
  | 'trial_ending'
  | 'trial_expired'
  /** REQ-PIPE-05 (#146): el super-admin le dio más días de prueba al hotel. */
  | 'trial_extended'
  /** REQ-PIPE-08 (#149): secuencia de activación por comportamiento (cron diario). */
  | 'activation_no_rooms'
  | 'activation_no_rates'
  | 'activation_no_channel'
  | 'trial_offer'
  /** REQ-PIPE-09 (#150): rescate de trial vencido a +2 y +7 días. */
  | 'trial_rescue_1'
  | 'trial_rescue_2'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'subscription_renewal_auto'
  | 'subscription_renewal_manual'
  | 'subscription_suspended'
  | 'subscription_reactivated'

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
  enqueue: (input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }) => Promise<string>
}

export type CurrentUser = { id: string; role: string; hotelId?: string; userType?: string }
