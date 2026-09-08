import type { ValidationRule } from 'arckode-framework'

const CHANNEL_ENUM = ['whatsapp', 'webchat', 'email', 'voice']
const STATUS_ENUM = ['active', 'resolved', 'transferred', 'waiting']
const RESOLVED_BY_ENUM = ['bot', 'agent', 'hybrid']
const SENDER_ENUM = ['guest', 'bot', 'agent', 'system']
const CONTENT_TYPE_ENUM = ['text', 'image', 'document', 'location', 'template', 'button', 'interactive']
const INTENT_CATEGORY_ENUM = ['booking', 'faq', 'service', 'complaint', 'payment', 'concierge', 'emergency', 'general']
const TEMPLATE_CATEGORY_ENUM = ['greeting', 'faq', 'service', 'complaint', 'checkout', 'emergency', 'upsell']
const VOICE_PROVIDER_ENUM = ['lowcost', 'livekit', 'openai', 'retell']
const BOOKING_STEP_ENUM = ['init', 'dates', 'guests', 'room_select', 'confirm', 'guest_info', 'payment', 'done']
const PAYMENT_STATUS_ENUM = ['pending', 'sent', 'paid', 'expired']

export const CreateConversationSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  guestId: { type: 'string' as const },
  reservationId: { type: 'string' as const },
  channel: { type: 'string' as const, required: true, enum: CHANNEL_ENUM },
  channelConversationId: { type: 'string' as const },
  guestPhone: { type: 'string' as const, max: 30 },
  guestName: { type: 'string' as const, max: 200 },
  language: { type: 'string' as const, max: 5 },
}

export const UpdateConversationSchema: Record<string, ValidationRule> = {
  status: { type: 'string' as const, enum: STATUS_ENUM },
  resolvedBy: { type: 'string' as const, enum: RESOLVED_BY_ENUM },
  assignedAgentId: { type: 'string' as const },
  satisfactionScore: { type: 'number' as const, min: 1, max: 5 },
  endedAt: { type: 'string' as const },
  lastMessageAt: { type: 'string' as const },
  intentSummary: { type: 'string' as const, max: 200 },
  tags: { type: 'array' as any },
}

export const CreateMessageSchema: Record<string, ValidationRule> = {
  conversationId: { type: 'string' as const, required: true },
  hotelId: { type: 'string' as const, required: true },
  sender: { type: 'string' as const, required: true, enum: SENDER_ENUM },
  content: { type: 'string' as const, required: true, min: 1, max: 5000 },
  contentType: { type: 'string' as const, enum: CONTENT_TYPE_ENUM },
  mediaUrl: { type: 'string' as const, max: 2000 },
  intentDetected: { type: 'string' as const, max: 200 },
  confidence: { type: 'number' as const, min: 0, max: 1 },
  actionTaken: { type: 'string' as const },
  actionResult: { type: 'object' as any },
  metadata: { type: 'object' as any },
}

export const CreateIntentSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  name: { type: 'string' as const, required: true, min: 2, max: 100 },
  category: { type: 'string' as const, enum: INTENT_CATEGORY_ENUM },
  triggerPhrases: { type: 'array' as any, required: true },
  responseTemplate: { type: 'string' as const, required: true, max: 5000 },
  action: { type: 'string' as const },
  actionPayload: { type: 'object' as any },
  fallbackResponse: { type: 'string' as const, max: 5000 },
  priority: { type: 'number' as const },
  confidenceThreshold: { type: 'number' as const, min: 0, max: 1 },
}

export const UpdateIntentSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, max: 100 },
  category: { type: 'string' as const, enum: INTENT_CATEGORY_ENUM },
  triggerPhrases: { type: 'array' as any },
  responseTemplate: { type: 'string' as const, max: 5000 },
  action: { type: 'string' as const },
  actionPayload: { type: 'object' as any },
  fallbackResponse: { type: 'string' as const, max: 5000 },
  priority: { type: 'number' as const },
  confidenceThreshold: { type: 'number' as const, min: 0, max: 1 },
  isActive: { type: 'number' as const },
}

