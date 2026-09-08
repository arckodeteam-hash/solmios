export type ConversationChannel = 'whatsapp' | 'webchat' | 'email' | 'voice'
export type ConversationStatus = 'active' | 'resolved' | 'transferred' | 'waiting'
export type ConversationResolvedBy = 'bot' | 'agent' | 'hybrid'
export type MessageSender = 'guest' | 'bot' | 'agent' | 'system'
export type MessageContentType = 'text' | 'image' | 'document' | 'location' | 'template' | 'button' | 'interactive'
export type IntentCategory = 'booking' | 'faq' | 'service' | 'complaint' | 'payment' | 'concierge' | 'emergency' | 'general'
export type TemplateCategory = 'greeting' | 'faq' | 'service' | 'complaint' | 'checkout' | 'emergency' | 'upsell'
export type BookingFlowStep = 'init' | 'dates' | 'guests' | 'room_select' | 'confirm' | 'guest_info' | 'payment' | 'done'
export type VoiceProvider = 'lowcost' | 'livekit' | 'openai' | 'retell'
export type BotAction = 'search_rooms' | 'create_booking' | 'check_availability' | 'send_invoice' | 'register_incident' | 'send_payment_link' | 'create_housekeeping_task' | 'create_maintenance_ticket' | 'escalate_to_human' | null

