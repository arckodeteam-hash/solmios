// marketing/validators/schema.ts
import type { ValidationRule } from 'arckode-framework'

export const CreateAutoMessageSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  title: { type: 'string' as const, required: true, min: 2 },
  color: { type: 'string' as const },
  channel: { type: 'string' as const, enum: ['email','whatsapp','both'] },
  triggerEvent: { type: 'string' as const, required: true, enum: ['on_reservation','pre_checkin','checkin_day','checkout_day','post_checkout','birthday','inactive_guests'] },
  triggerOffset: { type: 'number' as const },
  emailSubject: { type: 'string' as const },
  emailBody: { type: 'string' as const },
  whatsappBody: { type: 'string' as const },
  // Notification templates configurable + i18n (spec 11.1.6).
  event: { type: 'string' as const, enum: ['reservation_confirmed','reservation_presale','checkin_welcome','no_show','checkout','invoice','reminder'] },
  language: { type: 'string' as const, enum: ['es','en','pt'] },
  triggerType: { type: 'string' as const, enum: ['immediate','cron'] },
  // INT-1/EST-2: sin esta declaración validateSchema DROPEA isActive del POST → el service
  // nunca ve el 0 del toggle "Pausado" y crea TODO activo (el default). Mismo formato que
  // el update: `number` 0/1; el service normaliza a flag INTEGER.
  isActive: { type: 'number' as const },
}

export const CreateTemplateSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  name: { type: 'string' as const, required: true, min: 2 },
  body: { type: 'string' as const },
  category: { type: 'string' as const, enum: ['general','reservation','checkin','checkout','payment','marketing'] },
  // INT-1/EST-2: ídem CreateAutoMessageSchema — sin declaración, el toggle "Pausado"
  // del alta de plantillas se descartaba en la validación.
  isActive: { type: 'number' as const },
}

export const UpdateAutoMessageSchema: Record<string, ValidationRule> = {
  title: { type: 'string' as const, min: 2 },
  color: { type: 'string' as const },
  channel: { type: 'string' as const, enum: ['email','whatsapp','both'] },
  triggerEvent: { type: 'string' as const, enum: ['on_reservation','pre_checkin','checkin_day','checkout_day','post_checkout','birthday','inactive_guests'] },
  triggerOffset: { type: 'number' as const },
  emailSubject: { type: 'string' as const },
  emailBody: { type: 'string' as const },
  whatsappBody: { type: 'string' as const },
  // Notification templates configurable + i18n (spec 11.1.6) — editables en update
  event: { type: 'string' as const, enum: ['reservation_confirmed','reservation_presale','checkin_welcome','no_show','checkout','invoice','reminder'] },
  language: { type: 'string' as const, enum: ['es','en','pt'] },
  triggerType: { type: 'string' as const, enum: ['immediate','cron'] },
  isActive: { type: 'number' as const },
}

export const CreateMessageLogSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  reservationId: { type: 'string' as const },
  guestId: { type: 'string' as const },
  channel: { type: 'string' as const, required: true },
  status: { type: 'string' as const, required: true, enum: ['queued','sent','failed','delivered'] },
}

export const UpdateTemplateSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2 },
  body: { type: 'string' as const },
  category: { type: 'string' as const, enum: ['general','reservation','checkin','checkout','payment','marketing'] },
  // BUG FIX: faltaba isActive → el toggle "activar/desactivar plantilla" del frontend se descartaba
  // silenciosamente (validateSchema dropea campos no declarados).
  isActive: { type: 'number' as const },
}
