// reservas/tests/checkin-no-room.test.ts — #258 (HAC-01): una reserva SIN habitación asignada
// (`roomId = null`, vende sólo el tipo) NO puede hacer check-in. Antes `checkinValidation` dejaba
// pasar: se creaba un folio sin `roomId`, el cargo de la noche salía con la habitación vacía y el
// check-out reventaba en el connector de housekeeping. Ahora es 409 `room_not_assigned` (mismo
// formato de `details.reason` que assign-room.ts; nombre fijado por REQ-HAC-04 #259) y no se
// escribe NADA. Con #259 el estado se chequea ANTES que la habitación (asignar una unidad a una
// reserva cancelled/checked_in sería un efecto lateral) y `opts.roomId` releva el 409: el
// controller asigna con assignRoom antes de executeCheckin.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { checkinValidation, executeCheckin } from '../usecases/checkin'

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const auth = { assertOwnership: () => {} }

function makeRepo(row: any) {
  return { findById: async (id: string) => (row && row.id === id ? row : null) }
}

describe('#258 — check-in exige habitación asignada', () => {
  it('checkinValidation: confirmed con roomId null → ConflictError reason=room_not_assigned', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: null, roomType: 'double', status: 'confirmed', checkIn: '2026-06-01', checkOut: '2026-06-03' })
    let err: any
    try { await checkinValidation(repo, 'r1', user, auth) } catch (e) { err = e }
    expect(err?.name).toBe('ConflictError')
    expect(err?.details?.reason).toBe('room_not_assigned')
  })

  it('checkinValidation: pending (estado válido para check-in) sin habitación también es 409 room_not_assigned', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: undefined, status: 'pending' })
    let err: any
    try { await checkinValidation(repo, 'r1', user, auth) } catch (e) { err = e }
    expect(err?.name).toBe('ConflictError')
    expect(err?.details?.reason).toBe('room_not_assigned')
  })

  it('checkinValidation: el estado va primero — checked_in sin habitación es "ya tiene check-in", no room_not_assigned', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: null, status: 'checked_in' })
    let err: any
    try { await checkinValidation(repo, 'r1', user, auth) } catch (e) { err = e }
    expect(err?.name).toBe('ConflictError')
    expect(err?.message).toBe('La reserva ya tiene check-in')
    expect(err?.details?.reason).toBeUndefined()
  })

  it('checkinValidation: cancelled sin habitación → 409 por estado (no se llegaría a asignar)', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: null, status: 'cancelled' })
    let err: any
    try { await checkinValidation(repo, 'r1', user, auth, { roomId: 'rm1' }) } catch (e) { err = e }
    expect(err?.name).toBe('ConflictError')
    expect(err?.message).toContain('cancelled')
  })

  it('checkinValidation: con opts.roomId y roomId null NO lanza y devuelve la reserva (#259, el controller asigna después)', async () => {
    const row = { id: 'r1', hotelId: 'h1', roomId: null, roomType: 'double', status: 'confirmed' }
    const out = await checkinValidation(makeRepo(row), 'r1', user, auth, { roomId: 'rm1' })
    expect(out.reservation).toBe(row)
    expect(out.reservation.roomId).toBeNull()
    expect(out.hotelId).toBe('h1')
  })

  it('checkinValidation: con habitación sigue devolviendo la reserva (regresión)', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: 'rm1', status: 'confirmed' })
    const out = await checkinValidation(repo, 'r1', user, auth)
    expect(out.reservation.id).toBe('r1')
    expect(out.hotelId).toBe('h1')
  })

  it('executeCheckin (defensa en profundidad): roomId null → 409 y no abre folio ni transacción', async () => {
    const created: any[] = []
    let txCalls = 0
    const orm = {
      findMany: async () => [],
      transaction: async (fn: any) => { txCalls++; return fn({ create: async (t: string, d: any) => { created.push({ t, d }); return d }, update: async () => {} }) },
    }
    const r = { id: 'r1', hotelId: 'h1', roomId: null, guestId: 'g1', status: 'confirmed', checkIn: '2026-06-01', checkOut: '2026-06-03' }
    let err: any
    try { await executeCheckin(r, user, { orm, logger: silentLogger(), repo: {}, queries: null }) } catch (e) { err = e }
    expect(err?.name).toBe('ConflictError')
    expect(err?.details?.reason).toBe('room_not_assigned')
    expect(txCalls).toBe(0)
    expect(created).toHaveLength(0)
  })
})
