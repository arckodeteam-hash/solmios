// connectors/tests/bookingengine-refunds.test.ts — Wiring del reembolso web (#272).
//
// El connector arma los puertos de `shared/usecases/web-booking-refund` con MÓDULOS (payments,
// reservas, notificaciones/usuarios/roles) y cuelga el handler de `onBookingCancelled`. Acá se
// verifica el cableado de punta a punta con dobles en memoria: que la plata sale por
// `payments.refundPayment` con el monto y la razón correctos, que el estado queda escrito en la
// reserva por `reservas.setRefundState`, que un fallo de la pasarela deja `failed` + campanita
// `system`, que sin plata no se toca la pasarela, y que NADA de esto tumba la cancelación.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { bookingengineRefundsConnector } from '../bookingengine-refunds'

const USERS = [
  { id: 'u-admin', hotelId: 'h1', name: 'Admin', email: 'admin@palma.com', role: 'hotel_admin', active: 1 },
  { id: 'u-recep', hotelId: 'h1', name: 'Recepción', email: 'recep@palma.com', role: 'receptionist', active: 1 },
  { id: 'u-cama', hotelId: 'h1', name: 'Camarera', email: 'cama@palma.com', role: 'housekeeper', active: 1 },
]
const ROLES = [
  { id: 'ro1', hotelId: 'h1', name: 'hotel_admin', permissions: ['reservations:view', 'reservations:create'] },
  { id: 'ro2', hotelId: 'h1', name: 'receptionist', permissions: ['reservations:view'] },
  { id: 'ro3', hotelId: 'h1', name: 'housekeeper', permissions: ['housekeeping:view'] },
]

const RESERVA = {
  id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room1', status: 'cancelled', currency: 'USD',
  totalAmount: 200, refundAmount: 100, priceBreakdown: { nights: 2 },
}

const EVENT = {
  reservationId: 'r1', hotelId: 'h1', refundAmount: 100, cancellationFee: 100, policyApplied: {},
  reservationIds: ['r1'], roomIds: ['room1'], groupId: null,
}

interface Over {
  refundThrows?: boolean
  withPayments?: boolean
  reservas?: any[]
}

function harness(over: Over = {}) {
  const rows: any[] = (over.reservas ?? [RESERVA]).map((r) => ({ ...r }))
  const refunds: any[] = []
  const created: any[] = []
  const sockets: Record<string, any> = {}
  /** Orden de llamadas cross-módulo: el claim tiene que ir ANTES del refund en Stripe. */
  const calls: string[] = []
  let retryPort: any = null

  const modules: Record<string, any> = {
    bookingengine: { setSockets: (s: any) => Object.assign(sockets, s) },
    reservas: {
      getById: async (id: string, user: any) => {
        const row = rows.find((r) => r.id === id && r.hotelId === user.hotelId)
        if (!row) throw new Error('Reserva no encontrada')
        return { ...row }
      },
      list: async (q: Record<string, unknown>, user: any) => ({
        data: rows.filter((r) => r.hotelId === user.hotelId && (!q.groupId || r.groupId === q.groupId)).map((r) => ({ ...r })),
      }),
      setRefundState: async (id: string, patch: Record<string, unknown>) => {
        calls.push(`setRefundState:${patch.refundStatus}`)
        const row = rows.find((r) => r.id === id)
        if (!row) return null
        Object.assign(row, patch)
        return { ...row }
      },
      // #272 (revisor): el CAS real vive en reservas-queries (claim-refund.e2e.test.ts); acá sólo el cableado.
      claimRefund: async (id: string) => { calls.push(`claimRefund:${id}`); return true },
      setOrchestrationDeps: (d: any) => { retryPort = d.retryWebRefund },
    },
    notificaciones: { create: async (dto: any) => { created.push(dto); return { id: `n-${created.length}`, ...dto } } },
    usuarios: { list: async (hotelId?: string) => USERS.filter((u) => u.hotelId === hotelId) },
    roles: { list: async () => ({ data: ROLES }) },
  }
  if (over.withPayments !== false) {
    modules.payments = {
      paymentsLinkedTo: async () => [{ id: 'p1', type: 'charge', status: 'completed', amount: 200, stripeSessionId: 'cs_x' }],
      refundPayment: async (id: string, amount: number, user: any, reason: string) => {
        calls.push('refundPayment')
        if (over.refundThrows) throw new Error('stripe caído')
        refunds.push({ id, amount, user, reason })
        return { id: 're-1' }
      },
    }
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name in modules) return modules[name]
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext

  bookingengineRefundsConnector(silentLogger())(ctx)
  return { rows, refunds, created, sockets, calls, retryPort: () => retryPort }
}

