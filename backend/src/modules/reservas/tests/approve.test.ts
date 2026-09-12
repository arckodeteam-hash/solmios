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
import { closeReservationNotifications } from '../usecases/approve'
import { dispatchApprovalEmail, approvalNotifier } from '../usecases/approval-email'

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

// ─── #271 MR-06: efectos blandos tras aprobar (email al huésped + campanita) ───────────────────

const fullPending = { ...pendingItem, guestId: 'g1', roomId: 'room-1', checkIn: '2026-10-01', checkOut: '2026-10-03' }

describe('approveReservation — efectos blandos (#271)', () => {
  it('llama a notifyGuest con event reservation_approved y el reservationId', async () => {
    const calls: any[] = []
    const notifyGuest = async (input: any) => { calls.push(input) }
    const out = await approveReservation({ repo: repoWith(fullPending), cache: fakeCache(), notifyGuest }, 'r1', userSameHotel, realAuth)
    expect(out.approvalStatus).toBe('approved')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ event: 'reservation_approved', reservationId: 'r1', hotelId: HOTEL, guestId: 'g1', roomId: 'room-1', checkIn: '2026-10-01', checkOut: '2026-10-03', variables: {} })
  })

  it('notifyGuest que rechaza NO rompe la aprobación (fire-and-forget)', async () => {
    const warned: string[] = []
    const logger = { ...noopLogger, warn: (m: string) => { warned.push(m) } }
    const notifyGuest = () => Promise.reject(new Error('smtp caído'))
    const out = await approveReservation({ repo: repoWith(fullPending), cache: fakeCache(), notifyGuest, logger }, 'r1', userSameHotel, realAuth)
    expect(out.approvalStatus).toBe('approved')
    await new Promise((r) => setTimeout(r, 0)) // el .catch corre en el próximo tick
    expect(warned.some((m) => m.includes('smtp caído'))).toBe(true)
  })

  it('llama a closeHotelNotifications con (hotelId, id)', async () => {
    const calls: any[] = []
    const closeHotelNotifications = async (h: string, r: string) => { calls.push([h, r]) }
    await approveReservation({ repo: repoWith(fullPending), cache: fakeCache(), closeHotelNotifications }, 'r1', userSameHotel, realAuth)
    expect(calls).toEqual([[HOTEL, 'r1']])
  })

  it('closeHotelNotifications que tira NO rompe la aprobación (best-effort, warn)', async () => {
    const warned: string[] = []
    const logger = { ...noopLogger, warn: (m: string) => { warned.push(m) } }
    const closeHotelNotifications = async () => { throw new Error('notificaciones no responde') }
    const out = await approveReservation({ repo: repoWith(fullPending), cache: fakeCache(), closeHotelNotifications, logger }, 'r1', userSameHotel, realAuth)
    expect(out.approvalStatus).toBe('approved')
    expect(warned.some((m) => m.includes('notificaciones no responde'))).toBe(true)
  })

  it('sin notifyGuest ni closeHotelNotifications (deps mínimas) sigue funcionando', async () => {
    const out = await approveReservation({ repo: repoWith(fullPending), cache: fakeCache() }, 'r1', userSameHotel, realAuth)
    expect(out.approvalStatus).toBe('approved')
  })
})

// ─── dispatchApprovalEmail (usecases/approval-email.ts) ──────────────────────────────────────

const guestRepoWith = (guest: any) => ({ findById: async () => guest }) as any
const roomRepo = { findById: async () => ({ id: 'room-1', hotelId: HOTEL, number: '101' }) } as any
const hotelRepo = { findById: async () => ({ id: HOTEL, name: 'Hotel Test', phone: '+54 11 5555', logo: 'https://x/logo.png' }) } as any
const messageLogRepoWith = (rows: any[]) => ({ create: async (row: any) => { rows.push(row); return { id: 'ml1', ...row } } }) as any
const emailSenderWith = (calls: any[], fail?: Error) => ({
  enqueueNotification: async (input: any) => { if (fail) throw fail; calls.push(input); return 'q1' },
}) as any

const rejectedInput = {
  reservationId: 'r1', hotelId: HOTEL, guestId: 'g1', roomId: 'room-1',
  checkIn: '2026-10-01', checkOut: '2026-10-03', event: 'reservation_rejected',
  variables: { rejection_reason: 'Sin disponibilidad real esas fechas', refund_amount: '100.00 USD' },
}

