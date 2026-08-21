// ai-gerente/tests/service.test.ts — Tests de M17 Gerente IA (ask/list/feedback).
//
// "fallback sin LLM" tiene que ser CIERTO. `service.ts:45` lee `DEEPSEEK_API_KEY`/`LLM_API_KEY` de
// `process.env` y `usecases/ask.ts:45` hace `fetch` con `AbortSignal.timeout(25_000)`, hasta 4
// vueltas. Bun autocarga `backend/.env`, donde esas claves son REALES: corrido como `bun test` a
// secas, este archivo salía a internet — el verde dependía de un tercero y, con el endpoint
// inalcanzable, tumbaba el gate a los 25s. El script del repo (`bun run test`) usa
// `--env-file .env.test` y no las carga, pero un test no puede depender de CÓMO lo lanzaron:
// acá se apagan explícitamente y se vigila que nadie salga a la red.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import type { CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { AiGerenteService } from '../service'

const LLM_ENV = ['DEEPSEEK_API_KEY', 'LLM_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch
let salidasDeRed: string[] = []

beforeEach(() => {
  for (const k of LLM_ENV) { savedEnv[k] = process.env[k]; delete process.env[k] }
  salidasDeRed = []
  // Centinela: si alguna vez vuelve a salir a internet, el test lo dice en vez de tardar 25s.
  const centinela = (input: any) => {
    salidasDeRed.push(String(input))
    throw new Error(`El test salió a la red: ${String(input)}`)
  }
  centinela.preconnect = realFetch.preconnect
  globalThis.fetch = centinela as unknown as typeof fetch
})
afterEach(() => {
  for (const k of LLM_ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]! }
  globalThis.fetch = realFetch
})

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

function mockRepo(overrides: Record<string, any> = {}): any {
  return {
    findMany: async () => [],
    findById: async () => null,
    create: async (d: any) => d,
    update: async (_id: string, d: any) => ({ ...d }),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, pages: 0 }),
    ...overrides,
  }
}

const USER = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }

describe('AiGerenteService', () => {
  it('ask: agrega KPIs y devuelve una respuesta (fallback sin LLM)', async () => {
    const reservationRepo = mockRepo({ findMany: async () => [
      { id: 'r1', hotelId: 'h1', checkIn: '2026-06-26', checkOut: '2026-06-28', status: 'confirmed', totalAmount: 300, createdAt: '2026-06-01' },
      { id: 'r2', hotelId: 'h1', checkIn: '2026-06-20', checkOut: '2026-06-22', status: 'cancelled', totalAmount: 200, createdAt: '2026-06-15' },
    ] })
    const roomRepo = mockRepo({ findMany: async () => [{ id: 'rm1' }, { id: 'rm2' }, { id: 'rm3' }] })
    const hotelRepo = mockRepo({ findById: async () => ({ id: 'h1', name: 'Hotel Test' }) })
    const service = new AiGerenteService(mockRepo(), reservationRepo, roomRepo, hotelRepo, mockRepo(), mockRepo(), log, silentCache)

    const interaction = await service.ask('¿Cómo va la ocupación?', USER)
    expect(interaction).toBeDefined()
    expect(interaction.response).toBeTruthy()
    expect(interaction.hotelId).toBe('h1')
    expect(interaction.queryType).toBe('question')
    // Sin LLM, la respuesta la arma el fallback con los KPIs reales — y NO se llamó a ningún LLM.
    expect(salidasDeRed).toHaveLength(0)
    expect(interaction.response).toContain('LLM no configurado')
  })

  it('ask: lanza si el user no tiene hotel asignado', async () => {
    const service = new AiGerenteService(mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), log, silentCache)
    await expect(service.ask('algo', { id: 'u', role: 'receptionist' } as any)).rejects.toThrow('No hotel assigned')
  })

  it('list: devuelve estructura paginada', async () => {
    const interactionRepo = mockRepo({ paginate: async () => ({ data: [{ id: 'i1' }], total: 1, pages: 1 }) })
    const service = new AiGerenteService(interactionRepo, mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), log, silentCache)
    const result = await service.list({ hotelId: 'h1', page: 1, limit: 10 })
    expect(result.data.length).toBe(1)
    expect(result.pagination.total).toBe(1)
  })

  it('feedback: delega al repo cuando el hotel coincide', async () => {
    const interactionRepo = mockRepo({
      findById: async () => ({ id: 'i1', hotelId: 'h1' }),
      update: async (_id: string, d: any) => ({ id: 'i1', ...d }),
    })
    const service = new AiGerenteService(interactionRepo, mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), log, silentCache)
    const updated = await service.feedback('i1', 'helpful', USER)
    expect(updated).toMatchObject({ feedback: 'helpful' })
  })

  it('feedback: null si la interacción no existe', async () => {
    const service = new AiGerenteService(mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), log, silentCache)
    const updated = await service.feedback('nope', 'helpful', USER)
    expect(updated).toBeNull()
  })

  it('feedback: IDOR — rechaza feedback de otro hotel', async () => {
    const interactionRepo = mockRepo({ findById: async () => ({ id: 'i1', hotelId: 'h2' }) })
    const service = new AiGerenteService(interactionRepo, mockRepo(), mockRepo(), mockRepo(), mockRepo(), mockRepo(), log, silentCache)
    await expect(service.feedback('i1', 'helpful', USER)).rejects.toThrow('No autorizado')
  })
})
