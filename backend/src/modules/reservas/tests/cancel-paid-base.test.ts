// reservas/tests/cancel-paid-base.test.ts — La penalidad se calcula sobre LO COBRADO, no sobre la
// columna `deposit`.
//
// Bug reproducido en E2E el 2026-09-15: reserva cobrada 400 en efectivo ("Marcar pagada", fila en
// `payments` sin tocar `deposit`), política 50% → preview y cancelación daban fee 0 / refund 0,
// como si el huésped no hubiera pagado nada. Estos tests usan el `paidSourceFrom` REAL sobre repos
// en memoria: si alguien vuelve a leer `item.deposit`, fallan.
import { describe, it, expect } from 'bun:test'
import { Auth } from 'arckode-framework'
import { previewCancellation } from '../usecases/cancel-preview'
import { cancelReservation } from '../usecases/cancel'
import { cancellationBaseOf } from '../usecases/cancel-base'
import { paidSourceFrom } from '../../../shared/usecases/reservation-paid'
import { presetLabel, resolvePolicy } from '../../../shared/usecases/cancellation-math'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const realAuth = new Auth({ sign: () => '', verify: () => ({}) } as any, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
const inFourDays = () => new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10)

/** Moderada: gratis >72h, 50% dentro de las 72h. La reserva entra en 2 días → 50%. */
const MODERATE_TIERS = [
  { deadlineHours: 72, penaltyPercent: 0, refundable: true, label: 'Gratis hasta 72 h antes' },
  { deadlineHours: 0, penaltyPercent: 50, refundable: true, label: '50% dentro de las 72 h' },
]
const policyRepo = { findMany: async () => [{ id: 'p1', hotelId: HOTEL, scope: 'base', scopeId: '', name: 'Moderada', tiers: MODERATE_TIERS, active: true }] } as any

const reservation = (over: Record<string, any> = {}) => ({
  id: 'r1', hotelId: HOTEL, roomId: 'room-1', guestId: 'g1', status: 'confirmed',
  checkIn: inTwoDays(), checkOut: inFourDays(), deposit: 0, totalAmount: 400, currency: 'USD', ...over,
})

function repoWith(item: any, writes: any[] = []) {
  return {
    findById: async () => item,
    findMany: async () => [item],
    update: async (_id: string, patch: any) => { writes.push(patch); return { ...item, ...patch } },
  } as any
}

/** Repos de dinero en memoria con la forma exacta que consume `paidForReservation`. */
function moneyRepos(payments: any[]) {
  return paidSourceFrom({
    folioRepo: { findMany: async () => [] },
    invoiceRepo: { findMany: async () => [] },
    paymentRepo: {
      findMany: async (where: any) => payments.filter((p) => p.hotelId === where.hotelId
        && (where.reservationId ? p.reservationId === where.reservationId : true)
        && (where.folioId ? p.folioId === where.folioId : true)
        && (where.invoiceId ? p.invoiceId === where.invoiceId : true)),
    },
  })
}

const CASH_400 = [{ id: 'pay-1', hotelId: HOTEL, reservationId: 'r1', type: 'charge', status: 'completed', amount: 400, method: 'cash' }]

