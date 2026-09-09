import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { AiRecepcionistaService } from '../service'

const log = silentLogger()
const silentCache: any = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const auth: any = { authenticate: () => true }

function mockRepo(): any {
  return {
    findById: async () => null,
    findMany: async () => [],
    create: async (d: any) => d,
    update: async () => null,
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0 }),
  }
}

// 16 repos in constructor order:
// 0 conversation · 1 message · 2 intent · 3 template · 4 whatsappConfig · 5 metrics · 6 bookingFlow
// · 7 voiceConfig · 8 user · 9 hotel · 10 room · 11 reservation · 12 paymentLink · 13 config · 14 invoice · 15 guest
function makeService(overrides: Record<number, any> = {}): AiRecepcionistaService {
  const repos: any[] = Array.from({ length: 14 }, () => mockRepo())
  for (const [idx, repo] of Object.entries(overrides)) repos[Number(idx)] = repo
  return new AiRecepcionistaService(
    repos[0], repos[1], repos[2], repos[3], repos[4], repos[5], repos[6], repos[7],
    repos[8], repos[9], repos[10], repos[11], repos[12], repos[13],
    log, silentCache, auth,
  )
}

describe('AiRecepcionistaService', () => {
  it('se instancia correctamente', () => {
    const service = makeService()
    expect(service).toBeDefined()
  })

  it('detecta intents con NLP engine', async () => {
    const intentRepo = mockRepo()
    intentRepo.findMany = async () => [{
      id: '1', hotelId: 'h1', name: 'greeting', category: 'general',
      triggerPhrases: ['hola', 'buenos días'],
      responseTemplate: '¡Hola {guestName}! ¿En qué puedo ayudarte?',
      action: null, fallbackResponse: 'No entendí', priority: 0,
      confidenceThreshold: 0.65, requiresAuth: 0, isSystem: 1, isActive: 1,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }]

    const convRepo = mockRepo()
    convRepo.findById = async () => ({
      id: 'c1', hotelId: 'h1', channel: 'whatsapp', status: 'active',
      guestName: 'Juan', language: 'es', startedAt: '2026-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })

    const service = makeService({ 0: convRepo, 2: intentRepo })

    const response = await service.processIncomingMessage('c1', 'hola', 'h1')
    expect(response).toBeDefined()
    expect(response.text).toContain('Juan')
    expect(response.intentDetected).toBe('greeting')
  })

  it('usa fallback cuando no detecta intent', async () => {
    const intentRepo = mockRepo()
    intentRepo.findMany = async () => []

    const convRepo = mockRepo()
    convRepo.findById = async () => ({
      id: 'c1', hotelId: 'h1', channel: 'whatsapp', status: 'active',
      guestName: 'Guest', language: 'es', startedAt: '2026-01-01',
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    })

    const service = makeService({ 0: convRepo, 2: intentRepo })

    const response = await service.processIncomingMessage('c1', 'xyzxyz', 'h1')
    expect(response).toBeDefined()
    expect(response.confidence).toBeLessThan(0.65)
  })

  it('sendMessage: IDOR — rechaza mensaje a conversación de otro hotel', async () => {
    const convRepo = mockRepo()
    convRepo.findById = async () => ({ id: 'c1', hotelId: 'h2', status: 'active' })
    const service = makeService({ 0: convRepo })

    await expect(
      service.sendMessage('c1', { sender: 'agent', content: 'hola' }, { hotelId: 'h1', role: 'receptionist' }),
    ).rejects.toThrow('No autorizado')
  })

  it('sendMessage: permite mensaje dentro del mismo hotel', async () => {
    const convRepo = mockRepo()
    convRepo.findById = async () => ({ id: 'c1', hotelId: 'h1', status: 'active' })
    const messageRepo = mockRepo()
    messageRepo.create = async (d: any) => d
    const service = makeService({ 0: convRepo, 1: messageRepo })

    const msg = await service.sendMessage('c1', { sender: 'agent', content: 'hola' }, { hotelId: 'h1', role: 'receptionist' })
    expect(msg.conversationId).toBe('c1')
    expect(msg.hotelId).toBe('h1')
  })
})
