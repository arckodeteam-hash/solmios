// reservas/tests/mark-paid.test.ts — REQ-RWP-06 (#249): registrar pago manual sobre una reserva.
//
// Cubre el usecase markReservationPaid (no el HTTP controller): que la plata se asienta en
// `payments` por el puerto ANTES de tocar la reserva, que el saldo/estado de pago salen de la
// fórmula compartida (`pendingBalance`/`paymentState`), que un sobrepago o una transferencia sin
// referencia NO cobran nada, ownership con Auth REAL (mismo criterio que approve.test.ts) y que
// sin puerto cableado se rompe fuerte en vez de "confirmar" en el aire.
import { describe, it, expect } from 'bun:test'
import { Auth, ConflictError, ValidationError } from 'arckode-framework'
import { markReservationPaid, type ManualPaymentInput, type ManualPaymentPort, type MarkPaidDeps } from '../usecases/mark-paid'
import type { AuditEntry } from '../../../shared/usecases/audit'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const fakeJwt = { sign: () => '', verify: () => ({}) } as any
// Auth REAL: si assertOwnership se rompe, este test falla.
const realAuth = new Auth(fakeJwt, 'test-secret', noopLogger)

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'
const user = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

const baseItem = {
  id: 'r1', hotelId: HOTEL, guestId: 'g1', status: 'pending', currency: 'USD',
  totalAmount: 354, otherCharges: 0, deposit: 0, pendingAmount: 354,
}

const repoWith = (item: any | null, updated: any[] = []) => ({
  findById: async () => item,
  update: async (_id: string, patch: any) => {
    const merged = { ...item, ...patch }
    updated.push(merged)
    return merged
  },
}) as any

function makePort(calls: ManualPaymentInput[]): ManualPaymentPort {
  return {
    recordManualPayment: async (input) => {
      calls.push(input)
      return { id: `pay-${calls.length}`, status: 'completed' }
    },
  }
}

interface Harness {
  deps: MarkPaidDeps
  portCalls: ManualPaymentInput[]
  audits: AuditEntry[]
  updated: any[]
  notified: any[]
}

function harness(item: any | null = baseItem, opts: { paid?: number; port?: ManualPaymentPort | undefined } = {}): Harness {
  const portCalls: ManualPaymentInput[] = []
  const audits: AuditEntry[] = []
  const updated: any[] = []
  const notified: any[] = []
  const deps: MarkPaidDeps = {
    repo: repoWith(item, updated),
    addonsOf: async () => [],
    paidOf: async () => opts.paid ?? 0,
    port: 'port' in opts ? opts.port : makePort(portCalls),
    auditPort: { record: async (e) => { audits.push(e) } },
    logger: noopLogger,
    notifyChanged: async (r) => { notified.push(r) },
  }
  return { deps, portCalls, audits, updated, notified }
}

describe('markReservationPaid — camino feliz', () => {
  it('$354 por transferencia sobre saldo $354 → paid + confirmed, payment asentado con createdBy del token, audit registrado', async () => {
    const h = harness()
    const result = await markReservationPaid(
      h.deps, 'r1', { method: 'transfer', amount: 354, reference: 'TRX-001', note: 'pagó por Banco' }, user, realAuth,
    )

    expect(result.paymentState).toBe('paid')
    expect(result.status).toBe('confirmed')
    expect(result.pendingAmount).toBe(0)
    expect(result.paidAmount).toBe(354)
    expect(result.paymentId).toBe('pay-1')

    // La plata: UNA fila por el puerto, con lo que `payments` necesita para conciliar y auditar.
    expect(h.portCalls).toHaveLength(1)
    const p = h.portCalls[0]
    expect(p.hotelId).toBe(HOTEL)
    expect(p.reservationId).toBe('r1')
    expect(p.guestId).toBe('g1')
    expect(p.amount).toBe(354)
    expect(p.currency).toBe('USD')
    expect(p.method).toBe('transfer')
    expect(p.reference).toBe('TRX-001')
    expect(p.createdBy).toBe(user.id)
    expect(p.description).toBe('Cobro manual · transfer · pagó por Banco')

    // La reserva: pendingAmount recalculado y transición pending → confirmed.
    expect(h.updated).toHaveLength(1)
    expect(h.updated[0].status).toBe('confirmed')
    expect(h.updated[0].pendingAmount).toBe(0)
    // Nunca se toca `deposit`: no es el libro del dinero.
    expect(h.updated[0].deposit).toBe(0)
    expect(h.notified).toHaveLength(1)

    expect(h.audits).toHaveLength(1)
    expect(h.audits[0].action).toBe('reservation.marked_paid')
    expect(h.audits[0].entityId).toBe('r1')
    expect(h.audits[0].userId).toBe(user.id)
    expect(h.audits[0].detail).toContain('pay-1')
  })

  it('cobro parcial deja paymentState partial y NO confirma de más que lo que la máquina de estados permite', async () => {
    const h = harness({ ...baseItem, status: 'checked_in' })
    const result = await markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 100 }, user, realAuth)
    expect(result.paymentState).toBe('partial')
    expect(result.pendingAmount).toBe(254)
    // checked_in no se mueve: sólo pending → confirmed.
    expect(result.status).toBe('checked_in')
    expect(h.updated[0].status).toBe('checked_in')
  })

  it('el saldo se mide contra lo YA cobrado (payments) + extras, no contra deposit', async () => {
    const h = harness(baseItem, { paid: 200 })
    h.deps.addonsOf = async () => [{ amount: 46, quantity: 1, kind: 'service' }]
    // total cobrable 400, pagado 200 → pendiente 200
    const result = await markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 200 }, user, realAuth)
    expect(result.paymentState).toBe('paid')
    expect(result.paidAmount).toBe(400)
    expect(result.pendingAmount).toBe(0)
  })

  it('cash sin referencia → OK', async () => {
    const h = harness()
    const result = await markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 354 }, user, realAuth)
    expect(result.paymentState).toBe('paid')
    expect(h.portCalls).toHaveLength(1)
    expect(h.portCalls[0].reference).toBeUndefined()
    expect(h.portCalls[0].description).toBe('Cobro manual · cash')
  })
})

