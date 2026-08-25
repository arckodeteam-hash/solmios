// marketing/types.ts

/** Usuario autenticado mínimo requerido para checks de ownership multi-tenant. */
export interface MarketingUser {
  id: string
  role: string
  hotelId?: string
}

export interface AutoMessageDTO {
  id: string; hotelId: string; title: string; color: string
  emailSubject: string; emailBody: string; whatsappBody: string
  channel: string; triggerEvent: string; triggerOffset: number
  /** COR-7: el modelo declara `type:'boolean'` → el ORM deserializa y el wire RESPONDE boolean (0|1 sólo entra por los schemas de escritura). */
  variables: string | null; isActive: boolean
  event: string; language: string; triggerType: string
  createdAt: string; updatedAt: string
}

export interface CreateAutoMessageDTO {
  hotelId: string; title: string; color?: string
  emailSubject?: string; emailBody?: string; whatsappBody?: string
  channel?: string; triggerEvent?: string; triggerOffset?: number
  variables?: string
  /** Wire: 0/1 (CreateAutoMessageSchema `type:'number'`); boolean legacy tolerado. El service normaliza. */
  isActive?: boolean | number
  event?: string; language?: string; triggerType?: string
}

export interface MessageLogDTO {
  id: string; hotelId: string; reservationId: string | null
  messageId: string | null; messageType: string; status: string
  recipient: string | null; response: string | null; sentAt: string | null
  createdAt: string
}

export interface CreateMessageLogDTO {
  hotelId: string; reservationId?: string; messageId?: string
  messageType?: string; status?: string; recipient?: string; response?: string
}

export interface WhatsappTemplateDTO {
  id: string; hotelId: string; name: string; body: string
  /** COR-7: idem AutoMessageDTO — respuesta boolean; 0|1 es sólo el formato de escritura. */
  category: string; isActive: boolean
  createdAt: string; updatedAt: string
}

export interface CreateWhatsappTemplateDTO {
  hotelId: string; name: string; body?: string; category?: string
  /** Wire: 0/1 (CreateTemplateSchema `type:'number'`); boolean legacy tolerado. El service normaliza. */
  isActive?: boolean | number
}
