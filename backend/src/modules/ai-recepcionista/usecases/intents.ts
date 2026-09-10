import type { CacheAdapter } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import type {
  AiIntentDTO, CreateAiIntentDTO, UpdateAiIntentDTO,
  AiConversationDTO, AiMessageDTO,
  NlpResult, BotResponse,
} from '../types'
import type { AiRecepcionistaSockets } from '../sockets'
import { detectIntent } from './nlp-engine'
import { buildResponse } from './response-builder'
import { generateReply, type ToolRepos } from './llm-pipeline'
import type { LlmConfig } from './llm-provider'
import {
  findOrCreateConversation, sendMessage, transferConversation,
} from './conversations'

export async function listIntents(
  repo: any,
  hotelId: string,
  category?: string,
  isActive?: number,
  page?: number,
  limit?: number,
): Promise<{ data: AiIntentDTO[]; total: number }> {
  const filters: Record<string, unknown> = { hotelId }
  if (category) filters.category = category
  if (isActive !== undefined) filters.isActive = isActive
  const p = Math.max(page || 1, 1)
  const l = Math.min(Math.max(limit || 50, 1), 200)
  const offset = (p - 1) * l
  const result = await repo.paginate(filters, { offset, limit: l })
  return { data: result.data, total: result.total }
}

export async function getIntent(
  repo: any, id: string, userHotelId?: string, userRole?: string,
): Promise<AiIntentDTO> {
  // @ignore IDOR_RISK
  const intent = await repo.findById(id)
  if (!intent) throw new NotFoundError('Intención no encontrada')
  if (userRole !== 'super_admin' && intent.hotelId !== userHotelId) {
    throw new AuthError('No autorizado')
  }
  return intent
}

/**
 * Corre el motor de NLP contra UNA sola intención: es el botón "Probar" del panel, que sirve para
 * ver si las frases de entrenamiento de esa intención matchean un mensaje. Va acá y no en el
 * service porque es la misma pareja buscar-intención + `detectIntent` que ya usa el pipeline.
 */
export async function probarIntent(
  repo: any, id: string, message: string, userHotelId?: string, userRole?: string,
): Promise<NlpResult> {
  return detectIntent(message, [await getIntent(repo, id, userHotelId, userRole)])
}

export async function createIntent(
  repo: any, cache: CacheAdapter,
  dto: CreateAiIntentDTO, hotelId: string,
): Promise<AiIntentDTO> {
  const intent = await repo.create({
    id: crypto.randomUUID(), hotelId,
    name: dto.name, category: dto.category || 'general',
    triggerPhrases: dto.triggerPhrases, responseTemplate: dto.responseTemplate,
    action: dto.action || null, actionPayload: dto.actionPayload || null,
    fallbackResponse: dto.fallbackResponse || 'No estoy segura de haber entendido.',
    priority: dto.priority || 0, confidenceThreshold: dto.confidenceThreshold || 0.65,
    requiresAuth: 0, isSystem: 0, isActive: 1,
  } as any)
  await cache.delete(`ai:intents:${hotelId}`)
  return intent
}

export async function updateIntent(
  repo: any, cache: CacheAdapter,
  id: string, dto: UpdateAiIntentDTO, userHotelId?: string, userRole?: string,
): Promise<AiIntentDTO> {
  // @ignore IDOR_RISK
  const existing = await repo.findById(id)
  if (!existing) throw new NotFoundError('Intención no encontrada')
  if (userRole !== 'super_admin' && existing.hotelId !== userHotelId) {
    throw new AuthError('No autorizado')
  }
  const updated = await repo.update(id, dto as any)
  if (!updated) throw new NotFoundError('Intención no encontrada')
  await cache.delete(`ai:intents:${existing.hotelId}`)
  return updated
}

export async function deleteIntent(
  repo: any, cache: CacheAdapter, id: string,
  userHotelId?: string, userRole?: string,
): Promise<void> {
  // @ignore IDOR_RISK
  const existing = await repo.findById(id)
  if (!existing) throw new NotFoundError('Intención no encontrada')
  if (userRole !== 'super_admin' && existing.hotelId !== userHotelId) {
    throw new AuthError('No autorizado')
  }
  if (existing.isSystem === 1) {
    throw new AuthError('Las intenciones del sistema no se pueden eliminar')
  }
  await repo.delete(id)
  await cache.delete(`ai:intents:${existing.hotelId}`)
}

export async function processIncomingMessage(
  convRepo: any,
  msgRepo: any,
  intentRepo: any,
  configRepo: any,
  sockets: AiRecepcionistaSockets,
  cache: CacheAdapter,
  logger: any,
  conversationId: string,
  content: string,
  hotelId: string,
  hotelName?: string,
  toolRepos?: ToolRepos,
): Promise<BotResponse> {
  const intents = await intentRepo.findMany({ hotelId, isActive: 1 })

  await sendMessage(convRepo, msgRepo, sockets, cache, {
    conversationId, hotelId, sender: 'guest', content,
  })

  // @ignore IDOR_RISK
  const conv = await convRepo.findById(conversationId)

  const variables: Record<string, string> = {
    hotelId: hotelId,
    guestName: conv?.guestName || 'Huésped',
    hotelName: hotelName || 'Hotel', botName: 'Sofía',
    language: conv?.language || 'es',
  }

  const configs = await configRepo.findMany({ hotelId })
  const cfg = configs[0]

  let llmConfig: LlmConfig | null = null
  if (cfg?.llmProvider) {
    llmConfig = {
      provider: cfg.llmProvider,
      model: cfg.llmModel || undefined,
      apiKey: cfg.llmApiKey || undefined,
      temperature: 0.5,
      maxTokens: 500,
    }
    variables.botName = cfg.botName || 'Sofía'
  }

  const history = await msgRepo.findMany(
    { conversationId },
  )

  const conversationHistory = (history as any[]).slice(-10).map((m: any) => ({
    role: m.sender === 'guest' ? 'guest' as const : 'bot' as const,
    content: m.content,
  }))

  const response = await generateReply(content, intents, conversationHistory, variables, llmConfig, toolRepos)

  const botMsg = await sendMessage(convRepo, msgRepo, sockets, cache, {
    conversationId, hotelId, sender: 'bot',
    content: response.text, contentType: 'text',
    intentDetected: response.intentDetected,
    confidence: response.confidence,
    actionTaken: response.actionTaken,
    actionResult: response.actionResult,
  })

  await sockets.onBotReplied?.(botMsg)

  if (response.actionTaken === 'escalate_to_human' || detectIntent(content, intents).intent?.action === 'escalate_to_human') {
    await transferConversation(convRepo, sockets, conversationId, null, 'guest_request')
  }

  return response
}