describe('bookingengineRefundsConnector — onBookingCancelled (#272)', () => {
  it('refundAmount 100 y cobro completed → payments.refundPayment(p1, 100, sistema, guest_cancellation) y la reserva queda done + re-1', async () => {
    const h = harness()
    expect(typeof h.sockets.onBookingCancelled).toBe('function')

    await h.sockets.onBookingCancelled(EVENT)

    expect(h.refunds).toHaveLength(1)
    expect(h.refunds[0]).toMatchObject({ id: 'p1', amount: 100, reason: 'guest_cancellation' })
    expect(h.refunds[0].user).toMatchObject({ id: 'system', role: 'super_admin' })
    expect(h.rows[0].refundStatus).toBe('done')
    expect(h.rows[0].refundPaymentId).toBe('re-1')
    expect(typeof h.rows[0].refundedAt).toBe('string')
    // Sin fallo, no hay campanita de sistema.
    expect(h.created).toHaveLength(0)
    // El reclamo atómico (reservas.claimRefund) va ANTES de pending y de la pasarela.
    expect(h.calls.indexOf('claimRefund:r1')).toBeGreaterThanOrEqual(0)
    expect(h.calls.indexOf('claimRefund:r1')).toBeLessThan(h.calls.indexOf('setRefundState:pending'))
    expect(h.calls.indexOf('setRefundState:pending')).toBeLessThan(h.calls.indexOf('refundPayment'))
  })

  it('grupo: el estado se escribe en TODAS las filas del groupId', async () => {
    const h = harness({
      reservas: [
        { ...RESERVA, groupId: 'grp1' },
        { ...RESERVA, id: 'r2', roomId: 'room2', priceBreakdown: null, groupId: 'grp1' },
      ],
    })
    await h.sockets.onBookingCancelled({ ...EVENT, reservationIds: ['r1', 'r2'], roomIds: ['room1', 'room2'], groupId: 'grp1' })

    expect(h.refunds).toHaveLength(1)
    expect(h.rows.map((r) => r.refundStatus)).toEqual(['done', 'done'])
    expect(h.rows.map((r) => r.refundPaymentId)).toEqual(['re-1', 're-1'])
  })

  it('refundPayment lanza → refundStatus failed y campanita system "Reembolso de …" a quien ve reservas', async () => {
    const h = harness({ refundThrows: true })

    await h.sockets.onBookingCancelled(EVENT)

    expect(h.rows[0].refundStatus).toBe('failed')
    expect(h.rows[0].refundPaymentId).toBeUndefined()
    // admin + recepción ven reservas; la camarera no.
    expect(h.created).toHaveLength(2)
    expect(h.created.map((n) => n.userId).sort()).toEqual(['u-admin', 'u-recep'])
    for (const n of h.created) {
      expect(n.type).toBe('system')
      expect(n.hotelId).toBe('h1')
      expect(n.title).toContain('Reembolso de')
      expect(n.metadata.reservationId).toBe('r1')
    }
  })

  it('refundAmount 0 → no toca la pasarela y deja refundStatus none', async () => {
    const h = harness()

    await h.sockets.onBookingCancelled({ ...EVENT, refundAmount: 0, cancellationFee: 200 })

    expect(h.refunds).toHaveLength(0)
    expect(h.rows[0].refundStatus).toBe('none')
    expect(h.created).toHaveLength(0)
  })

  it('payments no registrado → el handler NO tira (la cancelación ya está guardada)', async () => {
    const h = harness({ withPayments: false })

    await expect(h.sockets.onBookingCancelled(EVENT)).resolves.toBeUndefined()

    expect(h.refunds).toHaveLength(0)
    expect(h.rows[0].refundStatus).toBeUndefined()
  })

  it('evento sin reserva conocida → no tira ni escribe nada', async () => {
    const h = harness()
    await expect(h.sockets.onBookingCancelled({ ...EVENT, reservationId: 'nope', reservationIds: ['nope'] })).resolves.toBeUndefined()
    expect(h.refunds).toHaveLength(0)
  })
})

describe('bookingengineRefundsConnector — puerto retryWebRefund para reservas (#272)', () => {
  it('inyecta el puerto y reintentar sobre una failed la deja done', async () => {
    const h = harness({ reservas: [{ ...RESERVA, refundStatus: 'failed' }] })
    const port = h.retryPort()
    expect(typeof port).toBe('function')

    const out = await port({ reservationId: 'r1', hotelId: 'h1', refundAmount: 100 })

    expect(out).toMatchObject({ status: 'done', refundPaymentId: 're-1' })
    expect(h.refunds).toHaveLength(1)
    expect(h.rows[0].refundStatus).toBe('done')
  })

  it('ya done → skipped, sin segundo refund', async () => {
    const h = harness({ reservas: [{ ...RESERVA, refundStatus: 'done', refundPaymentId: 're-0' }] })
    const out = await h.retryPort()({ reservationId: 'r1', hotelId: 'h1', refundAmount: 100 })
    expect(out.status).toBe('skipped')
    expect(h.refunds).toHaveLength(0)
    expect(h.rows[0].refundPaymentId).toBe('re-0')
  })

  it('pasarela caída → failed con error', async () => {
    const h = harness({ refundThrows: true, reservas: [{ ...RESERVA, refundStatus: 'failed' }] })
    const out = await h.retryPort()({ reservationId: 'r1', hotelId: 'h1', refundAmount: 100 })
    expect(out.status).toBe('failed')
    expect(out.error).toContain('stripe caído')
    expect(h.rows[0].refundStatus).toBe('failed')
  })
})
