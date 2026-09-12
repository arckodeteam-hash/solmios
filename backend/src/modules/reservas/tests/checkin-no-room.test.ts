// reservas/tests/checkin-no-room.test.ts — #258 (HAC-01): una reserva SIN habitación asignada
// (`roomId = null`, vende sólo el tipo) NO puede hacer check-in. Antes `checkinValidation` dejaba
// pasar: se creaba un folio sin `roomId`, el cargo de la noche salía con la habitación vacía y el
// check-out reventaba en el connector de housekeeping. Ahora es 409 `no_room_assigned` (mismo
// formato de `details.reason` que assign-room.ts) y no se escribe NADA.
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { checkinValidation, executeCheckin } from '../usecases/checkin'

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const auth = { assertOwnership: () => {} }

function makeRepo(row: any) {
  return { findById: async (id: string) => (row && row.id === id ? row : null) }
}

describe('#258 — check-in exige habitación asignada', () => {
  it('checkinValidation: confirmed con roomId null → ConflictError reason=no_room_assigned', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: null, roomType: 'double', status: 'confirmed', checkIn: '2026-06-01', checkOut: '2026-06-03' })
    let err: any
    try { await checkinValidation(repo, 'r1', user, auth) } catch (e) { err = e }
    expect(err?.name).toBe('ConflictError')
    expect(err?.details?.reason).toBe('no_room_assigned')
  })

  it('checkinValidation: sin habitación gana sobre el chequeo de estado (pending también es 409 no_room_assigned)', async () => {
    const repo = makeRepo({ id: 'r1', hotelId: 'h1', roomId: undefined, status: 'pending' })
    let err: any
    try { await checkinValidation(repo, 'r1', user, auth) } catch (e) { err = e }
    expect(err?.details?.reason).toBe('no_room_assigned')
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
    expect(err?.details?.reason).toBe('no_room_assigned')
    expect(txCalls).toBe(0)
    expect(created).toHaveLength(0)
  })
})
