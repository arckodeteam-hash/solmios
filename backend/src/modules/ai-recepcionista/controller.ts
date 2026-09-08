import type { Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { AiRecepcionistaService } from './service'
import { AiRecepcionistaValidator, CloseConversationSchema, TransferConversationSchema, TestIntentSchema, WebChatMessageSchema, StartWhatsappSchema, StopWhatsappSchema, ConnectWhatsappSchema, ReplyConversationSchema } from './validators/schema'
import { redactWhatsappConfig } from './usecases/whatsapp-config'
import { aplicarEstadosDeEntrega } from './usecases/whatsapp-delivery-status'

export class AiRecepcionistaController {
  constructor(
    private readonly service: AiRecepcionistaService,
    private readonly logger: Logger,
  ) {}

  // ─── Conversations ──────────────────────────────────────────────────────

  async index(req: any) {
    const user = req.user || {}
    const query = req.query || {}
    const result = await this.service.listConversations(query, user)
    return { status: 200, body: { data: result.data, total: result.total, page: result.page, limit: result.limit, pages: result.pages } }
  }

  async show(req: any) {
    const user = req.user || {}
    const result = await this.service.getConversation(req.params.id, user)
    return { status: 200, body: result }
  }

  async close(req: any) {
    const user = req.user || {}
    const data = validateSchema(CloseConversationSchema, req.body || {}) as any
    const result = await this.service.closeConversation(req.params.id, data.resolvedBy || 'agent', data.satisfactionScore, user)
    return { status: 200, body: result }
  }

  async transfer(req: any) {
    const user = req.user || {}
    const data = validateSchema(TransferConversationSchema, req.body || {}) as any
    const result = await this.service.transferConversation(req.params.id, data.agentId || null, data.reason, user)
    return { status: 200, body: result }
  }

  // ─── Messages ───────────────────────────────────────────────────────────

  async sendMessage(req: any) {
    const user = req.user || {}
    const body: any = req.body || {}
    validateSchema(AiRecepcionistaValidator.createMessage as any, body)
    const msg = await this.service.sendMessage(req.params.id, body, user)
    return { status: 201, body: msg }
  }

  // ─── Intents ────────────────────────────────────────────────────────────

  async listIntents(req: any) {
    const user = req.user || {}
    const query = req.query || {}
    const hotelId = user.hotelId || ''
    if (hotelId) await this.service.seedSystemIntents(hotelId)
    const result = await this.service.listIntents(query, user)
    return { status: 200, body: result }
  }

  async getIntent(req: any) {
    const user = req.user || {}
    const result = await this.service.getIntent(req.params.id, user)
    return { status: 200, body: result }
  }

  async createIntent(req: any) {
    const user = req.user || {}
    const body: any = req.body || {}
    validateSchema(AiRecepcionistaValidator.createIntent as any, body)
    const result = await this.service.createIntent(body, user)
    return { status: 201, body: result }
  }

  async updateIntent(req: any) {
    const user = req.user || {}
    const body: any = req.body || {}
    validateSchema(AiRecepcionistaValidator.updateIntent as any, body)
    const result = await this.service.updateIntent(req.params.id, body, user)
    return { status: 200, body: result }
  }

  async deleteIntent(req: any) {
    const user = req.user || {}
    await this.service.deleteIntent(req.params.id, user)
    return { status: 200, body: { success: true } }
  }

  async testIntent(req: any) {
    const user = req.user || {}
    const data = validateSchema(TestIntentSchema, req.body || {}) as any
    const result = await this.service.testIntent(req.params.id, data.message, user)
    return { status: 200, body: result }
  }

  // ─── Templates ──────────────────────────────────────────────────────────

  async listTemplates(req: any) {
    const user = req.user || {}
    const query = req.query || {}
    const result = await this.service.listTemplates(query, user)
    return { status: 200, body: result }
  }

  async createTemplate(req: any) {
    const user = req.user || {}
    const body: any = req.body || {}
    validateSchema(AiRecepcionistaValidator.createTemplate as any, body)
    const result = await this.service.createTemplate(body, user)
    return { status: 201, body: result }
  }

  async updateTemplate(req: any) {
    const user = req.user || {}
    const body: any = req.body || {}
    validateSchema(AiRecepcionistaValidator.updateTemplate as any, body)
    const result = await this.service.updateTemplate(req.params.id, body, user)
    return { status: 200, body: result }
  }

  async deleteTemplate(req: any) {
    const user = req.user || {}
    await this.service.deleteTemplate(req.params.id, user)
    return { status: 200, body: { success: true } }
  }

  // ─── WhatsApp Config ────────────────────────────────────────────────────

  async getWhatsappConfig(req: any) {
    const user = req.user || {}
    const config = await this.service.getWhatsappConfig(req.query?.hotelId || '', user)
    // Nunca devolver accessToken/llmApiKey/baileysCredentials al cliente (IA-C1).
    return { status: 200, body: redactWhatsappConfig(config) }
  }

  async updateWhatsappConfig(req: any) {
    const user = req.user || {}
    const body: any = req.body || {}
    validateSchema(AiRecepcionistaValidator.createWhatsappConfig as any, body)
    const result = await this.service.updateWhatsappConfig(body, user)
    return { status: 200, body: redactWhatsappConfig(result) }
  }

  // ─── Conexión oficial con Meta (Embedded Signup) ────────────────────────

  /**
   * Recibe el código de un solo uso que devolvió la ventana de Meta y lo canjea server-side.
   * El `hotelId` sale del token, nunca del body: un merchant no puede conectar el hotel de otro.
   */
  async connectWhatsapp(req: any) {
    const user = req.user
    const body = validateSchema(ConnectWhatsappSchema, req.body || {}) as any
    return { status: 200, body: await this.service.connectWhatsapp(body, user) }
  }

  /** Estado de la conexión para la tarjeta del panel. Nunca incluye el token. */
  async getWhatsappConnection(req: any) {
    const user = req.user
    return { status: 200, body: await this.service.getWhatsappConnection(req.query?.hotelId || '', user) }
  }

  /** Da de baja la conexión. Primero en Meta; si Meta falla, no se toca nada local. */
  async disconnectWhatsapp(req: any) {
    const user = req.user
    await this.service.disconnectWhatsapp(user, req.query?.hotelId || undefined)
    return { status: 200, body: { success: true } }
  }

  /** Lista de hoteles con WhatsApp conectado. Herramienta de soporte del super_admin. */
  async listConnections() {
    return { status: 200, body: { data: await this.service.listarConexiones() } }
  }

  // ─── Consumo de WhatsApp ────────────────────────────────────────────────

  /** Lo que el hotel lleva consumido este mes y contra qué tope. */
  async consumoWhatsapp(req: any) {
    const mes = typeof req.query?.mes === 'string' ? req.query.mes : undefined
    return { status: 200, body: await this.service.consumoDeWhatsapp(req.user, req.query?.hotelId || undefined, mes) }
  }

  /**
   * Trae de Meta el consumo real. Es POST porque escribe: guarda lo que Meta informa.
   * El hotel puede pedirlo para ver el número al día sin esperar al cron.
   */
  async sincronizarConsumoWhatsapp(req: any) {
    const hotelId = req.user?.role === 'super_admin' && req.query?.hotelId ? req.query.hotelId : req.user?.hotelId
    if (!hotelId) return { status: 400, body: { error: 'No se pudo determinar el hotel' } }
    const mes = typeof req.query?.mes === 'string' ? req.query.mes : undefined
    return { status: 200, body: await this.service.sincronizarConsumo(hotelId, mes) }
  }

  // ─── Bandeja de WhatsApp ────────────────────────────────────────────────

  /** Conversaciones de WhatsApp del hotel, la más movida primero. */
  async inbox(req: any) {
    const data = await this.service.listarBandeja(req.user, req.query?.hotelId || undefined, req.query?.estado)
    return { status: 200, body: { data } }
  }

  /** Hilo completo. Abrirla la marca leída: abrir ES haber leído. */
  async getInboxConversation(req: any) {
    return { status: 200, body: await this.service.abrirConversacion(req.params.id, req.user) }
  }

  /** Toma la conversación: el recepcionista automático deja de responderla. */
  async takeConversation(req: any) {
    await this.service.tomarConversacion(req.params.id, req.user)
    return { status: 200, body: { success: true } }
  }

  /** La suelta: el bot vuelve a hacerse cargo. */
  async releaseConversation(req: any) {
    await this.service.soltarConversacion(req.params.id, req.user)
    return { status: 200, body: { success: true } }
  }

  /** Responde con texto libre. La ventana de 24 h la valida el servidor, no el navegador. */
  async replyConversation(req: any) {
    const data = validateSchema(ReplyConversationSchema, req.body || {}) as any
    return { status: 200, body: await this.service.responderConversacion(req.params.id, data.text, req.user) }
  }

  // ─── WhatsApp Webhook ───────────────────────────────────────────────────

  async whatsappWebhookVerify(req: any) {
    const mode = req.query?.['hub.mode']
    const token = req.query?.['hub.verify_token']
    const challenge = req.query?.['hub.challenge']
    const hotelId = req.params?.hotelId

    if (mode === 'subscribe' && token && challenge && hotelId) {
      const configs = await (this.service as any).whatsappConfigRepo.findMany({ hotelId })
      const cfg = configs[0]
      if (cfg && cfg.verifyToken === token) {
        return { status: 200, body: String(challenge), headers: { 'Content-Type': 'text/plain' } }
      }
    }
    return { status: 403, body: 'Verification failed' }
  }

  async whatsappWebhookReceive(req: any) {
    const hotelId = req.params?.hotelId
    const body: any = req.body || {}

    // BUG FIX: verificar la firma x-hub-signature-256 de Meta. Sin esto, cualquiera que conozca la
    // URL pública inyecta mensajes falsos → el bot responde y via processIncomingMessage puede crear
    // reservas / payment links / invoices reales. Fail-closed: sin appSecret (WHATSAPP_APP_SECRET)
    // o sin signature, se rechaza. La firma se calcula sobre los bytes crudos (req.rawBody si el
    // framework lo expone; fallback JSON.stringify).
    const appSecret = process.env.WHATSAPP_APP_SECRET
    const signature = req.headers?.['x-hub-signature-256'] || req.headers?.['X-Hub-Signature-256']
    if (!appSecret || !signature) {
      this.logger.warn('WhatsApp webhook rechazado: falta appSecret o signature', { hotelId, hasAppSecret: !!appSecret, hasSignature: !!signature })
      return { status: 403, body: { error: 'signature required' } }
    }
    const rawBody = (req.rawBody ?? JSON.stringify(body)) as string
    const expected = 'sha256=' + (await import('node:crypto')).createHmac('sha256', appSecret).update(rawBody).digest('hex')
    if (signature !== expected) {
      this.logger.warn('WhatsApp webhook: firma inválida', { hotelId })
      return { status: 401, body: { error: 'invalid signature' } }
    }

    try {
      const entry = body?.entry?.[0]
      const changes = entry?.changes?.[0]
      const value = changes?.value
      const messages = value?.messages

      // Meta manda por el MISMO webhook los acuses de entrega de lo que enviamos nosotros.
      // Sin esto, un mensaje se quedaba en "enviado" para siempre y el hotel no sabía si llegó.
      const statuses = value?.statuses
      if (Array.isArray(statuses) && statuses.length > 0) {
        const port = (this.service as any).deliveryStatusPort
        if (port) {
          const out = await aplicarEstadosDeEntrega({ port, logger: this.logger }, statuses)
          return { status: 200, body: { status: 'statuses_processed', ...out } }
        }
        // Sin el puerto cableado no hay dónde anotarlo, pero se responde 200: un error haría que
        // Meta reintente este webhook indefinidamente.
        this.logger.warn('Webhook con acuses de entrega y sin puerto para registrarlos', { hotelId })
        return { status: 200, body: { status: 'statuses_ignored' } }
      }

      if (!messages || messages.length === 0) {
        return { status: 200, body: { status: 'no_messages' } }
      }

      for (const msg of messages) {
        const from = msg.from
        const text = msg.text?.body || ''

        if (!text) continue

        const conv = await this.service.findOrCreateConversation({
          hotelId,
          channel: 'whatsapp',
          channelConversationId: from,
          guestPhone: from,
          guestName: value?.contacts?.[0]?.profile?.name || from,
          language: 'es',
        })

        // Reabre la ventana de 24 h y suma al contador de no leídos ANTES de que conteste nadie:
        // si el pipeline falla, el mensaje del huésped tiene que estar registrado igual.
        const silenciado = await this.service.registrarEntrante(conv.id, hotelId)

        // Si una persona del hotel tomó la conversación, el bot NO responde: el huésped recibiría
        // dos respuestas distintas al mismo tiempo y el hotel quedaría como incoherente.
        if (!silenciado) await this.service.processIncomingMessage(conv.id, text, hotelId)
      }

      return { status: 200, body: { status: 'processed' } }
    } catch (err: any) {
      this.logger.error('WhatsApp webhook error', { hotelId, error: String(err) })
      return { status: 200, body: { status: 'error' } }
    }
  }

  // ─── WebChat ────────────────────────────────────────────────────────────

  async webChatMessage(req: any) {
    const slug = req.params?.slug
    const data = validateSchema(WebChatMessageSchema, req.body || {}) as any

    const hotels = await (this.service as any).hotelRepo.findMany({})
    const hotel = (hotels as any[]).find((h: any) =>
      h.name?.toLowerCase().replace(/\s+/g, '-') === slug || h.id === slug
    )
    if (!hotel) return { status: 404, body: { error: 'Hotel no encontrado' } }

    const conv = await this.service.findOrCreateConversation({
      hotelId: hotel.id,
      channel: 'webchat',
      channelConversationId: data.sessionId || crypto.randomUUID(),
      guestName: 'Web Guest',
      language: 'es',
    })

    const response = await this.service.processIncomingMessage(conv.id, data.content, hotel.id)
    return { status: 200, body: { conversationId: conv.id, response } }
  }

  // ─── Metrics ────────────────────────────────────────────────────────────

  async metrics(req: any) {
    const user = req.user || {}
    const period = (req.query?.period as string) || 'today'
    const result = await this.service.getMetrics(req.query?.hotelId || '', period as 'today' | 'week' | 'month', user)
    return { status: 200, body: { data: result } }
  }

  async dashboardMetrics(req: any) {
    const user = req.user || {}
    const result = await this.service.getDashboardMetrics(req.query?.hotelId || '', user)
    return { status: 200, body: result }
  }

  // ─── Baileys WhatsApp ──────────────────────────────────────────────────

  async startWhatsapp(req: any) {
    const user = req.user || {}
    const data = validateSchema(StartWhatsappSchema, req.body || {}) as any
    const hotelId = data.hotelId || user.hotelId
    if (!hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    const result = await this.service.startWhatsappSession(hotelId)
    return { status: 200, body: result }
  }

  async stopWhatsapp(req: any) {
    const user = req.user || {}
    const data = validateSchema(StopWhatsappSchema, req.body || {}) as any
    const hotelId = data.hotelId || user.hotelId
    if (!hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    const result = await this.service.stopWhatsappSession(hotelId)
    return { status: 200, body: result }
  }

  async getWhatsappQR(req: any) {
    const user = req.user || {}
    const hotelId = req.params?.hotelId || user.hotelId
    const result = await this.service.getWhatsappQR(hotelId)
    return { status: 200, body: result }
  }

  async getWhatsappStatus(req: any) {
    const user = req.user || {}
    const hotelId = req.params?.hotelId || user.hotelId
    const result = await this.service.getWhatsappStatus(hotelId)
    return { status: 200, body: result }
  }
}
