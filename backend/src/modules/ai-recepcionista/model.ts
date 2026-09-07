import type { ModelDefinition, ORM } from 'arckode-framework'

export const AiConversationsModel: ModelDefinition = {
  table: 'ai_conversations',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    guestId: { type: 'string' },
    reservationId: { type: 'string' },
    channel: { type: 'string', required: true },
    channelConversationId: { type: 'string', indexed: true },
    guestPhone: { type: 'string' },
    guestName: { type: 'string' },
    language: { type: 'string', default: 'es' },
    status: { type: 'string', default: 'active' },
    resolvedBy: { type: 'string' },
    assignedAgentId: { type: 'string' },
    satisfactionScore: { type: 'number' },
    startedAt: { type: 'string', required: true },
    endedAt: { type: 'string' },
    lastMessageAt: { type: 'string' },
    intentSummary: { type: 'string' },
    tags: { type: 'json', default: [] },
  },
  timestamps: true,
}

export const AiMessagesModel: ModelDefinition = {
  table: 'ai_messages',
  fields: {
    id: { type: 'string', required: true },
    conversationId: { type: 'string', required: true, indexed: true },
    hotelId: { type: 'string', required: true, indexed: true },
    sender: { type: 'string', required: true },
    content: { type: 'text', required: true },
    contentType: { type: 'string', default: 'text' },
    mediaUrl: { type: 'string' },
    intentDetected: { type: 'string' },
    confidence: { type: 'number' },
    actionTaken: { type: 'string' },
    actionResult: { type: 'json' },
    metadata: { type: 'json' },
  },
  timestamps: true,
}

export const AiIntentsModel: ModelDefinition = {
  table: 'ai_intents',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    category: { type: 'string', default: 'general' },
    triggerPhrases: { type: 'json', required: true },
    responseTemplate: { type: 'text', required: true },
    action: { type: 'string' },
    actionPayload: { type: 'json' },
    fallbackResponse: { type: 'text' },
    priority: { type: 'number', default: 0 },
    confidenceThreshold: { type: 'number', default: 0.65 },
    requiresAuth: { type: 'number', default: 0 },
    isSystem: { type: 'number', default: 0 },
    isActive: { type: 'number', default: 1 },
  },
  timestamps: true,
}

export const AiTemplatesModel: ModelDefinition = {
  table: 'ai_templates',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    category: { type: 'string', required: true },
    trigger: { type: 'string' },
    responseEs: { type: 'text', required: true },
    responseEn: { type: 'text' },
    responsePt: { type: 'text' },
    channel: { type: 'string', default: 'all' },
    variables: { type: 'json', default: [] },
    buttons: { type: 'json' },
    isSystem: { type: 'number', default: 0 },
    isActive: { type: 'number', default: 1 },
  },
  timestamps: true,
}

export const AiWhatsappConfigModel: ModelDefinition = {
  table: 'ai_whatsapp_config',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, unique: true },
    connectionMode: { type: 'string', default: 'baileys' },
    connectionStatus: { type: 'string', default: 'disconnected' },
    phoneNumberId: { type: 'string' },
    wabaId: { type: 'string' },
    accessToken: { type: 'string' },
    verifyToken: { type: 'string' },
    baileysCredentials: { type: 'json' },
    webhookUrl: { type: 'string' },
    isActive: { type: 'number', default: 0 },
    businessHoursStart: { type: 'string', default: '08:00' },
    businessHoursEnd: { type: 'string', default: '22:00' },
    businessDays: { type: 'json', default: [1, 2, 3, 4, 5, 6, 7] },
    outsideHoursMessage: { type: 'text' },
    autoReplyDelay: { type: 'number', default: 1000 },
    maxAutoRetries: { type: 'number', default: 3 },
    transferAgentPhone: { type: 'string' },
    dailyMessageLimit: { type: 'number', default: 1000 },
    llmProvider: { type: 'string', default: 'deepseek' },
    llmModel: { type: 'string' },
    llmApiKey: { type: 'string' },
    botName: { type: 'string', default: 'Sofía' },
    // ─── Identidad de la conexión oficial con Meta ──────────────────────────────
    // Lo que el hotel necesita VER para confiar en que quedó conectado, más lo mínimo para
    // diagnosticar cuando algo falle. Lo escribe SOLO el servidor, con lo que contesta Meta.
    /** Número legible, como lo devuelve Meta: "+1 809 555 0000". */
    displayPhoneNumber: { type: 'string' },
    /** Nombre del negocio aprobado por Meta. Si dice otra cosa, se conectó la cuenta equivocada. */
    verifiedName: { type: 'string' },
    /** Portfolio comercial dueño de la cuenta de WhatsApp. */
    businessName: { type: 'string' },
    /** GREEN | YELLOW | RED. Si baja, Meta restringe el envío: hay que verlo antes del corte. */
    qualityRating: { type: 'string' },
    /** Tope de conversaciones/día que informa Meta. Explica un "no se envió" que no es un bug. */
    messagingLimit: { type: 'string' },
    /** Si el negocio del hotel está verificado ante Meta. */
    accountReviewStatus: { type: 'string' },
    connectedAt: { type: 'string' },
    /** `users.id` de quien conectó. La conexión mueve el WhatsApp de un negocio real: se audita. */
    connectedByUserId: { type: 'string' },
    /** Último error de Meta, ya traducido, para que el panel diga QUÉ pasó y no "no conectado". */
    connectionError: { type: 'string' },
  },
  timestamps: true,
}

