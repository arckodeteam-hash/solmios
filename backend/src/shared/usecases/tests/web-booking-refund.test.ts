import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { isRefundInFlight, refundCancelledWebBooking, webRefundIdempotencyKey, REFUND_PENDING_STALE_MS, SYSTEM_REFUND_ACTOR } from '../web-booking-refund'

const HOTEL = 'h1'

const CHARGE = { id: 'p1', type: 'charge', status: 'completed', amount: 200, stripeSessionId: 'cs_x', method: 'link' }

/** Grupo de 3: la líder (r1) tiene priceBreakdown y lleva el cobro; r2/r3 son hermanas. */
function groupRows() {
  return [
    { id: 'r1', hotelId: HOTEL, groupId: 'g1', currency: 'USD', priceBreakdown: { total: 200 }, refundStatus: 'none' },
    { id: 'r2', hotelId: HOTEL, groupId: 'g1', currency: 'USD', refundStatus: 'none' },
    { id: 'r3', hotelId: HOTEL, groupId: 'g1', currency: 'USD', refundStatus: 'none' },
  ]
}

interface Over {
  rows?: any[]
  /** paymentId → filas payments */
  payments?: Record<string, any[]>
  refundThrows?: boolean
  withNotify?: boolean
  /** Puerto `claimRefund`: `true`/`false` fijo, o una función. Sin él (undefined) el puerto no se cablea. */
  claim?: boolean | ((id: string) => Promise<boolean>)
  /** Si el doble de `refundPayment` asienta la fila `refund` en `payments` (como hace el módulo real). */
  recordRefundRow?: boolean
}

function harness(over: Over = {}) {
  const rows: any[] = over.rows ?? groupRows()
  const payments = over.payments ?? { r1: [CHARGE] }
  const refunds: any[] = []
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const notified: any[] = []
  const claims: string[] = []
  const deps: any = {
    payments: {
      paymentsLinkedTo: async (_hotelId: string, ref: { reservationId: string }) => payments[ref.reservationId] ?? [],
      refundPayment: async (paymentId: string, amount?: number, user?: any, reason?: string, idempotencyKey?: string) => {
        refunds.push({ paymentId, amount, user, reason, idempotencyKey })
        if (over.refundThrows) throw new Error('stripe caído')
        const row = { id: 're-1', type: 'refund', status: 'completed', amount, metadata: { refundOf: paymentId, reason }, createdAt: '2026-09-10T10:00:00.000Z' }
        if (over.recordRefundRow) for (const list of Object.values(payments)) if (list.some((p) => p.id === paymentId)) list.push(row)
        return row
      },
    },
    reservations: {
      findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
      findMany: async (where: Record<string, unknown>) =>
        rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v)),
      update: async (id: string, patch: Record<string, unknown>) => {
        updates.push({ id, patch })
        const row = rows.find((r) => r.id === id)
        if (row) Object.assign(row, patch)
        return row
      },
      ...(over.claim === undefined ? {} : {
        claimRefund: async (id: string) => {
          claims.push(id)
          return typeof over.claim === 'function' ? over.claim(id) : over.claim
        },
      }),
    },
    notifyHotel: over.withNotify === false
      ? undefined
      : async (hotelId: string, n: any) => { notified.push({ hotelId, ...n }) },
    logger: silentLogger(),
  }
  return { deps, rows, refunds, updates, notified, claims }
}

