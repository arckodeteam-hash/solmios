// reservas/tests/cancel.test.ts — F2 plan #627 (políticas de cancelación).
//
// Cubre el usecase cancelReservation (no el HTTP controller): el guard de permiso
// `reservations:edit` es middleware HTTP y se testea en integración; acá se prueba
// la lógica de negocio: ownership, state machine, cálculo de montos (vía F1),
// idempotencia y emisión del socket onReservationCancelled.
//
// computePenalty (F1) ya tiene sus propios tests en cancellation/tests; acá solo
// verificamos que el usecase lo invoca correctamente y persiste el snapshot.
import { describe, it, expect } from 'bun:test'
import { Auth } from 'arckode-framework'
import { cancelReservation } from '../usecases/cancel'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL (igual que ownership.test.ts): si la firma de assertOwnership vuelve a
// romperse, este test falla — no acepta cualquier cosa como un mock noop.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'

/** Fecha date-only ~48h en el futuro (determinística dentro del rango 47-49h). */
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)

/** Repo mock. update fusiona el patch y devuelve el item con los campos persistidos. */
const repoWith = (item: any, opts: { updated?: any[] } = {}) => ({
  findById: async () => item,
  update: async (_id: string, patch: any) => {
    const merged = { ...item, ...patch }
    opts.updated?.push(merged)
    return merged
  },
}) as any

/** policyRepo que devuelve una política base con los tiers pedidos. */
const policyRepoWith = (tiers: any[]) => ({
  findMany: async () => [{ id: 'p1', hotelId: HOTEL, scope: 'base', scopeId: '', name: 'test', tiers, priority: 1, active: true }],
}) as any

const baseItem = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', status: 'confirmed',
  checkIn: inTwoDays(), deposit: 100, ...over,
})

const userSameHotel = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

describe('cancelReservation — ownership (con Auth real)', () => {
  it('deja cancelar al usuario del mismo hotel', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.status).toBe('cancelled')
  })

  it('bloquea al usuario de otro hotel (no super_admin)', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const call = cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, { id: 'u2', role: 'hotel_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    await expect(call).rejects.toThrow()
  })

  it('deja pasar al super_admin de otro hotel', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, { id: 'u3', role: 'super_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    expect(out.status).toBe('cancelled')
  })
})

describe('cancelReservation — state machine (assertValidTransition)', () => {
  it('lanza 409 al cancelar una reserva checked_in', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const call = cancelReservation(
      { repo: repoWith(baseItem({ status: 'checked_in' })), policyRepo: policyRepoWith([]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    await expect(call).rejects.toThrow(/no permitida/i)
  })

  it('lanza 409 al cancelar una reserva checked_out', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const call = cancelReservation(
      { repo: repoWith(baseItem({ status: 'checked_out' })), policyRepo: policyRepoWith([]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    await expect(call).rejects.toThrow(/no permitida/i)
  })

  it('permite cancelar desde pending y desde confirmed', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    for (const status of ['pending', 'confirmed']) {
      const out = await cancelReservation(
        { repo: repoWith(baseItem({ status })), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
        'r1', {}, userSameHotel, realAuth,
      )
      expect(out.status).toBe('cancelled')
    }
  })
})

describe('cancelReservation — cálculo de montos (computePenalty F1)', () => {
  // deposit = 100 en baseItem. checkIn ~48h → hoursRemaining ~48.
  it('flexible → refundAmount=100, cancellationFee=0', async () => {
    const updated: any[] = []
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem(), { updated }), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.refundAmount).toBe(100)
    expect(out.cancellationFee).toBe(0)
  })

  it('moderate a ~48h → refundAmount=50, cancellationFee=50', async () => {
    const updated: any[] = []
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem(), { updated }), policyRepo: policyRepoWith([{ deadlineHours: 72, penaltyPercent: 0, refundable: true }, { deadlineHours: 0, penaltyPercent: 50, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.refundAmount).toBe(50)
    expect(out.cancellationFee).toBe(50)
  })

  it('non_refundable → refundAmount=0, cancellationFee=100', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 100, refundable: false }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.refundAmount).toBe(0)
    expect(out.cancellationFee).toBe(100)
  })

  it('persiste el snapshot: cancelledAt, cancellationReason, policyApplied', async () => {
    const updated: any[] = []
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem(), { updated }), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', { reason: 'Cambio de planes' }, userSameHotel, realAuth,
    )
    expect(out.cancelledAt).toBeTruthy()
    expect(out.cancellationReason).toBe('Cambio de planes')
    expect(out.policyApplied).toBeTruthy()
    expect(updated[0].policyApplied).toBeTruthy()
  })

  it('reason opcional → cadena vacía si no se provee', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.cancellationReason).toBe('')
  })
})

