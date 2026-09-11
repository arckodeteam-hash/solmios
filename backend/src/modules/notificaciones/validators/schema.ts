import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

const TYPE_ENUM = ['system', 'reservation', 'payment', 'housekeeping', 'maintenance', 'announcement', 'support']
const CHANNEL_ENUM = ['in_app', 'email', 'sms', 'whatsapp']
const TITLE_MAX = 200
const MESSAGE_MAX = 2000

export const CreateNotificacionesSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  userId: { type: 'string' as const },
  type: { type: 'string' as const, enum: TYPE_ENUM },
  title: { type: 'string' as const, required: true, min: 1, max: TITLE_MAX },
  message: { type: 'string' as const, max: MESSAGE_MAX },
  read: { type: 'number' as const },
  sent: { type: 'number' as const },
  date: { type: 'string' as const },
  channel: { type: 'string' as const, enum: CHANNEL_ENUM },
  metadata: { type: 'object' as const },
}

export const UpdateNotificacionesSchema: Record<string, ValidationRule> = {
  userId: { type: 'string' as const },
  type: { type: 'string' as const, enum: TYPE_ENUM },
  title: { type: 'string' as const, min: 1, max: TITLE_MAX },
  message: { type: 'string' as const, max: MESSAGE_MAX },
  read: { type: 'number' as const },
  sent: { type: 'number' as const },
  date: { type: 'string' as const },
  channel: { type: 'string' as const, enum: CHANNEL_ENUM },
  metadata: { type: 'object' as const },
}

export const NotificacionesValidator = { create: CreateNotificacionesSchema, update: UpdateNotificacionesSchema }