describe('refundCancelledWebBooking', () => {
  it('pagada 200 / refundAmount 100 → refundPayment(p1, 100, system, guest_cancellation) y done en las 3 filas', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.refunds).toHaveLength(1)
    expect(h.refunds[0].paymentId).toBe('p1')
    expect(h.refunds[0].amount).toBe(100)
    expect(h.refunds[0].user).toEqual(SYSTEM_REFUND_ACTOR)
    expect(h.refunds[0].user.id).toBe('system')
    expect(h.refunds[0].reason).toBe('guest_cancellation')
    for (const r of h.rows) {
      expect(r.refundStatus).toBe('done')
      expect(typeof r.refundedAt).toBe('string')
      expect(r.refundPaymentId).toBe('re-1')
    }
    // pasó por pending antes de done
    expect(h.updates.filter((u) => u.patch.refundStatus === 'pending')).toHaveLength(3)
    expect(h.notified).toHaveLength(0)
  })

  it('nunca devuelve más de lo cobrado: refundAmount 500 sobre cobro 200 → 200', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 500 })
    expect(out.status).toBe('done')
    expect(h.refunds[0].amount).toBe(200)
  })

  it('refundAmount 0 → no llama a la pasarela y deja none', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 0 })
    expect(out).toEqual({ status: 'none' })
    expect(h.refunds).toHaveLength(0)
    for (const r of h.rows) expect(r.refundStatus).toBe('none')
    expect(h.notified).toHaveLength(0)
  })

  it('refundPayment lanza → failed en las 3 filas y aviso al hotel "Reembolso de … pendiente"', async () => {
    const h = harness({ refundThrows: true })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out.status).toBe('failed')
    expect((out as any).error).toBe('stripe caído')
    expect(h.refunds).toHaveLength(1)
    for (const r of h.rows) {
      expect(r.refundStatus).toBe('failed')
      expect(r.refundPaymentId).toBeUndefined()
    }
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].hotelId).toBe(HOTEL)
    expect(h.notified[0].title).toContain('Reembolso de')
    expect(h.notified[0].title).toContain('100.00 USD')
    expect(h.notified[0].title).toContain('pendiente')
    expect(h.notified[0].metadata).toMatchObject({ reservationId: 'r1', refundAmount: 100 })
    expect(String(h.notified[0].metadata.link)).toContain('/panel/reservations?')
    expect(String(h.notified[0].metadata.link)).toContain('r1')
  })

  it('ya done → skipped already_done y no vuelve a llamar a la pasarela', async () => {
    const rows = groupRows().map((r) => ({ ...r, refundStatus: 'done', refundPaymentId: 're-0', refundedAt: '2026-09-01T00:00:00.000Z' }))
    const h = harness({ rows })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'skipped', reason: 'already_done' })
    expect(h.refunds).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(h.rows[0].refundPaymentId).toBe('re-0')
  })

  it('sin cobro Stripe (pago pending o sin referencia) → failed + aviso al hotel', async () => {
    const h = harness({
      payments: { r1: [{ id: 'p9', type: 'charge', status: 'pending', amount: 200 }, { id: 'p8', type: 'refund', status: 'completed', amount: 50, stripePaymentId: 'pi_z' }] },
    })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'failed', error: 'no_stripe_payment' })
    expect(h.refunds).toHaveLength(0)
    for (const r of h.rows) expect(r.refundStatus).toBe('failed')
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].title).toContain('Reembolso de')
    expect(h.notified[0].title).toContain('pendiente')
  })

  it('cancelada desde la hermana: encuentra el cobro de la LÍDER y marca todo el grupo', async () => {
    const h = harness()
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r3', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.refunds[0].paymentId).toBe('p1')
    expect(h.rows.map((r) => r.refundStatus)).toEqual(['done', 'done', 'done'])
    expect(h.rows.map((r) => r.refundPaymentId)).toEqual(['re-1', 're-1', 're-1'])
  })

  it('reserva inexistente o de otro hotel → skipped not_found sin tocar nada', async () => {
    const h = harness()
    expect(await refundCancelledWebBooking(h.deps, { reservationId: 'nope', hotelId: HOTEL, refundAmount: 100 }))
      .toEqual({ status: 'skipped', reason: 'not_found' })
    expect(await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: 'h2', refundAmount: 100 }))
      .toEqual({ status: 'skipped', reason: 'not_found' })
    expect(h.refunds).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
  })

  it('reserva simple (sin groupId) → sólo esa fila cambia', async () => {
    const h = harness({
      rows: [{ id: 's1', hotelId: HOTEL, currency: 'EUR', refundStatus: 'none' }],
      payments: { s1: [{ id: 'p5', status: 'completed', amount: 80, stripePaymentId: 'pi_5' }] },
    })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 's1', hotelId: HOTEL, refundAmount: 40 })
    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 40 })
    expect(h.refunds[0].paymentId).toBe('p5')
    expect(h.updates.map((u) => u.id)).toEqual(['s1', 's1'])
  })

  // ── Idempotencia contra el doble reembolso (hallazgo del revisor): Stripe NO rechaza dos refunds
  //    parciales del mismo cobro (200 cobrados, dos refunds de 100 salen los dos). ──────────────
  it('ya hay fila refund con refundOf al cobro (la reserva no lo sabía) → NO llama a la pasarela, repara done con esa fila', async () => {
    const REFUND_ROW = { id: 'rf-1', type: 'refund', status: 'completed', amount: 100, metadata: { refundOf: 'p1', reason: 'guest_cancellation' }, createdAt: '2026-09-09T12:00:00.000Z' }
    const h = harness({ payments: { r1: [CHARGE, REFUND_ROW] }, claim: true })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out).toEqual({ status: 'done', refundPaymentId: 'rf-1', amount: 100 })
    expect(h.refunds).toHaveLength(0)
    expect(h.claims).toHaveLength(0) // ni siquiera reclama: no hay nada que ejecutar
    for (const r of h.rows) {
      expect(r.refundStatus).toBe('done')
      expect(r.refundPaymentId).toBe('rf-1')
      expect(r.refundedAt).toBe('2026-09-09T12:00:00.000Z')
    }
    expect(h.updates.filter((u) => u.patch.refundStatus === 'pending')).toHaveLength(0)
    expect(h.notified).toHaveLength(0)
  })

  it('una fila refund de OTRO cobro (refundOf distinto) no bloquea el reembolso', async () => {
    const OTHER = { id: 'rf-9', type: 'refund', status: 'completed', amount: 30, metadata: { refundOf: 'p-otro', reason: 'guest_cancellation' } }
    const h = harness({ payments: { r1: [OTHER, CHARGE] } })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.refunds).toHaveLength(1)
  })

  it('claimRefund devuelve false (otra invocación en curso) → skipped in_progress, sin llamar ni escribir', async () => {
    const h = harness({ claim: false })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out).toEqual({ status: 'skipped', reason: 'in_progress' })
    expect(h.claims).toEqual(['r1'])
    expect(h.refunds).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(h.notified).toHaveLength(0)
    for (const r of h.rows) expect(r.refundStatus).toBe('none')
  })

  it('claimRefund true → reclama ANTES de pending/Stripe y sigue el camino normal', async () => {
    const order: string[] = []
    const h = harness({ claim: async () => { order.push('claim'); return true } })
    const origRefund = h.deps.payments.refundPayment
    h.deps.payments.refundPayment = async (...a: any[]) => { order.push('stripe'); return origRefund(...a) }
    const origUpdate = h.deps.reservations.update
    h.deps.reservations.update = async (id: string, patch: any) => { order.push(`update:${patch.refundStatus}`); return origUpdate(id, patch) }

    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out.status).toBe('done')
    expect(order[0]).toBe('claim')
    expect(order.indexOf('claim')).toBeLessThan(order.indexOf('update:pending'))
    expect(order.indexOf('update:pending')).toBeLessThan(order.indexOf('stripe'))
  })

  it('dos invocaciones concurrentes con un claim CAS real → UN solo refund; el perdedor sale in_progress', async () => {
    let claimed = false
    const h = harness({ claim: async () => { if (claimed) return false; claimed = true; return true } })
    const input = { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 }
    const [a, b] = await Promise.all([refundCancelledWebBooking(h.deps, input), refundCancelledWebBooking(h.deps, input)])

    expect([a.status, b.status].sort()).toEqual(['done', 'skipped'])
    expect([a, b].find((o) => o.status === 'skipped')).toEqual({ status: 'skipped', reason: 'in_progress' })
    expect(h.refunds).toHaveLength(1)
    for (const r of h.rows) expect(r.refundStatus).toBe('done')
  })

  it('invocación repetida sobre el mismo doble (la segunda ya ve done) → un solo refund', async () => {
    const h = harness({ claim: true, recordRefundRow: true })
    const input = { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 }
    const first = await refundCancelledWebBooking(h.deps, input)
    const second = await refundCancelledWebBooking(h.deps, input)

    expect(first).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(second).toEqual({ status: 'skipped', reason: 'already_done' })
    expect(h.refunds).toHaveLength(1)
    expect(h.claims).toEqual(['r1'])
  })

  it('el refund salió pero la escritura de done falló → el reintento ve el asiento en payments y NO repite el refund', async () => {
    const h = harness({ claim: true, recordRefundRow: true })
    // Primera vez: `update` de 'done' revienta en todas las filas (updateAll traga el error). Queda 'pending'.
    const origUpdate = h.deps.reservations.update
    h.deps.reservations.update = async (id: string, patch: any) => {
      if (patch.refundStatus === 'done') throw new Error('db caída')
      return origUpdate(id, patch)
    }
    const input = { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 }
    const first = await refundCancelledWebBooking(h.deps, input)
    expect(first).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.rows.map((r) => r.refundStatus)).toEqual(['pending', 'pending', 'pending'])

    // Reintento con la base sana: no hay segundo refundPayment, se repara el estado con la fila re-1.
    h.deps.reservations.update = origUpdate
    const second = await refundCancelledWebBooking(h.deps, input)
    expect(second).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.refunds).toHaveLength(1)
    for (const r of h.rows) {
      expect(r.refundStatus).toBe('done')
      expect(r.refundPaymentId).toBe('re-1')
    }
  })

  // ── Hallazgo del revisor: el CAS por `updatedAt` no ve un `pending` que ya estaba (nadie lo pisó
  //    mientras tanto). Un `pending` FRESCO es un reembolso en vuelo; uno VIEJO es un proceso muerto. ──
  it('pending FRESCO (escrito hace 1 min) → skipped in_progress sin reclamar, llamar ni escribir', async () => {
    const updatedAt = new Date(Date.now() - 60_000).toISOString()
    const rows = groupRows().map((r) => ({ ...r, refundStatus: 'pending', updatedAt }))
    const h = harness({ rows, claim: true })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out).toEqual({ status: 'skipped', reason: 'in_progress' })
    expect(h.claims).toHaveLength(0)
    expect(h.refunds).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(h.notified).toHaveLength(0)
  })

  it('pending VIEJO (de hace 15 min, proceso muerto tras reclamar) → sí reintenta y termina done', async () => {
    const updatedAt = new Date(Date.now() - 15 * 60_000).toISOString()
    const rows = groupRows().map((r) => ({ ...r, refundStatus: 'pending', updatedAt }))
    const h = harness({ rows, claim: true })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })

    expect(out).toEqual({ status: 'done', refundPaymentId: 're-1', amount: 100 })
    expect(h.claims).toEqual(['r1'])
    expect(h.refunds).toHaveLength(1)
    for (const r of h.rows) expect(r.refundStatus).toBe('done')
  })

  it('con actor dado (el hotel reintentando) → refundPayment recibe ESE actor y no SYSTEM', async () => {
    const h = harness()
    const actor = { id: 'u-admin', role: 'hotel_admin' }
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100, actor })
    expect(out.status).toBe('done')
    expect(h.refunds[0].user).toEqual(actor)
    expect(h.refunds[0].user.id).not.toBe(SYSTEM_REFUND_ACTOR.id)
  })

  // #272 (revisión): Stripe devuelve ANTES de que `payments` asiente la fila; si ese asiento falla, las capas
  // 1-3 no ven nada y el reintento pediría un refund NUEVO. La clave de idempotencia es la misma en los dos
  // intentos (cobro + centavos), así la pasarela devuelve el original en vez de sacar plata dos veces.
  it('refund falló (asiento no grabado) y el hotel reintenta → las DOS llamadas llevan la MISMA idempotencyKey', async () => {
    const h = harness({ refundThrows: true })
    const first = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(first.status).toBe('failed')

    h.deps.payments.refundPayment = async (paymentId: string, amount?: number, user?: any, reason?: string, idempotencyKey?: string) => {
      h.refunds.push({ paymentId, amount, user, reason, idempotencyKey })
      return { id: 're-2' }
    }
    // Reintento desde una HERMANA: el cobro es el mismo, la clave también.
    const second = await refundCancelledWebBooking(h.deps, { reservationId: 'r3', hotelId: HOTEL, refundAmount: 100, actor: { id: 'u-7', role: 'hotel_admin' } })
    expect(second.status).toBe('done')

    expect(h.refunds).toHaveLength(2)
    expect(h.refunds[0].idempotencyKey).toBe(webRefundIdempotencyKey('p1', 100))
    expect(h.refunds[1].idempotencyKey).toBe(h.refunds[0].idempotencyKey)
    expect(h.refunds[0].idempotencyKey).toBe('web-refund:p1:10000')
  })

  it('sin notifyHotel el fallo no rompe', async () => {
    const h = harness({ refundThrows: true, withNotify: false })
    const out = await refundCancelledWebBooking(h.deps, { reservationId: 'r1', hotelId: HOTEL, refundAmount: 100 })
    expect(out.status).toBe('failed')
  })
})

