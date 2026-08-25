// reservas/tests/cancel-preview.test.ts — GET /api/reservas/:id/cancel-preview.
//
// El preview es el gemelo de solo-lectura de cancelReservation. Lo que se testea acá es
// exactamente lo que puede romperse en producción:
//   1. Que NO persista ni emita (si lo hace, "mirar" una reserva la cancela).
//   2. Que los montos coincidan con la cancelación real (si divergen, el recepcionista
//      confirma un reembolso distinto al que ve en pantalla).
//   3. Que canCancel/blockedReason expliquen el bloqueo en español en vez de tirar 409.
import { describe, it, expect } from 'bun:test'
import { Auth } from 'arckode-framework'
import { previewCancellation } from '../usecases/cancel-preview'
import { cancelReservation } from '../usecases/cancel'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL (mismo criterio que cancel.test.ts): un mock noop no detectaría una regresión
// en la firma de assertOwnership.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
const twoDaysAgo = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)

/** Repo que registra TODA escritura: el preview no debe producir ninguna. */
const repoWith = (item: any, writes: any[] = []) => ({
  findById: async () => item,
  update: async (_id: string, patch: any) => { writes.push(patch); return { ...item, ...patch } },
  create: async (data: any) => { writes.push(data); return data },
  delete: async (id: string) => { writes.push({ deleted: id }); return true },
}) as any

const policyRepoWith = (tiers: any[]) => ({
  findMany: async () => tiers.length === 0 ? [] : [{ id: 'p1', hotelId: HOTEL, scope: 'base', scopeId: '', name: 'Política del hotel', tiers, priority: 1, active: true }],
}) as any
const noPolicies = { findMany: async () => [] } as any
const hotelRepoWith = (over: Record<string, any> = {}) => ({
  findMany: async () => [{ id: HOTEL, cancellationType: 'flexible', currency: 'DOP', ...over }],
}) as any
const guestRepoWith = (name: string) => ({ findMany: async () => [{ id: 'g1', name }] }) as any

const baseItem = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', guestId: 'g1', status: 'confirmed',
  checkIn: inTwoDays(), checkOut: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10),
  deposit: 100, totalAmount: 400, currency: 'USD', ...over,
})

const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

describe('previewCancellation — no persiste ni emite', () => {
  it('no escribe en el repo de reservas', async () => {
    const writes: any[] = []
    const out = await previewCancellation(
      { repo: repoWith(baseItem(), writes), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 100, refundable: false }]), hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana Pérez') },
      'r1', user, realAuth,
    )
    expect(writes.length).toBe(0)
    expect(out.status).toBe('confirmed') // la reserva sigue confirmada
  })

  it('no recibe ni necesita sockets/cache (deps de escritura no existen en el contrato)', async () => {
    // Firma de CancelPreviewDeps: repo/policyRepo/hotelRepo/guestRepo. Ni cache ni sockets.
    // Si alguien los agrega para emitir algo, este test se vuelve obsoleto a propósito.
    const writes: any[] = []
    const deps = { repo: repoWith(baseItem(), writes), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') }
    expect(Object.keys(deps).sort()).toEqual(['guestRepo', 'hotelRepo', 'policyRepo', 'repo'])
    await previewCancellation(deps, 'r1', user, realAuth)
    expect(writes.length).toBe(0)
  })
})

describe('previewCancellation — refleja la penalidad REAL (mismos montos que cancel)', () => {
  it('non_refundable → fee=100, refund=0, refundable=false', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 100, refundable: false }]), hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.cancellationFee).toBe(100)
    expect(out.refundAmount).toBe(0)
    expect(out.refundable).toBe(false)
    expect(out.penaltyPercent).toBe(100)
  })

  it('el preview y la cancelación real dan los MISMOS montos (moderate a ~48h)', async () => {
    const tiers = [{ deadlineHours: 72, penaltyPercent: 0, refundable: true }, { deadlineHours: 0, penaltyPercent: 50, refundable: true }]
    const item = baseItem()
    const preview = await previewCancellation(
      { repo: repoWith(item), policyRepo: policyRepoWith(tiers), hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    const real = await cancelReservation(
      { repo: repoWith(item), policyRepo: policyRepoWith(tiers), hotelRepo: hotelRepoWith(), logger: noopLogger, cache: noopCache, sockets: { onReservationCancelled: async () => {} }, releaseChargeSessions: async () => {} },
      'r1', {}, user, realAuth,
    )
    expect(preview.cancellationFee).toBe(real.cancellationFee)
    expect(preview.refundAmount).toBe(real.refundAmount)
  })

  it("aplica el preset del hotel ('strict' sin políticas custom) igual que la cancelación real", async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith({ cancellationType: 'strict' }), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.policySource).toBe('preset')
    expect(out.cancellationFee).toBe(100)
    expect(out.refundAmount).toBe(0)
  })

  it('etiquetas: policyLabel de la política custom, tierLabel del tier matcheado', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 0, refundable: true, label: 'Cancelación gratis' }]), hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.policySource).toBe('custom')
    expect(out.policyLabel).toBe('Política del hotel')
    expect(out.tierLabel).toBe('Cancelación gratis')
  })

  it('sin label → cadena vacía, nunca undefined (el frontend renderiza el campo directo)', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: policyRepoWith([{ deadlineHours: 0, penaltyPercent: 25, refundable: true }]), hotelRepo: hotelRepoWith(), guestRepo: { findMany: async () => [] } as any },
      'r1', user, realAuth,
    )
    expect(out.tierLabel).toBe('')
    expect(out.guestName).toBe('')
  })
})