describe('cancelación — base = lo cobrado (payments), no la columna deposit', () => {
  it('preview: cobro en efectivo de 400 con 50% → penalidad 200, devolver 200', async () => {
    const out = await previewCancellation(
      { repo: repoWith(reservation()), policyRepo, paidOf: moneyRepos(CASH_400) },
      'r1', user, realAuth,
    )
    expect(out.deposit).toBe(400)
    expect(out.cancellationFee).toBe(200)
    expect(out.refundAmount).toBe(200)
  })

  it('cancelación real persiste los MISMOS montos que el preview', async () => {
    const writes: any[] = []
    const sockets = { onReservationCancelled: async () => {} }
    await cancelReservation(
      { repo: repoWith(reservation(), writes), policyRepo, logger: noopLogger, cache: noopCache, sockets, releaseChargeSessions: async () => {}, paidOf: moneyRepos(CASH_400) },
      'r1', { reason: 'Solicitud del huésped' }, user, realAuth,
    )
    expect(writes[0]).toMatchObject({ status: 'cancelled', cancellationFee: 200, refundAmount: 200 })
  })

  it('un reembolso ya hecho se descuenta de la base', async () => {
    const rows = [...CASH_400, { id: 'ref-1', hotelId: HOTEL, reservationId: 'r1', type: 'refund', status: 'completed', amount: 100 }]
    const out = await previewCancellation({ repo: repoWith(reservation()), policyRepo, paidOf: moneyRepos(rows) }, 'r1', user, realAuth)
    expect(out.deposit).toBe(300)
    expect(out.refundAmount).toBe(150)
  })

  it('anticipo manual en deposit (sin payments) sigue contando', async () => {
    const out = await previewCancellation({ repo: repoWith(reservation({ deposit: 1947 })), policyRepo, paidOf: moneyRepos([]) }, 'r1', user, realAuth)
    expect(out.deposit).toBe(1947)
  })
})

describe('cancelación — queda en el historial de la reserva', () => {
  const coreDeps = (item: any, audit: any) => ({
    repo: repoWith(item), policyRepo, logger: noopLogger, cache: noopCache,
    sockets: { onReservationCancelled: async () => {} }, releaseChargeSessions: async () => {},
    paidOf: moneyRepos(CASH_400), audit,
  })

  it('registra quién, el motivo y los montos aplicados', async () => {
    const entries: any[] = []
    await cancelReservation(coreDeps(reservation(), (e: any) => { entries.push(e) }), 'r1', { reason: 'Sobreventa' }, user, realAuth)
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({ hotelId: HOTEL, userId: 'u1' })
    expect(JSON.parse(entries[0].detail)).toMatchObject({ previousStatus: 'confirmed', reason: 'Sobreventa', cancellationFee: 200, refundAmount: 200 })
  })

  it('una reserva ya cancelada no genera otra entrada', async () => {
    const entries: any[] = []
    await cancelReservation(coreDeps(reservation({ status: 'cancelled' }), (e: any) => { entries.push(e) }), 'r1', { reason: 'x' }, user, realAuth)
    expect(entries.length).toBe(0)
  })

  it('si el historial falla, la cancelación igual se devuelve', async () => {
    const out = await cancelReservation(coreDeps(reservation(), () => { throw new Error('audit caído') }), 'r1', { reason: 'x' }, user, realAuth)
    expect(out.status).toBe('cancelled')
  })
})

describe('cancellationBaseOf — tolerante a fallas', () => {
  it('sin paidOf usa la columna deposit', async () => {
    expect(await cancellationBaseOf(undefined, { id: 'r1', hotelId: HOTEL, deposit: 80 })).toBe(80)
  })

  it('si leer los pagos falla, usa deposit y avisa por log (no bloquea la cancelación)', async () => {
    const warnings: unknown[] = []
    const base = await cancellationBaseOf(async () => { throw new Error('payments caído') }, { id: 'r1', hotelId: HOTEL, deposit: 55 }, { warn: (...a: unknown[]) => { warnings.push(a) } } as any)
    expect(base).toBe(55)
    expect(warnings.length).toBe(1)
  })
})

describe('nombre de la política en español', () => {
  it('los presets se muestran traducidos', () => {
    expect(presetLabel('flexible')).toBe('Flexible')
    expect(presetLabel('moderate')).toBe('Moderada')
    expect(presetLabel('strict')).toBe('Estricta')
    expect(presetLabel('non_refundable')).toBe('No reembolsable')
  })

  it("hotel 'strict' sin política propia → label 'Estricta' (policyId sigue 'strict')", async () => {
    const policy = await resolvePolicy({ findMany: async () => [] } as any, HOTEL, undefined, 'strict')
    expect(policy.label).toBe('Estricta')
    expect(policy.policyId).toBe('strict')
  })
})

