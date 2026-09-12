// bookingengine/tests/public-cancel.test.ts — F4 plan #627
//
// Cubre la auto-cancelación pública del huésped (POST /api/public/reservations/:id/cancel):
// - Token válido → cancela, setea refundAmount/cancellationFee/policyApplied, retorna 200.
// - Token inválido/ausente → 404 (anti-enumeración, MISMO body que not-found).
// - Reserva sin accessToken (creada desde panel) → 404.
// - checked_in → 409 (no se puede auto-cancelar).
// - Idempotencia: ya cancelled → 200 sin re-procesar.
// - Se emite onBookingCancelled (callback invocado post-éxito).
//
// - #272: grupo con token compartido → cascada (3 cancelled, penalidad sobre el total de la
//   líder, pushAvailability por habitación, groups.status='cancelled', UN evento con reservationIds).
//
// El token se valida con HMAC-SHA256 + timingSafeEqual, mismo secret que public-reservation.ts.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { cancelPublicBooking } from '../usecases/public-cancel'
import type { BookingCancelledEvent } from '../sockets'

const VALID_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Crea un mock de reservationsRepo con la(s) reserva(s) dada(s). Captura updates. */
function makeDeps(opts: {
  reservations?: any[]
  policies?: any[]
  onCancelled?: (data: BookingCancelledEvent) => Promise<void>
  /** #272 — si se pasa, el harness captura `groupsRepo.update` en `groupUpdates`. */
  withGroupsRepo?: boolean
} = {}) {
  const reservations = opts.reservations ?? [
    {
      id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
      accessToken: VALID_TOKEN,
      status: 'confirmed', channel: 'direct',
      checkIn: '2026-12-10', checkOut: '2026-12-12',
      totalAmount: 200, deposit: 100,
    },
  ]
  const policies = opts.policies ?? []

  const updates: Array<{ id: string; patch: any }> = []
  const groupUpdates: Array<{ id: string; patch: any }> = []
  const pushed: Array<[string, string]> = []
  const events: BookingCancelledEvent[] = []
  let cancelledCalled = false
  let cancelledId = ''

  const reservationsRepo: any = {
    findMany: async (query: any) => {
      // #272 — soporta `{ id }` (lookup) y `{ hotelId, groupId }` (hermanas del grupo).
      if (query?.groupId) return reservations.filter((r) => r.hotelId === query.hotelId && r.groupId === query.groupId)
      const id = query?.id
      return reservations.filter((r) => r.id === id)
    },
    update: async (id: string, patch: any) => {
      updates.push({ id, patch })
      const target = reservations.find((r) => r.id === id)
      if (target) Object.assign(target, patch)
      return { ...target, ...patch }
    },
  }

  const policyRepo: any = {
    findMany: async (query: any) => {
      // resolvePolicy filtra por hotelId y active !== false.
      return policies.filter((p) => p.hotelId === query?.hotelId)
    },
  }

  const logger: any = {
    child: () => logger,
    info: () => {},
    warn: () => {},
    error: () => {},
  }

  const onCancelled = opts.onCancelled ?? (async (data: BookingCancelledEvent) => {
    cancelledCalled = true
    cancelledId = data.reservationId
    events.push(data)
  })

  const groupsRepo: any = opts.withGroupsRepo
    ? { update: async (id: string, patch: any) => { groupUpdates.push({ id, patch }); return { id, ...patch } } }
    : undefined
  const pushAvailability = (hotelId: string, roomId: string) => { pushed.push([hotelId, roomId]) }

  return {
    deps: { reservationsRepo, policyRepo, logger, onCancelled, groupsRepo, pushAvailability },
    reservations,
    updates,
    groupUpdates,
    pushed,
    events,
    get cancelledCalled() { return cancelledCalled },
    get cancelledId() { return cancelledId },
  }
}

