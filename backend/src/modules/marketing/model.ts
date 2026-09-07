// marketing/model.ts — 3 tablas de marketing automatizado
import type { ModelDefinition, ORM } from 'arckode-framework'

const AutoMessageModel: ModelDefinition = {
  table: 'auto_messages',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    title: { type: 'string', required: true },
    color: { type: 'string', default: '#3b82f6' },
    emailSubject: { type: 'string' },
    emailBody: { type: 'string' },
    whatsappBody: { type: 'string' },
    channel: { type: 'string', default: 'email' },
    triggerEvent: { type: 'string', required: true, default: 'checkin_day' },
    triggerOffset: { type: 'number', default: 0 },
    variables: { type: 'json', default: '[]' },
    isActive: { type: 'boolean', default: 1 },
    // Notification templates configurable + i18n (spec 11.1.6).
    // event: override opcional. null = no aplica a ningún evento (fix H1: 'checkin' estaba fuera del enum de validación).
    event: { type: 'string' },
    language: { type: 'string', default: 'es' },
    triggerType: { type: 'string', default: 'cron' },
  },
  timestamps: true,
}

const MessageLogModel: ModelDefinition = {
  table: 'message_logs',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    reservationId: { type: 'string' },
    // Dedupe de triggers de HUÉSPED (birthday/win-back): sin reserva, la clave es el guest.
    guestId: { type: 'string', indexed: true },
    messageId: { type: 'string' },
    messageType: { type: 'string', default: 'email' },
    status: { type: 'string', default: 'pending' },
    recipient: { type: 'string' },
    response: { type: 'string' },
    sentAt: { type: 'string' },
  },
  timestamps: true,
}

const WhatsappTemplateModel: ModelDefinition = {
  table: 'whatsapp_templates',
  fields: {
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    body: { type: 'string' },
    category: { type: 'string', default: 'general' },
    // ─── Sincronización con Meta (WhatsApp Business Platform) ───────────────────
    // Una plantilla vive en DOS lados: acá y en la cuenta de WhatsApp del hotel. Meta es
    // dueño del estado (aprueba o rechaza), nosotros del texto. Estos campos son la copia
    // local de lo que Meta contesta — se escriben SOLO desde el servidor, nunca desde el form.
    language: { type: 'string', default: 'es' },
    /** Nombres de las variables en el orden en que Meta las numeró: [0] es {{1}}. */
    metaVariableOrder: { type: 'json', default: [] },
    /** Categoría de META (MARKETING/UTILITY/AUTHENTICATION), distinta de la nuestra. */
    metaCategory: { type: 'string', default: 'UTILITY' },
    metaTemplateId: { type: 'string' },
    /** 'none' (nunca se envió) · 'pending' · 'approved' · 'rejected' */
    approvalStatus: { type: 'string', default: 'none' },
    metaRejectedReason: { type: 'string' },
    metaSyncedAt: { type: 'string' },
    isActive: { type: 'boolean', default: 1 },
  },
  timestamps: true,
}

export function registerMarketingModels(orm: ORM): void {
  orm.define('AutoMessages', AutoMessageModel)
  orm.define('MessageLogs', MessageLogModel)
  orm.define('WhatsappTemplates', WhatsappTemplateModel)
}
