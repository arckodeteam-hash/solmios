import { createModule, OrmRepository } from 'arckode-framework'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'
import { registerAiRecepcionistaModels } from './model'
import { AiRecepcionistaService } from './service'
import { AiRecepcionistaController } from './controller'
import type {
  AiConversationDTO, CreateAiConversationDTO, UpdateAiConversationDTO,
  AiMessageDTO, CreateAiMessageDTO,
  AiIntentDTO, CreateAiIntentDTO, UpdateAiIntentDTO,
  AiTemplateDTO, CreateAiTemplateDTO, UpdateAiTemplateDTO,
  AiWhatsappConfigDTO, CreateAiWhatsappConfigDTO,
  AiMetricsDTO,
  AiBookingFlowRecord,
  AiVoiceConfigRecord,
} from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { AiRecepcionistaService }
export type {
  AiConversationDTO, CreateAiConversationDTO, UpdateAiConversationDTO,
  AiMessageDTO, CreateAiMessageDTO,
  AiIntentDTO, CreateAiIntentDTO, UpdateAiIntentDTO,
  AiTemplateDTO, CreateAiTemplateDTO, UpdateAiTemplateDTO,
  AiWhatsappConfigDTO, CreateAiWhatsappConfigDTO,
  AiMetricsDTO,
  AiBookingFlowRecord,
  AiVoiceConfigRecord,
} from './types'
export type { AiRecepcionistaSockets } from './sockets'
export { AiRecepcionistaValidator, CreateConversationSchema, CreateMessageSchema, CreateIntentSchema, CreateTemplateSchema } from './validators/schema'

