// huespedes/tests/service.test.ts — Tests del servicio
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { HuespedesService } from '../service'
import type { HuespedesDTO } from '../types'

// silentLogger es una factory function — SIEMPRE llamarla con ()
const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = { assertOwnership: () => {} } as unknown as Auth

function makeRepo(overrides: Partial<RepositoryAdapter<HuespedesDTO>> = {}): RepositoryAdapter<HuespedesDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'test-id', ...data } as HuespedesDTO),
    update: async (id, data) => ({ id, ...data } as HuespedesDTO),
    delete: async () => true,
    count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 20, offset: 0, pages: 0 }),
    ...overrides,
  }
}

function makeUserRepo() {
  return { findById: async () => ({ id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }) } as unknown as RepositoryAdapter<any>
}

const mockUser = { id: 'user-1', hotelId: 'hotel-1', role: 'hotel_admin' }

describe('HuespedesService', () => {
  describe('getById', () => {
    it('lanza NotFound si el item no existe', async () => {
      const service = new HuespedesService(makeRepo(), makeUserRepo(), log, silentCache, mockAuth)
      await expect(service.getById('no-existe', mockUser)).rejects.toThrow('Huespedes no encontrado')
    })

    it('retorna el item si existe', async () => {
      const item = { id: '1', hotelId: 'hotel-1' } as HuespedesDTO
      const service = new HuespedesService(makeRepo({ findById: async () => item }), makeUserRepo(), log, silentCache, mockAuth)
      expect(await service.getById('1', mockUser)).toEqual(item)
    })
  })

  describe('create', () => {
    it('crea y retorna el item', async () => {
      const service = new HuespedesService(makeRepo(), makeUserRepo(), log, silentCache, mockAuth)
      const result = await service.create({} as any, mockUser)
      expect(result.id).toBe('test-id')
    })

    it('OP-C1: fuerza el hotelId del JWT, ignora el dto.hotelId del cliente', async () => {
      let persisted: any = null
      const repo = makeRepo({ create: async (d: any) => { persisted = { id: 'x', ...d }; return persisted } })
      const service = new HuespedesService(repo, makeUserRepo(), log, silentCache, mockAuth)
      // mockUser es hotel_admin de su hotel; intenta crear en 'hotel-ajeno'.
      await service.create({ hotelId: 'hotel-ajeno' } as any, mockUser)
      expect(persisted.hotelId).toBe(mockUser.hotelId)
      expect(persisted.hotelId).not.toBe('hotel-ajeno')
    })
  })

  describe('delete', () => {
    it('lanza NotFound si el item no existe', async () => {
      const service = new HuespedesService(makeRepo({ delete: async () => false }), makeUserRepo(), log, silentCache, mockAuth)
      await expect(service.delete('no-existe', mockUser)).rejects.toThrow('Huespedes no encontrado')
    })
  })
})

// ─── H-1 (auditoría 2026-08-19): delete con historial NO se borra ─────────────────────────
// El catch de FK era código muerto (el ORM no crea FKs físicos) — borrar un huésped con
// reservas dejaba el historial huérfano. El guard de app lo bloquea con 409 claro.
describe('delete — guard de integridad (H-1)', () => {
  const guest = { id: 'g1', hotelId: 'h1', name: 'Ana', email: 'a@b.com' } as any

  it('huésped CON reservas → 409, no borra', async () => {
    const deleted: string[] = []
    const svc = new HuespedesService(
      { ...makeRepo(), findById: async () => guest, delete: async (id: string) => { deleted.push(id); return true } } as any,
      { findById: async () => ({ hotelId: 'h1' }) } as any,
      log, silentCache, mockAuth,
      { findMany: async () => [{ id: 'r1' }] } as any, // reservasRepo: 1 reserva
    )
    await expect(svc.delete('g1', mockUser)).rejects.toThrow(/reserva\(s\) en su historial/)
    expect(deleted).toEqual([])
  })

  it('huésped SIN reservas → borra normalmente', async () => {
    const deleted: string[] = []
    const svc = new HuespedesService(
      { ...makeRepo(), findById: async () => guest, delete: async (id: string) => { deleted.push(id); return true } } as any,
      { findById: async () => ({ hotelId: 'h1' }) } as any,
      log, silentCache, mockAuth,
      { findMany: async () => [] } as any,
    )
    await svc.delete('g1', mockUser)
    expect(deleted).toEqual(['g1'])
  })
})