describe('isRefundInFlight', () => {
  const now = Date.parse('2026-09-12T12:00:00.000Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('pending fresco → true; al borde de REFUND_PENDING_STALE_MS y más viejo → false', () => {
    expect(isRefundInFlight({ refundStatus: 'pending', updatedAt: ago(1_000) }, now)).toBe(true)
    expect(isRefundInFlight({ refundStatus: 'pending', updatedAt: ago(REFUND_PENDING_STALE_MS - 1) }, now)).toBe(true)
    expect(isRefundInFlight({ refundStatus: 'pending', updatedAt: ago(REFUND_PENDING_STALE_MS) }, now)).toBe(false)
    expect(isRefundInFlight({ refundStatus: 'pending', updatedAt: ago(15 * 60_000) }, now)).toBe(false)
  })

  it('cualquier otro estado, o pending sin updatedAt válido → false (nunca cuelga el reembolso)', () => {
    expect(isRefundInFlight({ refundStatus: 'none', updatedAt: ago(1_000) }, now)).toBe(false)
    expect(isRefundInFlight({ refundStatus: 'failed', updatedAt: ago(1_000) }, now)).toBe(false)
    expect(isRefundInFlight({ refundStatus: 'done', updatedAt: ago(1_000) }, now)).toBe(false)
    expect(isRefundInFlight({ refundStatus: 'pending' }, now)).toBe(false)
    expect(isRefundInFlight({ refundStatus: 'pending', updatedAt: 'no-es-fecha' }, now)).toBe(false)
  })
})