export function AiRecepcionistaModule() {
  return createModule({
    name: 'ai-recepcionista',
    version: '1.0.0',
    description: 'Recepcionista Virtual con IA — atención multicanal al huésped (WhatsApp, webchat, email, voice)',
    contract: {
      name: 'ai-recepcionista',
      version: '1.0.0',
      description: 'AI receptionist: conversations, NLP, WhatsApp, booking flows, escalation, metrics',
      actions: [
        'listConversations', 'getConversation', 'findOrCreateConversation', 'closeConversation', 'transferConversation',
        'sendMessage', 'getMessages', 'processIncomingMessage',
        'listIntents', 'createIntent', 'updateIntent', 'deleteIntent', 'testIntent',
        'listTemplates', 'createTemplate', 'updateTemplate', 'deleteTemplate',
        'getWhatsappConfig', 'updateWhatsappConfig', 'connectWhatsapp', 'getWhatsappConnection', 'disconnectWhatsapp', 'listarBandeja', 'abrirConversacion', 'tomarConversacion', 'soltarConversacion', 'responderConversacion',
        'getMetrics', 'getDashboardMetrics',
        'getBookingFlow', 'createBookingFlow', 'updateBookingFlow',
        'getVoiceConfig',
      ],
      events: [
        'onConversationStarted', 'onMessageReceived', 'onBotReplied',
        'onConversationTransferred', 'onConversationClosed',
        'onIncidentRegistered', 'onBookingCreated', 'onPaymentRequested',
        'onEscalatedToHuman',
      ],
      tables: [
        'ai_conversations', 'ai_messages', 'ai_intents', 'ai_templates',
        'ai_whatsapp_config', 'ai_metrics_daily', 'ai_booking_flows', 'ai_voice_config',
      ],
      dependencies: [],
      rules: ['No importar de otros módulos', 'RepositoryAdapter<T>', 'Validación en controller'],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('ai-recepcionista: auth dependency required')
      registerAiRecepcionistaModels(orm)

      const conversationRepo = new OrmRepository<AiConversationDTO>(orm, 'AiConversations')
      const messageRepo = new OrmRepository<AiMessageDTO>(orm, 'AiMessages')
      const intentRepo = new OrmRepository<AiIntentDTO>(orm, 'AiIntents')
      const templateRepo = new OrmRepository<AiTemplateDTO>(orm, 'AiTemplates')
      const whatsappConfigRepo = new OrmRepository<AiWhatsappConfigDTO>(orm, 'AiWhatsappConfig')
      const metricsRepo = new OrmRepository<AiMetricsDTO>(orm, 'AiMetricsDaily')
      const bookingFlowRepo = new OrmRepository<AiBookingFlowRecord>(orm, 'AiBookingFlows')
      const voiceConfigRepo = new OrmRepository<AiVoiceConfigRecord>(orm, 'AiVoiceConfig')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      const hotelRepo = new OrmRepository<any>(orm, 'Hotels')
      const roomRepo = new OrmRepository<any>(orm, 'Rooms')
      const reservationRepo = new OrmRepository<any>(orm, 'Reservations')
      // Sin repo de links ni de facturas: la IA ya no escribe esas tablas a mano. Los links van a
      // derivar a `payment-requests` y las facturas ya pasan por el connector `ai-facturas`.
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const guestRepo = new OrmRepository<any>(orm, 'Guests')

      const log = logger.child('ai-recepcionista')

      // Callback: when AI creates a reservation, push availability to Channex.
      // system.resolveModule is NOT available inside create(); the pusher is injected from
      // composition-root via service.channexPusher (see composition-root.ts).
      let service: AiRecepcionistaService
      const onReservationCreated = async (hotelId: string, roomId: string) => {
        try { service?.channexPusher?.(hotelId, roomId) } catch {}
      }
      service = new AiRecepcionistaService(
        conversationRepo, messageRepo, intentRepo, templateRepo,
        whatsappConfigRepo, metricsRepo, bookingFlowRepo, voiceConfigRepo,
        userRepo, hotelRepo, roomRepo, reservationRepo, configRepo,
        guestRepo,
        log, cache, auth!, onReservationCreated,
      )
      const controller = new AiRecepcionistaController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('ai.receptionist')]

      router.get('/api/ai/conversations', guard('ai', 'view'), (req) => controller.index(req))
      router.get('/api/ai/conversations/:id', guard('ai', 'view'), (req) => controller.show(req))
      router.post('/api/ai/conversations/:id/close', guard('ai', 'edit'), (req) => controller.close(req))
      router.post('/api/ai/conversations/:id/transfer', guard('ai', 'edit'), (req) => controller.transfer(req))
      router.post('/api/ai/conversations/:id/messages', guard('ai', 'edit'), (req) => controller.sendMessage(req))

      router.get('/api/ai/intents', guard('ai', 'edit'), (req) => controller.listIntents(req))
      router.get('/api/ai/intents/:id', guard('ai', 'edit'), (req) => controller.getIntent(req))
      router.post('/api/ai/intents', guard('ai', 'edit'), (req) => controller.createIntent(req))
      router.put('/api/ai/intents/:id', guard('ai', 'edit'), (req) => controller.updateIntent(req))
      router.delete('/api/ai/intents/:id', guard('ai', 'edit'), (req) => controller.deleteIntent(req))
      router.post('/api/ai/intents/:id/test', guard('ai', 'edit'), (req) => controller.testIntent(req))

      router.get('/api/ai/templates', guard('ai', 'edit'), (req) => controller.listTemplates(req))
      router.post('/api/ai/templates', guard('ai', 'edit'), (req) => controller.createTemplate(req))
      router.put('/api/ai/templates/:id', guard('ai', 'edit'), (req) => controller.updateTemplate(req))
      router.delete('/api/ai/templates/:id', guard('ai', 'edit'), (req) => controller.deleteTemplate(req))

      router.get('/api/ai/whatsapp/config', guard('ai', 'edit'), (req) => controller.getWhatsappConfig(req))
      router.put('/api/ai/whatsapp/config', guard('ai', 'edit'), (req) => controller.updateWhatsappConfig(req))
      router.post('/api/ai/whatsapp/start', guard('ai', 'edit'), (req) => controller.startWhatsapp(req))
      router.post('/api/ai/whatsapp/stop', guard('ai', 'edit'), (req) => controller.stopWhatsapp(req))
      router.get('/api/ai/whatsapp/qr/:hotelId?', guard('ai', 'edit'), (req) => controller.getWhatsappQR(req))
      router.get('/api/ai/whatsapp/status/:hotelId?', guard('ai', 'edit'), (req) => controller.getWhatsappStatus(req))
      // Conexión oficial con Meta. `settings` y no `ai`: conectar el WhatsApp del hotel es una
      // decisión de configuración del negocio, no del recepcionista automático.
      router.post('/api/ai/whatsapp/connect', guard('settings', 'edit'), (req) => controller.connectWhatsapp(req))
      router.get('/api/ai/whatsapp/connection', guard('settings', 'view'), (req) => controller.getWhatsappConnection(req))
      router.delete('/api/ai/whatsapp/connection', guard('settings', 'edit'), (req) => controller.disconnectWhatsapp(req))
      // Bandeja: conversaciones con el huésped. Permiso `ai` porque es atención, no configuración.
      router.get('/api/ai/inbox', guard('ai', 'view'), (req) => controller.inbox(req))
      router.get('/api/ai/inbox/:id', guard('ai', 'view'), (req) => controller.getInboxConversation(req))
      router.post('/api/ai/inbox/:id/take', guard('ai', 'edit'), (req) => controller.takeConversation(req))
      router.post('/api/ai/inbox/:id/release', guard('ai', 'edit'), (req) => controller.releaseConversation(req))
      router.post('/api/ai/inbox/:id/reply', guard('ai', 'edit'), (req) => controller.replyConversation(req))

      // Endpoints públicos (sin auth): cada mensaje dispara una llamada a la LLM, que cuesta plata.
      // El rate-limit global (200/min/IP) es compartido con toda la API; sin un límite propio, un
      // anónimo puede quemar la API key de la LLM a ritmo industrial. #397.
      const aiRateLimited = async (req: any, handler: (r: any) => any) => {
        const { allowed, retryAfter } = await rateLimit(`ai-public:${getClientIp(req)}`)
        if (!allowed) return { status: 429, body: { error: `Demasiadas solicitudes. Intentá en ${retryAfter} segundos` } }
        return handler(req)
      }

      // Public webhook endpoints. El verify (GET) no gasta LLM; el receive (POST) sí.
      router.get('/api/ai/whatsapp/webhook/:hotelId', (req) => controller.whatsappWebhookVerify(req))
      router.post('/api/ai/whatsapp/webhook/:hotelId', async (req) => aiRateLimited(req, (r) => controller.whatsappWebhookReceive(r)))

      router.post('/api/ai/chat/:slug', async (req) => aiRateLimited(req, (r) => controller.webChatMessage(r)))

      router.get('/api/ai/metrics', guard('ai', 'view'), (req) => controller.metrics(req))
      router.get('/api/ai/metrics/dashboard', guard('ai', 'view'), (req) => controller.dashboardMetrics(req))

      log.info('Módulo ai-recepcionista listo')
      // Auto-reconnect WhatsApp sessions that were active before restart
      service.autoReconnectSessions().catch(() => {})
      return service
    },
  })
}