describe('cancelación — publica la disponibilidad liberada en el channel manager (#1 revisión 2026-09-15)', () => {
  const deps = (item: any, pushAvailability: any) => ({
    repo: repoWith(item), policyRepo, logger: noopLogger, cache: noopCache,
    sockets: { onReservationCancelled: async () => {} }, releaseChargeSessions: async () => {},
    paidOf: moneyRepos([]), pushAvailability,
  })

  it('cancelar desde el panel empuja la habitación liberada', async () => {
    const pushed: [string, string][] = []
    await cancelReservation(deps(reservation(), (h: string, r: string) => { pushed.push([h, r]) }), 'r1', { reason: 'x' }, user, realAuth)
    expect(pushed).toEqual([[HOTEL, 'room-1']])
  })

  it('la cancelación de sistema (OTA/IA) también empuja', async () => {
    const { cancelReservationBySystem } = await import('../usecases/cancel-system')
    const pushed: [string, string][] = []
    await cancelReservationBySystem(deps(reservation(), (h: string, r: string) => { pushed.push([h, r]) }) as any, 'r1', { hotelId: HOTEL, reason: 'OTA', penaltyMode: 'channel-managed' } as any)
    expect(pushed).toEqual([[HOTEL, 'room-1']])
  })

  it('una reserva ya cancelada no vuelve a empujar', async () => {
    const pushed: unknown[] = []
    await cancelReservation(deps(reservation({ status: 'cancelled' }), () => { pushed.push(1) }), 'r1', { reason: 'x' }, user, realAuth)
    expect(pushed.length).toBe(0)
  })

  it('reserva sin habitación asignada: no empuja y no rompe', async () => {
    const pushed: unknown[] = []
    const out = await cancelReservation(deps(reservation({ roomId: null }), () => { pushed.push(1) }), 'r1', { reason: 'x' }, user, realAuth)
    expect(pushed.length).toBe(0)
    expect(out.status).toBe('cancelled')
  })

  it('si el push tira, la cancelación igual queda hecha', async () => {
    const out = await cancelReservation(deps(reservation(), () => { throw new Error('channex caído') }), 'r1', { reason: 'x' }, user, realAuth)
    expect(out.status).toBe('cancelled')
  })
})

describe('cancelación — aviso al huésped por correo', () => {
  const deps = (notifyGuest: any) => ({
    repo: repoWith(reservation()), policyRepo, logger: noopLogger, cache: noopCache,
    sockets: { onReservationCancelled: async () => {} }, releaseChargeSessions: async () => {},
    paidOf: moneyRepos([]), notifyGuest,
  })

  it('con notifyGuest:true avisa una vez, con la reserva y el hotel', async () => {
    const calls: unknown[][] = []
    await cancelReservation(deps(async (...a: unknown[]) => { calls.push(a) }), 'r1', { reason: 'Sobreventa', notifyGuest: true }, user, realAuth)
    expect(calls).toEqual([['r1', HOTEL]])
  })

  it('sin notifyGuest (cliente viejo / app móvil) no manda nada', async () => {
    const calls: unknown[] = []
    await cancelReservation(deps(async () => { calls.push(1) }), 'r1', { reason: 'x' }, user, realAuth)
    await cancelReservation(deps(async () => { calls.push(1) }), 'r1', { reason: 'x', notifyGuest: false }, user, realAuth)
    expect(calls).toHaveLength(0)
  })

  it('si el correo falla, la cancelación igual se devuelve', async () => {
    const out = await cancelReservation(deps(async () => { throw new Error('smtp caído') }), 'r1', { reason: 'x', notifyGuest: true }, user, realAuth)
    expect(out.status).toBe('cancelled')
  })
})
