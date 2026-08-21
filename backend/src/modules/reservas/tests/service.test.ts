// reservas/tests/service.test.ts — Tests del servicio
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, CacheAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { ReservasService } from '../service'
import { ReservasQueries } from '../usecases/reservas-queries'
import type { ReservasDTO } from '../types'

const log = silentLogger()
const silentCache: CacheAdapter = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} }
const mockAuth = { assertOwnership: () => {} } as unknown as Auth
const fakeAuth = { createToken: () => 'tok', assertOwnership: () => {} } as unknown as Auth

const adminUser = { id: 'admin1', role: 'super_admin', hotelId: undefined }
const hotelAdmin = { id: 'user1', role: 'hotel_admin', hotelId: 'h1' }
const otherAdmin = { id: 'user2', role: 'hotel_admin', hotelId: 'h2' }

function makeRepo(overrides: Partial<RepositoryAdapter<ReservasDTO>> = {}): RepositoryAdapter<ReservasDTO> {
  return {
    findMany: async () => [],
    findById: async () => null,
    findOne: async () => null,
    create: async (data) => ({ id: 'res-1', ...data } as ReservasDTO),
    update: async (id, data) => ({ id, ...data } as ReservasDTO),
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

// Repos de dependencias del bloque de email (no se ejercitan en estos tests — communicateClient ausente).
// findOne devuelve entidades del hotel 'h1' (el de los tests) para pasar la validación de
// pertenencia room/guest→hotel en create (OP-C2).
const guestRepo = { findById: async () => null, findOne: async () => ({ id: 'guest1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
const roomRepo = { findById: async () => null, findOne: async () => ({ id: 'room1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
const hotelRepo = { findById: async () => null } as unknown as RepositoryAdapter<any>

function makeQueries() {
  const q = new ReservasQueries({
    findMany: async () => [],
    findById: async () => null,
    create: async (data: any) => data,
    update: async () => {},
  })
  // El camino reserva → dinero ya NO sale del ORM: lo sirve el puerto que cablea
  // `connectors/reservas-money` (folios + facturas + payments). Un hotel sin plata cobrada.
  q.setMoneyPort({
    folios: async () => [], invoices: async () => [], payments: async () => [],
    reservationIdOf: async () => null,
  })
  return q
}

describe('ReservasService', () => {
  describe('list', () => {
    it('returns paginated reservations', async () => {
      const reservations = [{ id: 'r1', roomId: 'room1', hotelId: 'h1' }] as ReservasDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: reservations, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.list({}, adminUser)
      expect(result.data).toHaveLength(1)
    })

    it('filters by hotelId for hotel_admin', async () => {
      const reservations = [{ id: 'r1', roomId: 'room1', hotelId: 'h1' }] as ReservasDTO[]
      const repo = makeRepo({ paginate: async () => ({ data: reservations, total: 1, limit: 20, offset: 0, pages: 1 }) })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.list({}, hotelAdmin)
      expect(result.data).toHaveLength(1)
    })

    it('throws when no hotelId assigned', async () => {
      const noHotel = { id: 'u1', role: 'hotel_admin', hotelId: undefined }
      const noHotelUserRepo = { findById: async () => ({ id: 'u1', hotelId: undefined }) } as unknown as RepositoryAdapter<any>
      const svc = new ReservasService(makeRepo(), log, silentCache, noHotelUserRepo, fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.list({}, noHotel)).rejects.toThrow('No hotel assigned')
    })
  })

  describe('getById', () => {
    it('returns reservation for super_admin', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.getById('r1', adminUser)
      expect(result.roomId).toBe('room1')
    })

    it('rejects other hotel reservation', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h2' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.getById('r1', hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('create', () => {
    it('creates reservation with valid dates', async () => {
      const svc = new ReservasService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.create({
        roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05', totalAmount: 400
      }, hotelAdmin)
      expect(result.id).toBe('res-1')
    })

    it('rejects if checkIn >= checkOut', async () => {
      const svc = new ReservasService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.create({
        roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-05', checkOut: '2026-07-01', totalAmount: 400
      }, hotelAdmin)).rejects.toThrow('checkIn debe ser anterior')
    })

    it('rejects if room is occupied', async () => {
      const existing = [{ id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-02', checkOut: '2026-07-04', status: 'confirmed' }] as ReservasDTO[]
      const repo = makeRepo({ findMany: async () => existing })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.create({
        roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-03', checkOut: '2026-07-06', totalAmount: 400
      }, hotelAdmin)).rejects.toThrow('no disponible')
    })

    it('allows booking if existing is cancelled', async () => {
      // Mock returns empty because cancelled reservations are filtered out by status query
      const repo = makeRepo({ findMany: async () => [] })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.create({
        roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-03', checkOut: '2026-07-06', totalAmount: 400
      }, hotelAdmin)
      expect(result.id).toBe('res-1')
    })

    it('rejects reservation in other hotel', async () => {
      const svc = new ReservasService(makeRepo(), log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.create({
        roomId: 'room1', hotelId: 'h2', checkIn: '2026-07-01', checkOut: '2026-07-05', totalAmount: 400
      }, hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })

  describe('update', () => {
    it('updates own hotel reservation', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res, update: async (id, data) => ({ id, ...data } as ReservasDTO) })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.update('r1', { status: 'confirmed' }, hotelAdmin)
      expect(result.status).toBe('confirmed')
    })

    it('rejects update to other hotel reservation', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h2' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.update('r1', { status: 'confirmed' }, hotelAdmin)).rejects.toThrow('No autorizado')
    })

    // IDOR #668: mover una reserva propia a un roomId de OTRO hotel (validate-update.ts).
    // Regresión — el guard de `create` existía hace tiempo, el de `update` se olvidó.
    it('rejects moving the reservation to a room from another hotel (IDOR #668) without mutating', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05' } as ReservasDTO
      let updateCalled = false
      const repo = makeRepo({
        findById: async () => res,
        update: async (id, data) => { updateCalled = true; return { id, ...data } as ReservasDTO },
      })
      const otherHotelRoomRepo = { findById: async () => null, findOne: async () => ({ id: 'room2', hotelId: 'h2' }) } as unknown as RepositoryAdapter<any>
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, otherHotelRoomRepo, hotelRepo, makeQueries())
      await expect(svc.update('r1', { roomId: 'room2' }, hotelAdmin)).rejects.toThrow('La habitación no pertenece a este hotel')
      expect(updateCalled).toBe(false)
    })

    // Control feliz: mismo guard NO debe romper el flujo normal de mover a una room del propio hotel.
    it('accepts moving the reservation to a room from the SAME hotel (control)', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05' } as ReservasDTO
      const repo = makeRepo({
        findById: async () => res,
        findMany: async () => [],
        update: async (id, data) => ({ id, ...data } as ReservasDTO),
      })
      const sameHotelRoomRepo = { findById: async () => null, findOne: async () => ({ id: 'room2', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, sameHotelRoomRepo, hotelRepo, makeQueries())
      const result = await svc.update('r1', { roomId: 'room2' }, hotelAdmin)
      expect(result.roomId).toBe('room2')
    })

    // El MISMO endpoint tenía una segunda puerta abierta: `guestId`. `create` ya validaba la
    // pertenencia del huésped, `update` no. Explotable: un PUT con el guestId de otro hotel hacía
    // que el detalle devolviera su ficha entera (email, teléfono, documento, dirección, notas) y
    // que el checkout le sumara estadías y gasto al CRM de ESE otro hotel.
    it('rejects assigning a guest from another hotel (IDOR) without mutating', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05' } as ReservasDTO
      let updateCalled = false
      const repo = makeRepo({
        findById: async () => res,
        findMany: async () => [],
        update: async (id, data) => { updateCalled = true; return { id, ...data } as ReservasDTO },
      })
      const otherHotelGuestRepo = { findById: async () => null, findOne: async () => ({ id: 'g2', hotelId: 'h2' }) } as unknown as RepositoryAdapter<any>
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, otherHotelGuestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.update('r1', { guestId: 'g2' } as any, hotelAdmin)).rejects.toThrow('El huésped no pertenece a este hotel')
      expect(updateCalled).toBe(false)
    })

    it('accepts assigning a guest from the SAME hotel (control)', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05' } as ReservasDTO
      const repo = makeRepo({
        findById: async () => res,
        findMany: async () => [],
        update: async (id, data) => ({ id, ...data } as ReservasDTO),
      })
      const sameHotelGuestRepo = { findById: async () => null, findOne: async () => ({ id: 'g2', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, sameHotelGuestRepo, roomRepo, hotelRepo, makeQueries())
      const result = await svc.update('r1', { guestId: 'g2' } as any, hotelAdmin)
      expect((result as any).guestId).toBe('g2')
    })

    // Tercera puerta del mismo update: `groupId`.
    it('rejects assigning a group from another hotel (IDOR) without mutating', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1', checkIn: '2026-07-01', checkOut: '2026-07-05' } as ReservasDTO
      let updateCalled = false
      const repo = makeRepo({
        findById: async () => res,
        findMany: async () => [],
        update: async (id, data) => { updateCalled = true; return { id, ...data } as ReservasDTO },
      })
      const otherHotelGroupRepo = { findById: async () => null, findOne: async () => ({ id: 'grp2', hotelId: 'h2' }) } as unknown as RepositoryAdapter<any>
      const svc = new ReservasService(
        repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries(),
        undefined, undefined, undefined, otherHotelGroupRepo,
      )
      await expect(svc.update('r1', { groupId: 'grp2' } as any, hotelAdmin)).rejects.toThrow('El grupo no pertenece a este hotel')
      expect(updateCalled).toBe(false)
    })
  })

  describe('delete', () => {
    it('super_admin can delete', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.delete('r1', adminUser)).resolves.toBeUndefined()
    })

    it('hotel_admin can delete own hotel reservation', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h1' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.delete('r1', hotelAdmin)).resolves.toBeUndefined()
    })

    it('rejects delete of other hotel reservation', async () => {
      const res = { id: 'r1', roomId: 'room1', hotelId: 'h2' } as ReservasDTO
      const repo = makeRepo({ findById: async () => res })
      const svc = new ReservasService(repo, log, silentCache, makeUserRepo(), fakeAuth, guestRepo, roomRepo, hotelRepo, makeQueries())
      await expect(svc.delete('r1', hotelAdmin)).rejects.toThrow('No autorizado')
    })
  })
})