describe('previewCancellation — canCancel / blockedReason (200, nunca 409)', () => {
  it('checked_in → canCancel=false + motivo en español, SIN lanzar 409', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem({ status: 'checked_in' })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.canCancel).toBe(false)
    expect(out.blockedReason).toMatch(/check-in/i)
    expect(out.blockedReason).toMatch(/check-out/i)
    // Los montos se calculan igual: el usuario ve la penalidad vigente aunque no pueda cancelar.
    expect(typeof out.refundAmount).toBe('number')
  })

  it('checked_out → canCancel=false + motivo en español', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem({ status: 'checked_out' })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.canCancel).toBe(false)
    expect(out.blockedReason).toMatch(/check-out/i)
  })

  it('ya cancelada → canCancel=false + "ya está cancelada"', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem({ status: 'cancelled' })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.canCancel).toBe(false)
    expect(out.blockedReason).toBe('La reserva ya está cancelada.')
  })

  it('pending y confirmed → canCancel=true + blockedReason vacío', async () => {
    for (const status of ['pending', 'confirmed']) {
      const out = await previewCancellation(
        { repo: repoWith(baseItem({ status })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
        'r1', user, realAuth,
      )
      expect(out.canCancel).toBe(true)
      expect(out.blockedReason).toBe('')
    }
  })
})

describe('previewCancellation — contrato de respuesta', () => {
  it('devuelve exactamente los 18 campos del contrato', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana Pérez') },
      'r1', user, realAuth,
    )
    expect(Object.keys(out).sort()).toEqual([
      'blockedReason', 'canCancel', 'cancellationFee', 'checkIn', 'checkOut', 'currency',
      'deposit', 'guestName', 'hoursUntilCheckIn', 'penaltyPercent', 'policyLabel',
      'policySource', 'refundAmount', 'refundable', 'reservationId', 'status',
      'tierLabel', 'totalAmount',
    ])
  })

  it('hoursUntilCheckIn es NEGATIVO si el checkIn ya pasó', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem({ checkIn: twoDaysAgo() })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(out.hoursUntilCheckIn).toBeLessThan(0)
  })

  it('currency: la de la reserva gana; si no tiene, la del hotel; si no, USD', async () => {
    const conMoneda = await previewCancellation(
      { repo: repoWith(baseItem({ currency: 'EUR' })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(conMoneda.currency).toBe('EUR')

    const delHotel = await previewCancellation(
      { repo: repoWith(baseItem({ currency: '' })), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(delHotel.currency).toBe('DOP')

    const sinNada = await previewCancellation(
      { repo: repoWith(baseItem({ currency: null })), policyRepo: noPolicies, guestRepo: guestRepoWith('Ana') },
      'r1', user, realAuth,
    )
    expect(sinNada.currency).toBe('USD')
  })

  it('guestName se resuelve por guestRepo; falla-soft a "" si el repo explota', async () => {
    const ok = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana Pérez') },
      'r1', user, realAuth,
    )
    expect(ok.guestName).toBe('Ana Pérez')

    const boom = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: { findMany: async () => { throw new Error('db down') } } as any },
      'r1', user, realAuth,
    )
    expect(boom.guestName).toBe('')
  })
})

describe('previewCancellation — ownership', () => {
  it('bloquea a un usuario de otro hotel', async () => {
    const call = previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', { id: 'u2', role: 'hotel_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    await expect(call).rejects.toThrow()
  })

  it('deja pasar al super_admin de otro hotel', async () => {
    const out = await previewCancellation(
      { repo: repoWith(baseItem()), policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'r1', { id: 'u3', role: 'super_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    expect(out.reservationId).toBe('r1')
  })

  it('reserva inexistente → NotFoundError', async () => {
    const call = previewCancellation(
      { repo: { findById: async () => null } as any, policyRepo: noPolicies, hotelRepo: hotelRepoWith(), guestRepo: guestRepoWith('Ana') },
      'nope', user, realAuth,
    )
    await expect(call).rejects.toThrow(/no encontrada/i)
  })
})
