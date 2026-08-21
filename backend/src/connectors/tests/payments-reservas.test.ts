// connectors/tests/payments-reservas.test.ts — COR-1: un movimiento de dinero resincroniza
// `reservations.pendingAmount`.
//
// Antes de este connector NINGÚN camino de pago llamaba a `syncReservationPending`:
// `folios.applyPayment`, `facturas.pay` y el settlement del checkout escribían en `payments` y la
// columna que sirve `GET /api/reservas` quedaba con el saldo viejo, mientras `/detail` recalculaba.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext, RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { paymentsReservasConnector } from '../payments-reservas'
import { syncPendingAfterPayment } from '../../modules/reservas/usecases/sync-pending-after-payment'
import { paidSourceFrom } from '../../shared/usecases/reservation-paid'

function makeCtx(reservas: any) {
  const sockets: any = {}
  const paymentsStub = { setSockets: (s: any) => Object.assign(sockets, s) }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'payments') return paymentsStub
      if (name === 'reservas') return reservas
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, sockets }
}

describe('paymentsReservasConnector (COR-1)', () => {
  it('un pago nuevo llega a reservas con hotelId + folioId/invoiceId', async () => {
    const seen: any[] = []
    const { ctx, sockets } = makeCtx({ syncPendingAfterPayment: async (r: any) => { seen.push(r); return 0 } })
    paymentsReservasConnector(ctx)

    await sockets.onPaymentCreated({ id: 'p1', hotelId: 'h1', folioId: 'f1', invoiceId: null, amount: 300 })
    await sockets.onRefundProcessed({ id: 'p2', hotelId: 'h1', folioId: null, invoiceId: 'i1', amount: 300 })

    expect(seen).toEqual([
      { hotelId: 'h1', folioId: 'f1', invoiceId: null },
      { hotelId: 'h1', folioId: null, invoiceId: 'i1' },
    ])
  })

  it('un fallo de reservas NO tumba el cobro (la plata ya entró)', async () => {
    const { ctx, sockets } = makeCtx({ syncPendingAfterPayment: async () => { throw new Error('boom') } })
    paymentsReservasConnector(ctx)
    await sockets.onPaymentCreated({ id: 'p1', hotelId: 'h1', folioId: 'f1' })
  })
})

// ── El usecase que el connector dispara ────────────────────────────────────────────────────────

function makeDeps(reservation: any, opts: { payments?: any[]; folios?: any[]; invoices?: any[]; byReservation?: boolean } = {}) {
  const updates: any[] = []
  const notified: any[] = []
  const repo = {
    findById: async (id: string) => (reservation && reservation.id === id ? reservation : null),
    update: async (id: string, patch: any) => { updates.push({ id, ...patch }); return { ...reservation, ...patch } },
  } as unknown as RepositoryAdapter<any>
  const folios = opts.folios ?? []
  const invoices = opts.invoices ?? []
  const payments = opts.payments ?? []
  const deps = {
    repo,
    addonsOf: async () => [],
    paidOf: paidSourceFrom({
      folioRepo: { findMany: async (w: any) => folios.filter((f) => f.hotelId === w?.hotelId && f.reservationId === w?.reservationId) } as any,
      invoiceRepo: { findMany: async (w: any) => invoices.filter((i) => i.hotelId === w?.hotelId && i.reservationId === w?.reservationId) } as any,
      paymentRepo: {
        // Filtra por los TRES vínculos reales de `reservation-paid` (folio, factura, reservationId
        // directo): un WHERE que el doble no sabe responder devuelve vacío, no "todo el hotel".
        findMany: async (w: any) => payments.filter((p) => p.hotelId === w?.hotelId
          && (w?.folioId !== undefined ? p.folioId === w.folioId
            : w?.invoiceId !== undefined ? p.invoiceId === w.invoiceId
            : w?.reservationId !== undefined ? p.reservationId === w.reservationId
            : false)),
      } as any,
    }),
    reservationOf: async (hotelId: string, ref: any) => {
      // Mismo orden que `buildReservationMoneyPort`: el vínculo DIRECTO gana (COR-A).
      if (opts.byReservation && ref?.reservationId) return ref.reservationId
      const f = folios.find((x) => x.id === ref?.folioId && x.hotelId === hotelId)
      if (f) return f.reservationId
      const i = invoices.find((x) => x.id === ref?.invoiceId && x.hotelId === hotelId)
      return i ? i.reservationId : null
    },
    notifyChanged: async (r: any) => { notified.push(r) },
    logger: silentLogger(),
  }
  return { deps, updates, notified }
}