export const AiMetricsDailyModel: ModelDefinition = {
  table: 'ai_metrics_daily',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    date: { type: 'string', required: true },
    totalConversations: { type: 'number', default: 0 },
    totalMessages: { type: 'number', default: 0 },
    botResolved: { type: 'number', default: 0 },
    hybridResolved: { type: 'number', default: 0 },
    agentResolved: { type: 'number', default: 0 },
    escalatedToHuman: { type: 'number', default: 0 },
    avgConfidence: { type: 'number', default: 0 },
    avgResponseTimeMs: { type: 'number', default: 0 },
    avgSatisfaction: { type: 'number', default: 0 },
    topIntents: { type: 'json' },
    topCategories: { type: 'json' },
    messagesByChannel: { type: 'json' },
    bookingsGenerated: { type: 'number', default: 0 },
    upsellsAccepted: { type: 'number', default: 0 },
    complaintsResolved: { type: 'number', default: 0 },
  },
  timestamps: false,
}

export const AiBookingFlowsModel: ModelDefinition = {
  table: 'ai_booking_flows',
  fields: {
    id: { type: 'string', required: true },
    conversationId: { type: 'string', required: true, indexed: true },
    hotelId: { type: 'string', required: true, indexed: true },
    step: { type: 'string', default: 'init' },
    checkIn: { type: 'string' },
    checkOut: { type: 'string' },
    adults: { type: 'number', default: 1 },
    children: { type: 'number', default: 0 },
    preferredRoomType: { type: 'string' },
    selectedRoomId: { type: 'string' },
    selectedRoomType: { type: 'string' },
    totalAmount: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    guestName: { type: 'string' },
    guestEmail: { type: 'string' },
    guestPhone: { type: 'string' },
    reservationId: { type: 'string' },
    paymentLinkId: { type: 'string' },
    paymentStatus: { type: 'string', default: 'pending' },
    upsellsOffered: { type: 'json' },
    completedAt: { type: 'string' },
  },
  timestamps: true,
}

export const AiVoiceConfigModel: ModelDefinition = {
  table: 'ai_voice_config',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, unique: true },
    provider: { type: 'string', default: 'lowcost' },
    phoneNumber: { type: 'string' },
    sipEndpoint: { type: 'string' },
    voiceId: { type: 'string', default: 'es-MX-DaliaNeural' },
    welcomeMessage: { type: 'text' },
    transferNumber: { type: 'string' },
    maxCallDuration: { type: 'number', default: 600 },
    isActive: { type: 'number', default: 0 },
    sttModel: { type: 'string', default: 'whisper-large-v3' },
    llmModel: { type: 'string', default: 'deepseek-chat' },
    ttsModel: { type: 'string', default: 'edge-tts-es-MX-Dalia' },
    openaiApiKey: { type: 'string' },
    livekitUrl: { type: 'string' },
    livekitApiKey: { type: 'string' },
    deepseekApiKey: { type: 'string' },
  },
  timestamps: true,
}

export function registerAiRecepcionistaModels(orm: ORM): void {
  orm.define('AiConversations', AiConversationsModel)
  orm.define('AiMessages', AiMessagesModel)
  orm.define('AiIntents', AiIntentsModel)
  orm.define('AiTemplates', AiTemplatesModel)
  orm.define('AiWhatsappConfig', AiWhatsappConfigModel)
  orm.define('AiMetricsDaily', AiMetricsDailyModel)
  orm.define('AiBookingFlows', AiBookingFlowsModel)
  orm.define('AiVoiceConfig', AiVoiceConfigModel)
  // Register Configuration model if not already registered
  try {
    orm.define('Configuration', {
      table: 'configuration', timestamps: true,
      fields: {
        id: { type: 'string', required: true },
        hotelId: { type: 'string', required: true },
        key: { type: 'string', required: true, indexed: true },
        value: { type: 'json', default: {} },
      },
    })
  } catch {}
}