describe('cancelReservation — preset del hotel (hotels.cancellationType)', () => {
  // BUG: public-rates.ts SÍ pasa hotelCancellationType a resolvePolicy (lo que el widget
  // ANUNCIA al huésped), pero cancel.ts NO → la cancelación REAL caía a default flexible.
  // Un hotel 'strict' sin filas custom anunciaba 100% de penalidad y devolvía el 100%.
  const hotelRepoWith = (cancellationType: string | null) => ({
    findMany: async () => [{ id: HOTEL, cancellationType }],
  }) as any
  const noPolicies = { findMany: async () => [] } as any

  it("hotel 'strict' sin políticas custom → aplica el preset (fee=100, refund=0)", async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith('strict'), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    // strict: 0% si >168h; 100% si <=168h. checkIn ~48h → 100% de penalidad.
    expect(out.cancellationFee).toBe(100)
    expect(out.refundAmount).toBe(0)
    expect(out.policyApplied.source).toBe('preset')
  })

  it("hotel 'moderate' sin políticas custom → 50% a ~48h", async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith('moderate'), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.cancellationFee).toBe(50)
    expect(out.refundAmount).toBe(50)
  })

  it('política custom del hotel GANA sobre el preset (precedencia base > preset)', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), hotelRepo: hotelRepoWith('strict'), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.refundAmount).toBe(100)
    expect(out.policyApplied.source).toBe('custom')
  })

  it('fail-soft: si el hotelRepo explota, cancela igual con el comportamiento previo', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const boom = { findMany: async () => { throw new Error('db down') } } as any
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: boom, logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.status).toBe('cancelled')
    expect(out.policyApplied.source).toBe('default')
  })

  it('sin hotelRepo cableado → default flexible (no rompe)', async () => {
    const sockets = { onReservationCancelled: async () => {} }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.status).toBe('cancelled')
    expect(out.policyApplied.source).toBe('default')
  })
})

describe('cancelReservation — idempotencia', () => {
  it('ya cancelled → no-op: no recalcula ni re-emite socket', async () => {
    let socketCalls = 0
    const sockets = { onReservationCancelled: async () => { socketCalls++ } }
    const item = baseItem({ status: 'cancelled', cancelledAt: '2026-01-01T00:00:00Z', refundAmount: 30 })
    const out = await cancelReservation(
      { repo: repoWith(item), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 100, refundable: false }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', { reason: 're-cancel' }, userSameHotel, realAuth,
    )
    // Devuelve la reserva sin re-procesar.
    expect(out.status).toBe('cancelled')
    expect(out.refundAmount).toBe(30) // NO recalculó a 0 con la política non_refundable nueva
    expect(socketCalls).toBe(0) // NO re-emitió socket
  })
})

describe('cancelReservation — socket onReservationCancelled', () => {
  it('se emite una vez con los montos correctos', async () => {
    const events: any[] = []
    const sockets = { onReservationCancelled: async (data: any) => { events.push(data) } }
    await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 100, refundable: false }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(events.length).toBe(1)
    expect(events[0].reservationId).toBe('r1')
    expect(events[0].hotelId).toBe(HOTEL)
    expect(events[0].refundAmount).toBe(0)
    expect(events[0].cancellationFee).toBe(100)
    expect(events[0].policyApplied).toBeTruthy()
  })

  it('si el socket falla, NO rompe la cancelación (safeEmit)', async () => {
    const sockets = { onReservationCancelled: async () => { throw new Error('connector down') } }
    const out = await cancelReservation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 99999, penaltyPercent: 0, refundable: true }]), logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {} },
      'r1', {}, userSameHotel, realAuth,
    )
    expect(out.status).toBe('cancelled')
  })
})
