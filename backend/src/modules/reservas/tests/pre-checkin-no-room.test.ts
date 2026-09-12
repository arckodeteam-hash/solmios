// reservas/tests/pre-checkin-no-room.test.ts — REQ-HAC-04 (#259): el pre-check-in público tolera
// una reserva SIN unidad (`roomId = null`, HAC-01) y devuelve el TIPO vendido (`roomType`) para que
// el huésped vea qué reservó aunque recepción todavía no haya elegido la habitación.
import { describe, it, expect } from 'bun:test'
import { getPreCheckinData } from '../usecases/pre-checkin'

const hotelRepo = { findMany: async () => [{ id: 'h1', name: 'Hotel Sol' }] }
const guestRepo = { findMany: async () => [{ id: 'g1', name: 'Ana', email: 'ana@example.com' }] }

function roomRepoOf(rooms: any[]) {
  const calls: any[] = []
  return {
    calls,
    findMany: async (f: any) => { calls.push(f); return rooms.filter((r) => r.id === f.id) },
  }
}

function queriesOf(reservation: any) {
  return { findReservationByHash: async () => reservation } as any
}

const future = { checkIn: '2099-01-10', checkOut: '2099-01-12' }

describe('#259 — getPreCheckinData sin habitación asignada', () => {
  it('roomId null + roomType double → roomType "double", roomNumber "" y NO consulta Rooms', async () => {
    const roomRepo = roomRepoOf([{ id: 'rm1', number: '101', type: 'double' }])
    const out = await getPreCheckinData('hash', hotelRepo, roomRepo, guestRepo, queriesOf({ id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: null, roomType: 'double', ...future }))
    expect(out.roomType).toBe('double')
    expect(out.roomNumber).toBe('')
    expect(out.hotelName).toBe('Hotel Sol')
    expect(out.guestName).toBe('Ana')
    expect(roomRepo.calls).toHaveLength(0)
  })

  it('con roomId → roomNumber de la habitación y roomType de la reserva', async () => {
    const roomRepo = roomRepoOf([{ id: 'rm1', number: '101', type: 'double' }])
    const out = await getPreCheckinData('hash', hotelRepo, roomRepo, guestRepo, queriesOf({ id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm1', roomType: 'double', ...future }))
    expect(out.roomNumber).toBe('101')
    expect(out.roomType).toBe('double')
  })

  it('con roomId y fila anterior al backfill (sin roomType) → roomType de la habitación', async () => {
    const roomRepo = roomRepoOf([{ id: 'rm2', number: '201', type: 'suite' }])
    const out = await getPreCheckinData('hash', hotelRepo, roomRepo, guestRepo, queriesOf({ id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm2', ...future }))
    expect(out.roomNumber).toBe('201')
    expect(out.roomType).toBe('suite')
  })

  it('sin roomId ni roomType → roomType "" (no revienta)', async () => {
    const roomRepo = roomRepoOf([])
    const out = await getPreCheckinData('hash', hotelRepo, roomRepo, guestRepo, queriesOf({ id: 'r1', hotelId: 'h1', guestId: null, roomId: null, ...future }))
    expect(out.roomType).toBe('')
    expect(out.roomNumber).toBe('')
  })
})