export interface AiConversationRecord {
  id: string
  hotelId: string
  guestId?: string
  reservationId?: string
  channel: ConversationChannel
  channelConversationId?: string
  guestPhone?: string
  guestName?: string
  language: string
  status: ConversationStatus
  resolvedBy?: ConversationResolvedBy
  assignedAgentId?: string
  satisfactionScore?: number
  startedAt: string
  endedAt?: string
  lastMessageAt?: string
  intentSummary?: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

export interface AiMessageRecord {
  id: string
  conversationId: string
  hotelId: string
  sender: MessageSender
  content: string
  contentType: MessageContentType
  mediaUrl?: string
  intentDetected?: string
  confidence?: number
  actionTaken?: string
  actionResult?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface AiIntentRecord {
  id: string
  hotelId: string
  name: string
  category: IntentCategory
  triggerPhrases: string[]
  responseTemplate: string
  action?: string
  actionPayload?: Record<string, unknown>
  fallbackResponse?: string
  priority: number
  confidenceThreshold: number
  requiresAuth: number
  isSystem: number
  isActive: number
  createdAt?: string
  updatedAt?: string
}

export interface AiTemplateRecord {
  id: string
  hotelId: string
  name: string
  category: TemplateCategory
  trigger?: string
  responseEs: string
  responseEn?: string
  responsePt?: string
  channel: string
  variables?: string[]
  buttons?: Record<string, unknown>[]
  isSystem: number
  isActive: number
  createdAt?: string
  updatedAt?: string
}

export interface AiWhatsappConfigRecord {
  id: string
  hotelId: string
  phoneNumberId: string
  wabaId?: string
  accessToken: string
  verifyToken: string
  webhookUrl?: string
  isActive: number
  businessHoursStart: string
  businessHoursEnd: string
  businessDays: number[]
  outsideHoursMessage?: string
  autoReplyDelay: number
  maxAutoRetries: number
  transferAgentPhone?: string
  dailyMessageLimit: number
  createdAt?: string
  updatedAt?: string
}

export interface AiMetricsDailyRecord {
  id: string
  hotelId: string
  date: string
  totalConversations: number
  totalMessages: number
  botResolved: number
  hybridResolved: number
  agentResolved: number
  escalatedToHuman: number
  avgConfidence: number
  avgResponseTimeMs: number
  avgSatisfaction: number
  topIntents?: Record<string, unknown>[]
  topCategories?: Record<string, unknown>[]
  messagesByChannel?: Record<string, unknown>
  bookingsGenerated: number
  upsellsAccepted: number
  complaintsResolved: number
}

export interface AiBookingFlowRecord {
  id: string
  conversationId: string
  hotelId: string
  step: BookingFlowStep
  checkIn?: string
  checkOut?: string
  adults: number
  children: number
  preferredRoomType?: string
  selectedRoomId?: string
  selectedRoomType?: string
  totalAmount: number
  currency: string
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  reservationId?: string
  paymentLinkId?: string
  paymentStatus: string
  upsellsOffered?: Record<string, unknown>[]
  completedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface AiVoiceConfigRecord {
  id: string
  hotelId: string
  provider: VoiceProvider
  phoneNumber?: string
  sipEndpoint?: string
  voiceId: string
  welcomeMessage?: string
  transferNumber?: string
  maxCallDuration: number
  isActive: number
  sttModel: string
  llmModel: string
  ttsModel: string
  openaiApiKey?: string
  livekitUrl?: string
  livekitApiKey?: string
  deepseekApiKey?: string
  createdAt?: string
  updatedAt?: string
}

export interface AiConversationDTO {
  id: string
  hotelId: string
  guestId?: string
  reservationId?: string
  channel: ConversationChannel
  channelConversationId?: string
  guestPhone?: string
  guestName?: string
  language: string
  status: ConversationStatus
  resolvedBy?: ConversationResolvedBy
  assignedAgentId?: string
  satisfactionScore?: number
  startedAt: string
  endedAt?: string
  lastMessageAt?: string
  intentSummary?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateAiConversationDTO {
  hotelId: string
  guestId?: string
  reservationId?: string
  channel: ConversationChannel
  channelConversationId?: string
  guestPhone?: string
  guestName?: string
  language?: string
}

export interface UpdateAiConversationDTO {
  status?: ConversationStatus
  resolvedBy?: ConversationResolvedBy
  assignedAgentId?: string
  satisfactionScore?: number
  endedAt?: string
  lastMessageAt?: string
  intentSummary?: string
  tags?: string[]
}

export interface AiMessageDTO {
  id: string
  conversationId: string
  hotelId: string
  sender: MessageSender
  content: string
  contentType: MessageContentType
  mediaUrl?: string
  intentDetected?: string
  confidence?: number
  actionTaken?: string
  actionResult?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateAiMessageDTO {
  conversationId: string
  hotelId: string
  sender: MessageSender
  content: string
  contentType?: MessageContentType
  mediaUrl?: string
  intentDetected?: string
  confidence?: number
  actionTaken?: string
  actionResult?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface AiIntentDTO {
  id: string
  hotelId: string
  name: string
  category: IntentCategory
  triggerPhrases: string[]
  responseTemplate: string
  action?: string
  actionPayload?: Record<string, unknown>
  fallbackResponse?: string
  priority: number
  confidenceThreshold: number
  requiresAuth: number
  isSystem: number
  isActive: number
  createdAt: string
  updatedAt: string
}

export interface CreateAiIntentDTO {
  hotelId: string
  name: string
  category?: IntentCategory
  triggerPhrases: string[]
  responseTemplate: string
  action?: string
  actionPayload?: Record<string, unknown>
  fallbackResponse?: string
  priority?: number
  confidenceThreshold?: number
}

export interface UpdateAiIntentDTO {
  name?: string
  category?: IntentCategory
  triggerPhrases?: string[]
  responseTemplate?: string
  action?: string
  actionPayload?: Record<string, unknown>
  fallbackResponse?: string
  priority?: number
  confidenceThreshold?: number
  isActive?: number
}

export interface AiTemplateDTO {
  id: string
  hotelId: string
  name: string
  category: TemplateCategory
  trigger?: string
  responseEs: string
  responseEn?: string
  responsePt?: string
  channel: string
  variables?: string[]
  buttons?: Record<string, unknown>[]
  isSystem: number
  isActive: number
  createdAt: string
  updatedAt: string
}

export interface CreateAiTemplateDTO {
  hotelId: string
  name: string
  category: TemplateCategory
  trigger?: string
  responseEs: string
  responseEn?: string
  responsePt?: string
  channel?: string
  variables?: string[]
  buttons?: Record<string, unknown>[]
}

export interface UpdateAiTemplateDTO {
  name?: string
  category?: TemplateCategory
  trigger?: string
  responseEs?: string
  responseEn?: string
  responsePt?: string
  channel?: string
  variables?: string[]
  buttons?: Record<string, unknown>[]
  isActive?: number
}

export interface ConversationQuery {
  hotelId?: string
  status?: ConversationStatus
  channel?: ConversationChannel
  assignedAgentId?: string
  search?: string
  resolvedBy?: ConversationResolvedBy
  page?: number
  limit?: number
}

export interface ConversationPaginated {
  data: AiConversationDTO[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface IntentQuery {
  hotelId?: string
  category?: IntentCategory
  isActive?: number
  page?: number
  limit?: number
}

export interface TemplateQuery {
  hotelId?: string
  category?: TemplateCategory
  isActive?: number
  page?: number
  limit?: number
}

export interface AiWhatsappConfigDTO {
  id: string
  hotelId: string
  phoneNumberId: string
  wabaId?: string
  accessToken: string
  verifyToken: string
  webhookUrl?: string
  isActive: number
  businessHoursStart: string
  businessHoursEnd: string
  businessDays: number[]
  outsideHoursMessage?: string
  autoReplyDelay: number
  maxAutoRetries: number
  transferAgentPhone?: string
  dailyMessageLimit: number
  createdAt: string
  updatedAt: string
  // Identidad de la conexión oficial con Meta (la escribe el servidor, ver model.ts)
  displayPhoneNumber?: string
  verifiedName?: string
  businessName?: string
  qualityRating?: string
  messagingLimit?: string
  accountReviewStatus?: string
  connectedAt?: string
  connectedByUserId?: string
  connectionError?: string
}

export interface CreateAiWhatsappConfigDTO {
  hotelId: string
  phoneNumberId: string
  wabaId?: string
  accessToken: string
  verifyToken: string
  businessHoursStart?: string
  businessHoursEnd?: string
  businessDays?: number[]
  outsideHoursMessage?: string
  autoReplyDelay?: number
  maxAutoRetries?: number
  transferAgentPhone?: string
  dailyMessageLimit?: number
}

export interface AiMetricsDTO {
  id: string
  hotelId: string
  date: string
  totalConversations: number
  totalMessages: number
  botResolved: number
  hybridResolved: number
  agentResolved: number
  escalatedToHuman: number
  avgConfidence: number
  avgResponseTimeMs: number
  avgSatisfaction: number
  topIntents?: Record<string, unknown>[]
  topCategories?: Record<string, unknown>[]
  messagesByChannel?: Record<string, unknown>
  bookingsGenerated: number
  upsellsAccepted: number
  complaintsResolved: number
}

export interface NlpResult {
  intent: AiIntentDTO | null
  confidence: number
  matchedPhrase?: string
  fallback: boolean
}

export interface BotResponse {
  text: string
  actionTaken?: string
  actionResult?: Record<string, unknown>
  intentDetected?: string
  confidence?: number
  buttons?: Record<string, unknown>[]
}

export interface AiRecepcionistaRepos {
  conversation: any
  message: any
  intent: any
  template: any
  whatsappConfig: any
  metrics: any
  bookingFlow: any
  voiceConfig: any
}