describe('markReservationPaid — validaciones (nada se cobra)', () => {
  it('$400 sobre saldo $354 → ValidationError con el saldo en el mensaje, y el puerto NO fue llamado', async () => {
    const h = harness()
    const call = markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 400 }, user, realAuth)
    await expect(call).rejects.toThrow(ValidationError)
    await expect(call).rejects.toThrow(/354/)
    expect(h.portCalls).toHaveLength(0)
    expect(h.updated).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
  })

  it('transfer sin referencia → ValidationError y el puerto NO fue llamado', async () => {
    const h = harness()
    const call = markReservationPaid(h.deps, 'r1', { method: 'transfer', amount: 100 }, user, realAuth)
    await expect(call).rejects.toThrow(ValidationError)
    await expect(call).rejects.toThrow(/referencia/)
    expect(h.portCalls).toHaveLength(0)
  })

  it('card con referencia en blanco → ValidationError (los espacios no cuentan como referencia)', async () => {
    const h = harness()
    await expect(
      markReservationPaid(h.deps, 'r1', { method: 'card', amount: 100, reference: '   ' }, user, realAuth),
    ).rejects.toThrow(/referencia/)
    expect(h.portCalls).toHaveLength(0)
  })

  it('monto 0 o negativo → ValidationError sin leer la reserva', async () => {
    const h = harness()
    await expect(markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 0 }, user, realAuth)).rejects.toThrow(ValidationError)
    await expect(markReservationPaid(h.deps, 'r1', { method: 'cash', amount: -5 }, user, realAuth)).rejects.toThrow(ValidationError)
    expect(h.portCalls).toHaveLength(0)
  })

  it('reserva cancelada → ConflictError y no se cobra', async () => {
    const h = harness({ ...baseItem, status: 'cancelled' })
    await expect(markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 100 }, user, realAuth)).rejects.toThrow(ConflictError)
    expect(h.portCalls).toHaveLength(0)
  })

  it('reserva no_show → ConflictError y no se cobra', async () => {
    const h = harness({ ...baseItem, status: 'no_show' })
    await expect(markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 100 }, user, realAuth)).rejects.toThrow(ConflictError)
    expect(h.portCalls).toHaveLength(0)
  })

  it('reserva inexistente → NotFoundError', async () => {
    const h = harness(null)
    await expect(markReservationPaid(h.deps, 'nope', { method: 'cash', amount: 100 }, user, realAuth)).rejects.toThrow(/no encontrada/)
    expect(h.portCalls).toHaveLength(0)
  })
})

describe('markReservationPaid — ownership (con Auth real)', () => {
  it('usuario de otro hotel → rechaza y NO se cobra', async () => {
    const h = harness()
    const call = markReservationPaid(
      h.deps, 'r1', { method: 'cash', amount: 100 }, { id: 'u2', role: 'hotel_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    await expect(call).rejects.toThrow()
    expect(h.portCalls).toHaveLength(0)
    expect(h.updated).toHaveLength(0)
  })

  it('super_admin de otro hotel → pasa', async () => {
    const h = harness()
    const result = await markReservationPaid(
      h.deps, 'r1', { method: 'cash', amount: 354 }, { id: 'sa', role: 'super_admin', hotelId: OTRO_HOTEL }, realAuth,
    )
    expect(result.paymentState).toBe('paid')
    expect(h.portCalls[0].createdBy).toBe('sa')
  })
})

describe('markReservationPaid — fail-closed sin puerto', () => {
  it('sin connector reservas-payments cableado → throw que nombra al connector, y la reserva queda intacta', async () => {
    const h = harness(baseItem, { port: undefined })
    await expect(markReservationPaid(h.deps, 'r1', { method: 'cash', amount: 100 }, user, realAuth)).rejects.toThrow(/reservas-payments/)
    expect(h.updated).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
  })
})
