// marketing/tests/service.test.ts
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { MarketingService } from '../service'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }

function makeRepo(overrides: Partial<RepositoryAdapter<any>> = {}): RepositoryAdapter<any> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data }),
    update: async (id, data) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

/** Repo que captura lo que el service PERSISTE en create (frontera repo: 0|1, COR-7). */
function spyRepo(persisted: { value: unknown }): RepositoryAdapter<any> {
  return makeRepo({ create: async (data: any) => { persisted.value = data; return { id: 'test-id', ...data } } })
}

describe('MarketingService', () => {
  describe('createAutoMessage', () => {
    it('crea un auto-mensaje', async () => {
      const svc = new MarketingService(makeRepo(), makeRepo(), makeRepo(), log, silentCache)
      const msg = await svc.createAutoMessage({ hotelId: 'h1', title: 'Bienvenida', triggerEvent: 'checkin_day' })
      expect(msg.title).toBe('Bienvenida')
    })

    // INT-1/COR-1: el frontend manda isActive numérico (0/1, schema `type:'number'`).
    // Con `dto.isActive !== false ? 1 : 0`, un 0 (tipos distintos, sin coerción) caía en el
    // branch ACTIVO: crear un mensaje PAUSADO lo storea activo y el cron le escribe a
    // huéspedes. El ORM persiste INTEGER; el flag normalizado debe ser 0.
    // COR-7: se aserte sobre lo que llega a repo.create (la PERSISTENCIA), no sobre el eco
    // del DTO de respuesta — el modelo es `type:'boolean'`, así que el wire responde boolean
    // y el 0|1 sólo es visible en la frontera del repo.
    it('crear PAUSADO (isActive: 0) persiste 0, no 1', async () => {
      const persisted = { value: undefined as unknown }
      const svc = new MarketingService(spyRepo(persisted), makeRepo(), makeRepo(), log, silentCache)
      await svc.createAutoMessage({ hotelId: 'h1', title: 'Pausado', triggerEvent: 'checkin_day', isActive: 0 })
      expect((persisted.value as any).isActive).toBe(0)
    })

    it('crear sin isActive sigue siendo ACTIVO por default (compatibilidad)', async () => {
      const persisted = { value: undefined as unknown }
      const svc = new MarketingService(spyRepo(persisted), makeRepo(), makeRepo(), log, silentCache)
      await svc.createAutoMessage({ hotelId: 'h1', title: 'Default', triggerEvent: 'checkin_day' })
      expect((persisted.value as any).isActive).toBe(1)
    })

    it('crear con isActive: false (boolean legacy) persiste 0', async () => {
      const persisted = { value: undefined as unknown }
      const svc = new MarketingService(spyRepo(persisted), makeRepo(), makeRepo(), log, silentCache)
      await svc.createAutoMessage({ hotelId: 'h1', title: 'Bool', triggerEvent: 'checkin_day', isActive: false })
      expect((persisted.value as any).isActive).toBe(0)
    })
  })

  describe('listAutoMessages', () => {
    it('retorna lista vacía', async () => {
      const svc = new MarketingService(makeRepo(), makeRepo(), makeRepo(), log, silentCache)
      const msgs = await svc.listAutoMessages('h1')
      expect(msgs).toEqual([])
    })
  })

  describe('createTemplate', () => {
    it('crea una plantilla WhatsApp', async () => {
      const svc = new MarketingService(makeRepo(), makeRepo(), makeRepo(), log, silentCache)
      const t = await svc.createTemplate({ hotelId: 'h1', name: 'Saludo', body: 'Hola {guest_name}' })
      expect(t.name).toBe('Saludo')
    })

    // Instancia gemela de INT-1: createTemplate tenía la misma coerción invertida.
    // COR-7: idem arriba — se aserte la persistencia (0|1 en la frontera del repo).
    it('crear plantilla PAUSADA (isActive: 0) persiste 0', async () => {
      const persisted = { value: undefined as unknown }
      const svc = new MarketingService(makeRepo(), makeRepo(), spyRepo(persisted), log, silentCache)
      await svc.createTemplate({ hotelId: 'h1', name: 'Pausada', body: 'Hola', isActive: 0 })
      expect((persisted.value as any).isActive).toBe(0)
    })
  })

  describe('listMessageLogs', () => {
    it('retorna logs vacíos', async () => {
      const svc = new MarketingService(makeRepo(), makeRepo(), makeRepo(), log, silentCache)
      const logs = await svc.listMessageLogs('h1')
      expect(logs).toEqual([])
    })
  })
})
