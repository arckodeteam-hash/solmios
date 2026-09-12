// publicapi/tests/service.test.ts — PublicapiService delega en los puertos inyectados por el
// connector `publicapi-reservas`. Sin puertos conectados, debe fallar explícitamente (no silencioso).

import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { PublicapiService } from '../service'
import type { PublicApiRoomsPort, PublicApiReservationsPort, PublicReservationDTO } from '../types'

const log = silentLogger()

describe('PublicapiService', () => {
  describe('sin setDeps', () => {
    it('listRooms lanza si el rooms port no está conectado', async () => {
      const svc = new PublicapiService(log)
      await expect(svc.listRooms('hotel-1', {})).rejects.toThrow(/rooms port/)
    })

    it('createReservation lanza si el reservations port no está conectado', async () => {
      const svc = new PublicapiService(log)
      await expect(svc.createReservation('hotel-1', {} as any)).rejects.toThrow(/reservations port/)
    })
  })

  describe('con setDeps', () => {
    it('listRooms delega en el rooms port con el hotelId de la key', async () => {
      const svc = new PublicapiService(log)
      let calledWith: any = null
      const rooms: PublicApiRoomsPort = {
        listAvailability: async (hotelId, query) => { calledWith = { hotelId, query }; return [] },
      }
      svc.setDeps({ rooms })
      await svc.listRooms('hotel-1', { checkIn: '2026-08-01', checkOut: '2026-08-05' })
      expect(calledWith).toEqual({ hotelId: 'hotel-1', query: { checkIn: '2026-08-01', checkOut: '2026-08-05' } })
    })

    it('createReservation delega en el reservations port', async () => {
      const svc = new PublicapiService(log)
      const created: PublicReservationDTO = {
        id: 'r1', hotelId: 'hotel-1', roomId: 'room-1', roomType: 'double', checkIn: '2026-08-01', checkOut: '2026-08-05',
        totalAmount: 100, createdAt: '', updatedAt: '',
      }
      const reservations: PublicApiReservationsPort = {
        create: async () => created,
        getById: async () => created,
      }
      svc.setDeps({ reservations })
      const result = await svc.createReservation('hotel-1', {
        roomId: 'room-1', checkIn: '2026-08-01', checkOut: '2026-08-05', totalAmount: 100, guestName: 'Juan',
      })
      expect(result).toEqual(created)
    })

    it('getReservation rechaza si la reserva es de otro hotel (ownership)', async () => {
      const svc = new PublicapiService(log)
      const foreign: PublicReservationDTO = {
        id: 'r1', hotelId: 'OTHER-HOTEL', roomId: 'room-1', roomType: 'double', checkIn: '2026-08-01', checkOut: '2026-08-05',
        totalAmount: 100, createdAt: '', updatedAt: '',
      }
      svc.setDeps({ reservations: { create: async () => foreign, getById: async () => foreign } })
      await expect(svc.getReservation('hotel-1', 'r1')).rejects.toThrow()
    })

    it('getReservation devuelve la reserva si pertenece al hotel de la key', async () => {
      const svc = new PublicapiService(log)
      const mine: PublicReservationDTO = {
        id: 'r1', hotelId: 'hotel-1', roomId: 'room-1', roomType: 'double', checkIn: '2026-08-01', checkOut: '2026-08-05',
        totalAmount: 100, createdAt: '', updatedAt: '',
      }
      svc.setDeps({ reservations: { create: async () => mine, getById: async () => mine } })
      expect(await svc.getReservation('hotel-1', 'r1')).toEqual(mine)
    })
  })
})