export const CreateTemplateSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  name: { type: 'string' as const, required: true, min: 2, max: 200 },
  category: { type: 'string' as const, required: true, enum: TEMPLATE_CATEGORY_ENUM },
  trigger: { type: 'string' as const, max: 200 },
  responseEs: { type: 'string' as const, required: true, max: 5000 },
  responseEn: { type: 'string' as const, max: 5000 },
  responsePt: { type: 'string' as const, max: 5000 },
  channel: { type: 'string' as const },
  variables: { type: 'array' as any },
  buttons: { type: 'array' as any },
}

export const UpdateTemplateSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, max: 200 },
  category: { type: 'string' as const, enum: TEMPLATE_CATEGORY_ENUM },
  trigger: { type: 'string' as const, max: 200 },
  responseEs: { type: 'string' as const, max: 5000 },
  responseEn: { type: 'string' as const, max: 5000 },
  responsePt: { type: 'string' as const, max: 5000 },
  channel: { type: 'string' as const },
  variables: { type: 'array' as any },
  buttons: { type: 'array' as any },
  isActive: { type: 'number' as const },
}

export const CreateWhatsappConfigSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  phoneNumberId: { type: 'string' as const, max: 100 },
  wabaId: { type: 'string' as const, max: 100 },
  accessToken: { type: 'string' as const, max: 500 },
  verifyToken: { type: 'string' as const, max: 200 },
  businessHoursStart: { type: 'string' as const },
  businessHoursEnd: { type: 'string' as const },
  businessDays: { type: 'array' as any },
  outsideHoursMessage: { type: 'string' as const, max: 2000 },
  transferAgentPhone: { type: 'string' as const, max: 30 },
}

export const AiRecepcionistaValidator = {
  createConversation: CreateConversationSchema,
  updateConversation: UpdateConversationSchema,
  createMessage: CreateMessageSchema,
  createIntent: CreateIntentSchema,
  updateIntent: UpdateIntentSchema,
  createTemplate: CreateTemplateSchema,
  updateTemplate: UpdateTemplateSchema,
  createWhatsappConfig: CreateWhatsappConfigSchema,
}

export const CloseConversationSchema: Record<string, ValidationRule> = {
  resolvedBy: { type: 'string' as const, enum: RESOLVED_BY_ENUM },
  satisfactionScore: { type: 'number' as const, min: 1, max: 5 },
}

export const TransferConversationSchema: Record<string, ValidationRule> = {
  agentId: { type: 'string' as const },
  reason: { type: 'string' as const, max: 500 },
}

export const TestIntentSchema: Record<string, ValidationRule> = {
  message: { type: 'string' as const, required: true, min: 1 },
}

export const WebChatMessageSchema: Record<string, ValidationRule> = {
  sessionId: { type: 'string' as const },
  content: { type: 'string' as const, required: true, min: 1 },
}

export const StartWhatsappSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const },
}

export const StopWhatsappSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const },
}

/**
 * Lo que devuelve la ventana de Meta al terminar el Embedded Signup.
 * `hotelId` solo lo usa un super_admin para apuntar a otro hotel; para el resto sale del token.
 */
export const ConnectWhatsappSchema: Record<string, ValidationRule> = {
  code: { type: 'string' as const, required: true, min: 8, max: 500 },
  phoneNumberId: { type: 'string' as const, required: true, max: 100 },
  wabaId: { type: 'string' as const, required: true, max: 100 },
  hotelId: { type: 'string' as const },
}

/** Respuesta con texto libre desde la bandeja. El tope es el de WhatsApp. */
export const ReplyConversationSchema: Record<string, ValidationRule> = {
  text: { type: 'string' as const, required: true, min: 1, max: 4096 },
}
