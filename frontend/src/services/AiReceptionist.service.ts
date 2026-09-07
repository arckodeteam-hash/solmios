import { http } from './http'

export interface AiConversation {
  id: string
  hotelId: string
  guestId?: string
  channel: string
  guestPhone?: string
  guestName?: string
  language: string
  status: 'active' | 'resolved' | 'transferred' | 'waiting'
  resolvedBy?: string
  assignedAgentId?: string
  satisfactionScore?: number
  startedAt: string
  lastMessageAt?: string
  intentSummary?: string
  tags?: string[]
  createdAt: string
}

export interface AiMessage {
  id: string
  conversationId: string
  sender: 'guest' | 'bot' | 'agent'
  content: string
  contentType: string
  intentDetected?: string
  confidence?: number
  actionTaken?: string
  createdAt: string
}

export interface AiIntent {
  id: string
  hotelId: string
  name: string
  category: string
  triggerPhrases: string[]
  responseTemplate: string
  action?: string
  fallbackResponse?: string
  priority: number
  confidenceThreshold: number
  isSystem: number
  isActive: number
}

export interface AiTemplate {
  id: string
  hotelId: string
  name: string
  category: string
  responseEs: string
  responseEn?: string
  responsePt?: string
  channel: string
  variables?: string[]
  isSystem: number
  isActive: number
}

export interface AiWhatsappConfig {
  id: string
  hotelId: string
  connectionMode: 'baileys' | 'meta'
  connectionStatus: string
  phoneNumberId?: string
  accessToken?: string
  verifyToken?: string
  isActive: number
  businessHoursStart: string
  businessHoursEnd: string
  outsideHoursMessage?: string
  transferAgentPhone?: string
  llmProvider?: string
  llmModel?: string
  botName?: string
}

/** Estados que puede mostrar la tarjeta de conexión. */
export type EstadoConexionWhatsapp = 'disconnected' | 'connected' | 'error' | 'legacy_baileys'

/**
 * Proyección segura de la conexión: lo que el hotel necesita ver para reconocer su cuenta.
 * El token del hotel NUNCA viaja al navegador.
 */
export interface WhatsappConnection {
  estado: EstadoConexionWhatsapp
  displayPhoneNumber: string | null
  verifiedName: string | null
  businessName: string | null
  qualityRating: string | null
  messagingLimit: string | null
  accountReviewStatus: string | null
  connectedAt: string | null
  connectionError: string | null
}

export const AiReceptionistService = {
  async listConversations(params?: Record<string, any>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return http.get<{ data: AiConversation[]; total: number }>(`/ai/conversations${qs}`)
  },
  async getConversation(id: string) {
    return http.get<{ conversation: AiConversation; messages: AiMessage[] }>(`/ai/conversations/${id}`)
  },
  async sendMessage(conversationId: string, content: string) {
    return http.post<AiMessage>(`/ai/conversations/${conversationId}/messages`, {
      conversationId,
      sender: 'agent',
      content,
      contentType: 'text',
    })
  },
  async closeConversation(id: string, resolvedBy = 'agent', score?: number) {
    return http.post<AiConversation>(`/ai/conversations/${id}/close`, { resolvedBy, satisfactionScore: score })
  },
  async transferConversation(id: string, agentId: string | null) {
    return http.post<AiConversation>(`/ai/conversations/${id}/transfer`, { agentId })
  },

  async listIntents(params?: Record<string, any>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return http.get<{ data: AiIntent[]; total: number }>(`/ai/intents${qs}`)
  },
  async createIntent(data: Partial<AiIntent>) {
    return http.post<AiIntent>('/ai/intents', data)
  },
  async updateIntent(id: string, data: Partial<AiIntent>) {
    return http.put<AiIntent>(`/ai/intents/${id}`, data)
  },
  async deleteIntent(id: string) {
    return http.delete(`/ai/intents/${id}`)
  },
  async testIntent(id: string, message: string) {
    return http.post<{ intent: AiIntent | null; confidence: number }>(`/ai/intents/${id}/test`, { message })
  },

  async listTemplates(params?: Record<string, any>) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return http.get<{ data: AiTemplate[]; total: number }>(`/ai/templates${qs}`)
  },
  async createTemplate(data: Partial<AiTemplate>) {
    return http.post<AiTemplate>('/ai/templates', data)
  },
  async updateTemplate(id: string, data: Partial<AiTemplate>) {
    return http.put<AiTemplate>(`/ai/templates/${id}`, data)
  },
  async deleteTemplate(id: string) {
    return http.delete(`/ai/templates/${id}`)
  },

  async getWhatsappConfig(hotelId?: string) {
    const qs = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get<AiWhatsappConfig>(`/ai/whatsapp/config${qs}`)
  },
  async updateWhatsappConfig(data: Partial<AiWhatsappConfig>) {
    return http.put<AiWhatsappConfig>('/ai/whatsapp/config', data)
  },
  async startWhatsappSession(hotelId: string) {
    return http.post<{ qr: string | null; status: string }>('/ai/whatsapp/start', { hotelId })
  },
  async stopWhatsappSession(hotelId: string) {
    return http.post<{ success: boolean }>('/ai/whatsapp/stop', { hotelId })
  },
  async getWhatsappQR(hotelId: string) {
    return http.get<{ qr: string | null; status: string }>(`/ai/whatsapp/qr/${hotelId}`)
  },
  async getWhatsappStatus(hotelId: string) {
    return http.get<{ status: string; phone: string | null; mode: string }>(`/ai/whatsapp/status/${hotelId}`)
  },

  // ─── Conexión oficial con Meta (Embedded Signup) ───────────────────────────
  /** Canjea, en el servidor, el código que devolvió la ventana de Meta. */
  async connectWhatsapp(payload: { code: string; phoneNumberId: string; wabaId: string }) {
    return http.post<WhatsappConnection>('/ai/whatsapp/connect', payload)
  },
  /** Estado de la conexión para la tarjeta. Nunca trae el token. */
  async getWhatsappConnection() {
    return http.get<WhatsappConnection>('/ai/whatsapp/connection')
  },
  async disconnectWhatsapp() {
    return http.delete<{ success: boolean }>('/ai/whatsapp/connection')
  },

  async getMetrics(period = 'today') {
    return http.get<{ data: any[] }>(`/ai/metrics?period=${period}`)
  },
  async getDashboardMetrics() {
    return http.get<{ activeConversations: number; transferredConversations: number; waitingConversations: number; todayMetrics: any }>('/ai/metrics/dashboard')
  },
}
