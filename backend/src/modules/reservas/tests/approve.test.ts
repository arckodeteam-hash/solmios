// reservas/tests/approve.test.ts — Tarea 3.4 (corrección 2026-08-25).
//
// Cubre el usecase approveReservation (no el HTTP controller): ownership (con Auth REAL,
// mismo criterio que cancel.test.ts), state machine (solo se puede aprobar lo que está
// 'pending' de aprobación) y que el update SOLO toca `approvalStatus` — nada de `status`,
// folio ni disponibilidad, que es justo el punto de este flujo: la reserva ya está pagada y
// ocupando la habitación, esto es una revisión humana, no un segundo gate de venta.
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError, NotFoundError } from 'arckode-framework'
import { approveReservation } from '../usecases/approve'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL (mismo criterio que cancel.test.ts): si assertOwnership se rompe, este test falla.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'

const repoWith = (item: any | null, opts: { updated?: any[] } = {}) => ({
  findById: async () => item,
  update: async (_id: string, patch: any) => {
    const merged = { ...item, ...patch }
    opts.updated?.push(merged)
    return merged
  },
}) as any

// Fake mínimo — solo lo que invalidateReservasCaches toca (get/set por key).
const fakeCache = () => {
  const store = new Map<string, unknown>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown) => { store.set(k, v) },
  } as any
}

const pendingItem = { id: 'r1', hotelId: HOTEL, approvalStatus: 'pending', status: 'confirmed' }
const userSameHotel = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

describe('approveReservation — ownership (con Auth real)', () => {
  it('deja aprobar al usuario del mismo hotel', async () => {
    const out = await approveReservation({ repo: repoWith(pendingItem), cache: fakeCache() }, 'r1', userSameHotel, realAuth)
    expect(out.approvalStatus).toBe('approved')
  })

  it('bloquea al usuario de otro hotel (no super_admin)', async () => {
    const call = approveReservation(
      { repo: repoWith(pendingItem), cache: fakeCache() }, 'r1', { id: 'u2', role: 'hotel_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    await expect(call).rejects.toThrow()
  })

  it('deja pasar al super_admin de otro hotel', async () => {
    const out = await approveReservation(
      { repo: repoWith(pendingItem), cache: fakeCache() }, 'r1', { id: 'u3', role: 'super_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    expect(out.approvalStatus).toBe('approved')
  })
})

describe('approveReservation — state machine', () => {
  it('404 si la reserva no existe', async () => {
    const call = approveReservation({ repo: repoWith(null), cache: fakeCache() }, 'nope', userSameHotel, realAuth)
    await expect(call).rejects.toThrow(NotFoundError)
  })

  it('409 si approvalStatus no es "pending" (ej. ya aprobada) — no hay nada que aprobar dos veces', async () => {
    const item = { ...pendingItem, approvalStatus: 'approved' }
    const call = approveReservation({ repo: repoWith(item), cache: fakeCache() }, 'r1', userSameHotel, realAuth)
    await expect(call).rejects.toThrow(ConflictError)
  })

  it('409 si approvalStatus es null (nunca requirió aprobación — hotel con confirmación instantánea)', async () => {
    const item = { ...pendingItem, approvalStatus: null }
    const call = approveReservation({ repo: repoWith(item), cache: fakeCache() }, 'r1', userSameHotel, realAuth)
    await expect(call).rejects.toThrow(ConflictError)
  })
})

describe('approveReservation — blast radius (solo toca approvalStatus)', () => {
  it('el update NO toca `status`: la reserva sigue pagada/ocupando, esto no es un segundo gate de venta', async () => {
    const updated: any[] = []
    await approveReservation({ repo: repoWith(pendingItem, { updated }), cache: fakeCache() }, 'r1', userSameHotel, realAuth)
    expect(updated).toHaveLength(1)
    expect(updated[0].status).toBe('confirmed') // sin cambios, viene del item original
    expect(updated[0].approvalStatus).toBe('approved')
  })
})