describe('cancelPublicBooking — auto-cancelación del huésped (F4 #627)', () => {
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  it('token válido → cancela, setea campos de penalty, retorna 200', async () => {
    const { deps, updates } = makeDeps()
    const res = await cancelPublicBooking(deps, 'res-1', VALID_TOKEN, 'Cambio de planes')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
    expect(res.body.reservationId).toBe('res-1')
    expect(res.body).toHaveProperty('refundAmount')
    expect(res.body).toHaveProperty('cancellationFee')
    expect(res.body).toHaveProperty('policyApplied')

    // Verifica que el update se hizo con los campos correctos.
    expect(updates.length).toBe(1)
    expect(updates[0].patch.status).toBe('cancelled')
    expect(updates[0].patch.cancellationReason).toBe('Cambio de planes')
    expect(updates[0].patch).toHaveProperty('cancelledAt')
    expect(updates[0].patch).toHaveProperty('cancellationFee')
    expect(updates[0].patch).toHaveProperty('refundAmount')
    expect(updates[0].patch).toHaveProperty('policyApplied')
  })

  it('token inválido → 404 con body neutro (anti-enumeración)', async () => {
    const { deps } = makeDeps()
    const res = await cancelPublicBooking(deps, 'res-1', 'wrong-token')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('sin token → 404 con el MISMO body', async () => {
    const { deps } = makeDeps()
    const res = await cancelPublicBooking(deps, 'res-1', undefined)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('reserva inexistente → 404 con el MISMO body', async () => {
    const { deps } = makeDeps()
    const res = await cancelPublicBooking(deps, 'does-not-exist', VALID_TOKEN)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('reserva sin accessToken (creada desde panel) → 404', async () => {
    const { deps } = makeDeps({
      reservations: [
        { id: 'panel-res', hotelId: 'h1', status: 'confirmed', accessToken: null, checkIn: '2026-12-10', deposit: 100 },
      ],
    })
    const res = await cancelPublicBooking(deps, 'panel-res', 'any-token-at-all')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('los 4 casos 404 devuelven EXACTAMENTE el mismo body', async () => {
    const { deps } = makeDeps({
      reservations: [
        { id: 'res-1', hotelId: 'h1', accessToken: VALID_TOKEN, status: 'confirmed', checkIn: '2026-12-10', deposit: 100 },
        { id: 'panel-res', hotelId: 'h1', accessToken: null, status: 'confirmed', checkIn: '2026-12-10', deposit: 100 },
      ],
    })
    const cases = await Promise.all([
      cancelPublicBooking(deps, 'res-1', undefined),         // sin token
      cancelPublicBooking(deps, 'res-1', 'wrong'),          // token incorrecto
      cancelPublicBooking(deps, 'missing-id', VALID_TOKEN), // no existe
      cancelPublicBooking(deps, 'panel-res', 'any'),        // accessToken null
    ])
    const bodies = new Set(cases.map((c) => JSON.stringify(c.body)))
    expect(bodies.size).toBe(1)
    expect(cases.every((c) => c.status === 404)).toBe(true)
    expect(cases[0].body).toEqual({ error: 'Reservation not found' })
  })

  it('checked_in → 409 (no se puede auto-cancelar)', async () => {
    const { deps } = makeDeps({
      reservations: [
        { id: 'res-in', hotelId: 'h1', accessToken: VALID_TOKEN, status: 'checked_in', checkIn: '2026-12-10', deposit: 100 },
      ],
    })
    const res = await cancelPublicBooking(deps, 'res-in', VALID_TOKEN)
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('check-in')
  })

  it('checked_out → 409', async () => {
    const { deps } = makeDeps({
      reservations: [
        { id: 'res-out', hotelId: 'h1', accessToken: VALID_TOKEN, status: 'checked_out', checkIn: '2026-12-10', deposit: 100 },
      ],
    })
    const res = await cancelPublicBooking(deps, 'res-out', VALID_TOKEN)
    expect(res.status).toBe(409)
  })

  it('ya cancelled → 200 idempotente (no re-procesa)', async () => {
    const { deps, updates, cancelledCalled } = makeDeps({
      reservations: [
        {
          id: 'res-cancelled', hotelId: 'h1', accessToken: VALID_TOKEN, status: 'cancelled',
          checkIn: '2026-12-10', deposit: 100,
          refundAmount: 50, cancellationFee: 50, policyApplied: { source: 'preset' },
        },
      ],
    })
    const res = await cancelPublicBooking(deps, 'res-cancelled', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('cancelled')
    expect(res.body.refundAmount).toBe(50)
    expect(res.body.idempotent).toBe(true)
    // No se hizo update ni se emitió el evento.
    expect(updates.length).toBe(0)
    expect(cancelledCalled).toBe(false)
  })

  it('se emite onBookingCancelled tras la cancelación exitosa', async () => {
    // No destructurear los getters (se evalúan al momento del destructure, antes del await).
    const harness = makeDeps()
    await cancelPublicBooking(harness.deps, 'res-1', VALID_TOKEN)
    expect(harness.cancelledCalled).toBe(true)
    expect(harness.cancelledId).toBe('res-1')
  })

  it('reason vacío → usa default "Cancelled by guest"', async () => {
    const { deps, updates } = makeDeps()
    await cancelPublicBooking(deps, 'res-1', VALID_TOKEN)
    expect(updates[0].patch.cancellationReason).toBe('Cancelled by guest')
  })

  it('aplica política custom (moderate: 50% si <=72h)', async () => {
    // checkIn en 24h → moderate tier de 0h matchea (deadlineHours 0 <= 24) → 50% penalty.
    const checkInSoon = new Date(Date.now() + 24 * 3600_000).toISOString()
    const { deps, updates } = makeDeps({
      reservations: [
        { id: 'res-2', hotelId: 'h1', accessToken: VALID_TOKEN, status: 'confirmed', channel: 'direct',
          checkIn: checkInSoon, deposit: 100 },
      ],
      policies: [
        { id: 'pol-1', hotelId: 'h1', scope: 'base', scopeId: '', name: 'Moderate',
          tiers: [
            { deadlineHours: 72, penaltyPercent: 0, refundable: true },
            { deadlineHours: 0, penaltyPercent: 50, refundable: true },
          ],
          active: true },
      ],
    })
    const res = await cancelPublicBooking(deps, 'res-2', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.cancellationFee).toBe(50)
    expect(res.body.refundAmount).toBe(50)
    expect(updates[0].patch.cancellationFee).toBe(50)
  })
})

// ─── Preset del hotel (hotels.cancellationType) ───────────────────────────────
// BUG: public-rates.ts SÍ pasaba hotelCancellationType a resolvePolicy (lo que el widget
// ANUNCIA al huésped) pero public-cancel.ts NO → la cancelación REAL caía a default
// flexible. Un hotel 'strict' sin filas custom anunciaba 100% de penalidad y devolvía todo.
describe('cancelPublicBooking — preset del hotel (hotels.cancellationType)', () => {
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  /** checkIn ~48h en el futuro: dentro de la ventana penalizada de 'strict' (168h). */
  const checkInSoon = new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 10)
  const hotelsRepoWith = (cancellationType: string) => ({
    findMany: async () => [{ id: 'h1', cancellationType }],
  }) as any
  const soonReservation = [
    { id: 'res-3', hotelId: 'h1', accessToken: VALID_TOKEN, status: 'confirmed', channel: 'direct',
      checkIn: checkInSoon, deposit: 100 },
  ]

  it("hotel 'strict' sin políticas custom → retiene el 100% (fee=100, refund=0)", async () => {
    const { deps, updates } = makeDeps({ reservations: soonReservation.map((r) => ({ ...r })), policies: [] })
    const res = await cancelPublicBooking({ ...deps, hotelsRepo: hotelsRepoWith('strict') }, 'res-3', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.cancellationFee).toBe(100)
    expect(res.body.refundAmount).toBe(0)
    expect(res.body.policyApplied.source).toBe('preset')
    expect(updates[0].patch.cancellationFee).toBe(100)
  })

  it('fail-soft: si el hotelsRepo explota, cancela igual (default flexible)', async () => {
    const { deps } = makeDeps({ reservations: soonReservation.map((r) => ({ ...r })), policies: [] })
    const boom = { findMany: async () => { throw new Error('db down') } } as any
    const res = await cancelPublicBooking({ ...deps, hotelsRepo: boom }, 'res-3', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.refundAmount).toBe(100)
    expect(res.body.policyApplied.source).toBe('default')
  })
})

// ─── #272 — Grupo con token compartido: cascada, inventario, evento único ─────────────
describe('cancelPublicBooking — grupo con token compartido (#272)', () => {
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  /** checkIn en 24h → tier de 0h de la política moderate (50%). */
  const checkInSoon = () => new Date(Date.now() + 24 * 3600_000).toISOString()
  const moderate = [
    { id: 'pol-1', hotelId: 'h1', scope: 'base', scopeId: '', name: 'Moderate',
      tiers: [
        { deadlineHours: 72, penaltyPercent: 0, refundable: true },
        { deadlineHours: 0, penaltyPercent: 50, refundable: true },
      ],
      active: true },
  ]
  /** Líder = la que tiene priceBreakdown y el deposit (el webhook deja 0 en las hermanas). */
  const groupOf3 = (status = 'confirmed') => {
    const base = { hotelId: 'h1', groupId: 'g1', accessToken: VALID_TOKEN, channel: 'direct', checkIn: checkInSoon(), status }
    return [
      { ...base, id: 'lead', roomId: 'r1', totalAmount: 100, deposit: 300, priceBreakdown: { total: 300 }, promoCode: 'PROMO10' },
      { ...base, id: 'sib-1', roomId: 'r2', totalAmount: 100, deposit: 0 },
      { ...base, id: 'sib-2', roomId: 'r3', totalAmount: 100, deposit: 0 },
    ]
  }

  it('cancelar desde una HERMANA cancela las 3, penalidad sobre el total de la líder, inventario, grupo y UN evento', async () => {
    const h = makeDeps({ reservations: groupOf3(), policies: moderate, withGroupsRepo: true })
    const res = await cancelPublicBooking(h.deps, 'sib-1', VALID_TOKEN, 'Cambio de planes')

    expect(res.status).toBe(200)
    expect(res.body.refundAmount).toBe(150)
    expect(res.body.cancellationFee).toBe(150)
    expect(res.body.roomsCount).toBe(3)
    expect(res.body.refundStatus).toBe('pending')
    expect(res.body.reservationIds.sort()).toEqual(['lead', 'sib-1', 'sib-2'])

    // Las 3 filas quedan cancelled con el MISMO snapshot.
    expect(h.reservations.every((r) => r.status === 'cancelled')).toBe(true)
    expect(h.updates.length).toBe(3)
    expect(new Set(h.updates.map((u) => JSON.stringify(u.patch))).size).toBe(1)
    expect(h.updates[0].patch.refundAmount).toBe(150)
    expect(h.updates[0].patch.cancellationReason).toBe('Cambio de planes')

    // Inventario por habitación + grupo cancelado.
    expect(h.pushed.sort()).toEqual([['h1', 'r1'], ['h1', 'r2'], ['h1', 'r3']])
    expect(h.groupUpdates).toEqual([{ id: 'g1', patch: { status: 'cancelled' } }])

    // UN solo evento: la líder como reservationId, todas en reservationIds.
    expect(h.events.length).toBe(1)
    expect(h.events[0].reservationId).toBe('lead')
    expect(h.events[0].reservationIds.length).toBe(3)
    expect(h.events[0].roomIds.sort()).toEqual(['r1', 'r2', 'r3'])
    expect(h.events[0].groupId).toBe('g1')
    expect(h.events[0].promoCode).toBe('PROMO10')
    expect(h.events[0].refundAmount).toBe(150)
  })

  it('reserva simple → pushAvailability(hotelId, roomId) exactamente 1 vez y reservationIds=[id]', async () => {
    const h = makeDeps({ withGroupsRepo: true })
    const res = await cancelPublicBooking(h.deps, 'res-1', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(h.pushed).toEqual([['h1', 'r1']])
    expect(res.body.reservationIds).toEqual(['res-1'])
    expect(res.body.roomsCount).toBe(1)
    expect(h.events.length).toBe(1)
    expect(h.events[0].reservationIds).toEqual(['res-1'])
    // Sin groupId no se toca `groups`.
    expect(h.groupUpdates.length).toBe(0)
  })

  it('grupo con una hermana checked_in → 409 y ninguna fila se toca (todo o nada)', async () => {
    const rows = groupOf3()
    rows[2].status = 'checked_in'
    const h = makeDeps({ reservations: rows, policies: moderate, withGroupsRepo: true })
    const res = await cancelPublicBooking(h.deps, 'lead', VALID_TOKEN)
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('check-in')
    expect(h.updates.length).toBe(0)
    expect(h.groupUpdates.length).toBe(0)
    expect(h.pushed.length).toBe(0)
    expect(h.events.length).toBe(0)
  })

  it('grupo ya cancelled → 200 idempotente sin evento ni inventario, con refundStatus de la fila', async () => {
    const rows = groupOf3('cancelled').map((r) => ({ ...r, refundAmount: 150, cancellationFee: 150, refundStatus: 'done', refundedAt: '2026-09-10T10:00:00.000Z' }))
    const h = makeDeps({ reservations: rows, withGroupsRepo: true })
    const res = await cancelPublicBooking(h.deps, 'sib-2', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.idempotent).toBe(true)
    expect(res.body.refundStatus).toBe('done')
    expect(res.body.refundedAt).toBe('2026-09-10T10:00:00.000Z')
    expect(res.body.roomsCount).toBe(3)
    expect(h.updates.length).toBe(0)
    expect(h.events.length).toBe(0)
    expect(h.pushed.length).toBe(0)
  })

  it('grupo sin pago (líder deposit 0) → nada que retener ni devolver', async () => {
    const rows = groupOf3().map((r) => ({ ...r, deposit: 0 }))
    const h = makeDeps({ reservations: rows, policies: moderate, withGroupsRepo: true })
    const res = await cancelPublicBooking(h.deps, 'lead', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.refundAmount).toBe(0)
    expect(res.body.cancellationFee).toBe(0)
    expect(res.body.refundStatus).toBe('none')
    expect(h.updates.length).toBe(3)
  })
})