describe('syncPendingAfterPayment (COR-1)', () => {
  it('un cobro por FOLIO baja la columna persistida y avisa al listado', async () => {
    // Reserva de 500 con `deposit` = 0: `folios.applyPayment` no toca `deposit`, sólo `payments`.
    const { deps, updates, notified } = makeDeps(
      { id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 0, pendingAmount: 500 },
      {
        folios: [{ id: 'f1', hotelId: 'h1', reservationId: 'r1' }],
        payments: [{ id: 'p1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
      },
    )
    const pending = await syncPendingAfterPayment(deps as any, { hotelId: 'h1', folioId: 'f1' })
    expect(pending).toBe(200)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 200 }])
    expect(notified).toHaveLength(1)
    expect(notified[0]).toMatchObject({ id: 'r1', pendingAmount: 200 })
  })

  it('un cobro por FACTURA hace lo mismo (el otro vínculo con `payments`)', async () => {
    const { deps, updates } = makeDeps(
      { id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 0, pendingAmount: 500 },
      {
        invoices: [{ id: 'i1', hotelId: 'h1', reservationId: 'r1' }],
        payments: [{ id: 'p1', hotelId: 'h1', invoiceId: 'i1', type: 'charge', status: 'completed', amount: 500 }],
      },
    )
    expect(await syncPendingAfterPayment(deps as any, { hotelId: 'h1', invoiceId: 'i1' })).toBe(0)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 0 }])
  })

  it('un pago de otro hotel no toca la reserva (cross-tenant)', async () => {
    const { deps, updates, notified } = makeDeps(
      { id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 0, pendingAmount: 500 },
      { folios: [{ id: 'f1', hotelId: 'h1', reservationId: 'r1' }] },
    )
    expect(await syncPendingAfterPayment(deps as any, { hotelId: 'h2', folioId: 'f1' })).toBeNull()
    expect(updates).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })

  it('un pago sin folio ni factura (caja/restaurante) se ignora', async () => {
    const { deps, updates } = makeDeps({ id: 'r1', hotelId: 'h1', totalAmount: 500, deposit: 0, pendingAmount: 500 })
    expect(await syncPendingAfterPayment(deps as any, { hotelId: 'h1' })).toBeNull()
    expect(updates).toHaveLength(0)
  })

  it('si el saldo no cambió no escribe ni notifica', async () => {
    const { deps, updates, notified } = makeDeps(
      { id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 0, pendingAmount: 200 },
      {
        folios: [{ id: 'f1', hotelId: 'h1', reservationId: 'r1' }],
        payments: [{ id: 'p1', hotelId: 'h1', folioId: 'f1', type: 'charge', status: 'completed', amount: 300 }],
      },
    )
    expect(await syncPendingAfterPayment(deps as any, { hotelId: 'h1', folioId: 'f1' })).toBe(200)
    expect(updates).toHaveLength(0)
    expect(notified).toHaveLength(0)
  })

  // ── COR-A: el TERCER vínculo (reservationId directo) ─────────────────────────────────────
  it('COR-A: un cobro con SOLO reservationId (reprogramación en efectivo/tarjeta) también resincroniza', async () => {
    // Es el caso exacto del hallazgo: fila {hotelId, reservationId} → el guard viejo devolvía null
    // y CERO updates; `pendingAmount` quedaba inflado tras el cobro de la reprogramación.
    const { deps, updates, notified } = makeDeps(
      { id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 0, pendingAmount: 500 },
      { payments: [{ id: 'p1', hotelId: 'h1', reservationId: 'r1', type: 'charge', status: 'completed', amount: 200 }], byReservation: true },
    )
    const pending = await syncPendingAfterPayment(deps as any, { hotelId: 'h1', reservationId: 'r1' })
    expect(pending).toBe(300)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 300 }])
    expect(notified).toHaveLength(1)
  })
})