describe('dispatchApprovalEmail (#271)', () => {
  it('encola reservation_rejected con las variables base + rejection_reason/refund_amount, y loguea sent', async () => {
    const sent: any[] = []
    const logs: any[] = []
    const deps = { emailSender: emailSenderWith(sent), guestRepo: guestRepoWith({ id: 'g1', hotelId: HOTEL, name: 'Ana', email: 'ana@x.com', language: 'es' }), roomRepo, hotelRepo, messageLogRepo: messageLogRepoWith(logs), logger: noopLogger }
    await dispatchApprovalEmail(deps, rejectedInput)
    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('reservation_rejected')
    expect(sent[0].to).toBe('ana@x.com')
    expect(sent[0].relatedId).toBe('r1')
    expect(sent[0].variables).toMatchObject({
      guest_name: 'Ana', hotel_name: 'Hotel Test', hotel_phone: '+54 11 5555', room_number: '101',
      checkin_date: '2026-10-01', checkout_date: '2026-10-03', logo_url: 'https://x/logo.png',
      rejection_reason: 'Sin disponibilidad real esas fechas', refund_amount: '100.00 USD',
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ status: 'sent', recipient: 'ana@x.com', messageId: 'q1', reservationId: 'r1' })
  })

  it('reservation_approved: encola con las variables base (sin extras)', async () => {
    const sent: any[] = []
    const deps = { emailSender: emailSenderWith(sent), guestRepo: guestRepoWith({ id: 'g1', hotelId: HOTEL, name: 'Ana', email: 'ana@x.com' }), roomRepo, hotelRepo, messageLogRepo: null, logger: noopLogger }
    await dispatchApprovalEmail(deps, { ...rejectedInput, event: 'reservation_approved', variables: {} })
    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('reservation_approved')
    expect(sent[0].variables.checkin_date).toBe('2026-10-01')
    expect(sent[0].variables.rejection_reason).toBeUndefined()
  })

  it('huésped sin email → no encola y loguea skipped', async () => {
    const sent: any[] = []
    const logs: any[] = []
    const deps = { emailSender: emailSenderWith(sent), guestRepo: guestRepoWith({ id: 'g1', hotelId: HOTEL, name: 'Ana' }), roomRepo, hotelRepo, messageLogRepo: messageLogRepoWith(logs), logger: noopLogger }
    await dispatchApprovalEmail(deps, rejectedInput)
    expect(sent).toHaveLength(0)
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('skipped')
  })

  it('emailSender que tira → loguea failed y no propaga', async () => {
    const logs: any[] = []
    const deps = { emailSender: emailSenderWith([], new Error('smtp caído')), guestRepo: guestRepoWith({ id: 'g1', hotelId: HOTEL, email: 'ana@x.com' }), roomRepo, hotelRepo, messageLogRepo: messageLogRepoWith(logs), logger: noopLogger }
    await expect(dispatchApprovalEmail(deps, rejectedInput)).resolves.toBeUndefined()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ status: 'failed', response: 'smtp caído', recipient: 'ana@x.com' })
  })

  it('huésped de otro hotel (tenacy) → no encola', async () => {
    const sent: any[] = []
    const deps = { emailSender: emailSenderWith(sent), guestRepo: guestRepoWith({ id: 'g1', hotelId: OTRO_HOTEL, email: 'ana@x.com' }), roomRepo, hotelRepo, messageLogRepo: null, logger: noopLogger }
    await dispatchApprovalEmail(deps, rejectedInput)
    expect(sent).toHaveLength(0)
  })

  it('approvalNotifier devuelve un puerto que delega en dispatchApprovalEmail', async () => {
    const sent: any[] = []
    const notify = approvalNotifier({ emailSender: emailSenderWith(sent), guestRepo: guestRepoWith({ id: 'g1', hotelId: HOTEL, email: 'ana@x.com' }), roomRepo, hotelRepo, messageLogRepo: null, logger: noopLogger })
    await notify(rejectedInput)
    expect(sent).toHaveLength(1)
    expect(sent[0].event).toBe('reservation_rejected')
  })
})

// ─── closeReservationNotifications (campanita del hotel) ─────────────────────────────────────

describe('closeReservationNotifications (#271)', () => {
  const rows = [
    { id: 'n1', hotelId: HOTEL, type: 'reservation', read: 0, metadata: { reservationId: 'r1', origin: 'web' } },
    { id: 'n2', hotelId: HOTEL, type: 'reservation', read: 0, metadata: JSON.stringify({ reservationId: 'r1' }) }, // fila vieja serializada
    { id: 'n3', hotelId: HOTEL, type: 'reservation', read: 1, metadata: { reservationId: 'r1' } }, // ya leída
    { id: 'n4', hotelId: HOTEL, type: 'reservation', read: 0, metadata: { reservationId: 'otra' } },
    { id: 'n5', hotelId: HOTEL, type: 'reservation', read: 0, metadata: '{no es json' },
    { id: 'n6', hotelId: HOTEL, type: 'reservation', read: 0, metadata: null },
  ]

  it('marca read:1 sólo las no leídas de la reserva (metadata objeto o string JSON), con actor de sistema del hotel', async () => {
    const listCalls: any[] = []
    const updates: any[] = []
    // Las campanitas son por usuario: `list` se consulta con `userId` por cada usuario del hotel
    // (u1 y u2). Las filas se devuelven en ambas consultas para probar que no se marca dos veces.
    const port = {
      listUsers: async () => [{ id: 'u1' }, { id: 'u2' }],
      list: async (q: any, user: any) => { listCalls.push([q, user]); return { data: rows } },
      update: async (id: string, dto: any, user: any) => { updates.push([id, dto, user]); return {} },
    }
    await closeReservationNotifications(port, HOTEL, 'r1')
    expect(listCalls).toHaveLength(2)
    expect(listCalls[0][0]).toMatchObject({ hotelId: HOTEL, type: 'reservation', userId: 'u1' })
    expect(listCalls[1][0]).toMatchObject({ userId: 'u2' })
    expect(listCalls[0][1]).toEqual({ id: 'system', role: 'super_admin', hotelId: HOTEL })
    expect(updates.map((u) => u[0])).toEqual(['n1', 'n2'])
    expect(updates[0][1]).toEqual({ read: 1 })
    expect(updates[0][2]).toEqual({ id: 'system', role: 'super_admin', hotelId: HOTEL })
  })

  it('sin campanitas de la reserva → no llama a update', async () => {
    const updates: any[] = []
    const port = { listUsers: async () => [{ id: 'u1' }], list: async () => ({ data: rows.filter((r) => r.id === 'n4') }), update: async (...a: any[]) => { updates.push(a); return {} } }
    await closeReservationNotifications(port, HOTEL, 'r1')
    expect(updates).toHaveLength(0)
  })
})
