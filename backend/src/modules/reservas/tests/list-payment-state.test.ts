// reservas/tests/list-payment-state.test.ts — REQ-RWP-04 (#247): estado de pago por fila en el
// listado de reservas.
//
// `GET /api/reservas` devuelve `paymentState` ('pending' | 'partial' | 'paid') y `paidAmount` por
// fila. Lo pagado sale de `paidOf` (= `paidSource()` del módulo: `payments` completed + anticipo,
// ver shared/usecases/reservation-paid.ts) y NO de `reservation.deposit`; el total cobrable incluye
// los extras (`addonsOf`). Se calcula SOLO para las filas de la página, una llamada por fila —
// nunca `payments` del hotel entero. Dobles: mismo patrón que list-group-composition.test.ts.

import { describe, it, expect } from 'bun:test'
import { listReservations, type ListMoneyDeps } from '../usecases/crud'

const HOTEL = 'hotel-a'
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any
const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any

function makeRepo(rows: any[]) {
  return {
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    // Doble mínimo de `paginate`: aplica el WHERE real y el offset/limit (la página, no la tabla).
    paginate: async (filters: Record<string, unknown>, opts: { offset: number; limit: number }) => {
      const data = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
      return { data: data.slice(opts.offset, opts.offset + opts.limit), total: data.length }
    },
  }
}

function reservation(over: Record<string, any>) {
  return { id: 'x', hotelId: HOTEL, roomId: 'x', checkIn: '2030-01-10', checkOut: '2030-01-12', totalAmount: 300, deposit: 0, status: 'confirmed', ...over }
}

const hotelAdmin = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }
const twoRows = () => [reservation({ id: 'r1' }), reservation({ id: 'r2' })]

/** `paidOf` doble: lo que `payments` (completed) tendría por reserva. Simula la fuente real, no `deposit`. */
function moneyOf(paidById: Record<string, number>, addons: ListMoneyDeps['addonsOf'] = async () => []): ListMoneyDeps {
  return { addonsOf: addons, paidOf: async (id) => paidById[id] ?? 0 }
}

describe('listReservations — paymentState/paidAmount por fila (REQ-RWP-04)', () => {
  it('paid cuando payments cubre el total; pending cuando no hay nada cobrado (deposit 0 en ambas)', async () => {
    const result = await listReservations(makeRepo(twoRows()), {} as any, noopCache, noopLogger, {} as any, hotelAdmin, moneyOf({ r1: 300 }))
    const byId = Object.fromEntries(result.data.map((r: any) => [r.id, r]))
    expect(byId['r1'].paymentState).toBe('paid')
    expect(byId['r1'].paidAmount).toBe(300)
    expect(byId['r2'].paymentState).toBe('pending')
    expect(byId['r2'].paidAmount).toBe(0)
  })

  it('partial cuando lo cobrado no cubre el total', async () => {
    const result = await listReservations(makeRepo(twoRows()), {} as any, noopCache, noopLogger, {} as any, hotelAdmin, moneyOf({ r1: 100 }))
    const r1 = result.data.find((r: any) => r.id === 'r1') as any
    expect(r1.paymentState).toBe('partial')
    expect(r1.paidAmount).toBe(100)
  })

  it('paidOf/addonsOf se llaman exactamente UNA vez por fila de la página, no por reserva del hotel', async () => {
    const paidCalls: string[] = []
    const addonCalls: string[] = []
    const money: ListMoneyDeps = {
      addonsOf: async (id) => { addonCalls.push(id); return [] },
      paidOf: async (id, row) => { paidCalls.push(id); expect(row?.hotelId).toBe(HOTEL); return 0 },
    }
    const result = await listReservations(makeRepo(twoRows()), {} as any, noopCache, noopLogger, { limit: 1 } as any, hotelAdmin, money)
    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(2)
    expect(paidCalls).toEqual([result.data[0].id])
    expect(addonCalls).toEqual([result.data[0].id])
  })

  it('el total cobrable incluye los extras: pagado 300 sobre 300 + addon 50 → partial', async () => {
    const money = moneyOf({ r1: 300 }, async (id) => (id === 'r1' ? [{ amount: 50, quantity: 1 }] : []))
    const result = await listReservations(makeRepo([reservation({ id: 'r1' })]), {} as any, noopCache, noopLogger, {} as any, hotelAdmin, money)
    expect(result.data[0].paymentState).toBe('partial')
    expect(result.data[0].paidAmount).toBe(300)
  })
})
