// restaurant/tests/open-part-guard.test.ts — #214: el guard `hasOpenPart` SOLO.
//
// `amountReserved > 0` en la fila de la comanda = "hay una parte en curso" (Checkout de tarjeta abierto por
// UNA parte, una parte que quedó a medias, o el cobro entero reservando) sin tener que leer
// `restaurant_order_payments`. Acá se prueba el predicado y cada consumidor con una fila que SOLO tiene
// eso (sin partes, sin sesión de Stripe): si alguien relaja el predicado o lo quita de un guard, esto
// falla sin necesidad de armar la carrera completa (split-payments.test.ts INT-1 la cubre por el flujo real).
import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
import type { Auth, RepositoryAdapter } from 'arckode-framework'
import { hasOpenPart, hasPaidParts, hasPartialPayments } from '../usecases/order-totals'
import { assertSettleable, payOrder, chargeToRoom, billOrder, type SettlementDeps } from '../usecases/settlement'
import { cancelOrder, type OrdersDeps } from '../usecases/orders'
import { addLine, voidLine, type OrderLinesDeps } from '../usecases/order-lines'
import { applyOrderDiscount, type DiscountsDeps } from '../usecases/discounts'
import type { OrderDTO, CurrentUser } from '../types'

const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin', permissions: ['restaurant:delete', 'restaurant:discount'] } as CurrentUser
const auth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth
const userRepo = { findById: async () => ({ id: 'u1', hotelId: 'h1' }) } as unknown as RepositoryAdapter<any>

/** Repo en memoria de UNA comanda; registra cada update (ninguno debe llegar cuando el guard rebota). */
function orderRepo(row: Partial<OrderDTO>) {
  const order: any = { id: 'o1', hotelId: 'h1', number: 'CMD-1', status: 'sent', tableId: 't1', tip: 0, subtotal: 100, tax: 0, total: 100, amountPaid: 0, amountReserved: 0, linesLockedUntil: '', reservationId: 'r1', ...row }
  const updates: any[] = []
  const repo = {
    findById: async (id: string) => (id === order.id ? { ...order } : null),
    findOne: async () => ({ ...order }),
    findMany: async () => [{ ...order }],
    update: async (_id: string, d: any) => { updates.push(d); Object.assign(order, d); return { ...order } },
  } as unknown as RepositoryAdapter<OrderDTO>
  return { repo, updates, order }
}
const lines = { findMany: async () => [{ id: 'l1', hotelId: 'h1', orderId: 'o1', name: 'X', unitPrice: 100, quantity: 1, lineTotal: 100, taxRate: 0, status: 'sent', kind: 'item' }], findOne: async () => ({ id: 'l1', hotelId: 'h1', orderId: 'o1', name: 'X', unitPrice: 100, quantity: 1, lineTotal: 100, taxRate: 0, status: 'sent', kind: 'item' }), update: async () => ({}), create: async () => ({}) } as unknown as RepositoryAdapter<any>
const tables = { findById: async () => ({ id: 't1', name: '3' }), update: async () => null } as unknown as RepositoryAdapter<any>
const hotels = { findOne: async () => ({ id: 'h1', currency: 'DOP' }), findById: async () => ({ id: 'h1', currency: 'DOP' }) } as unknown as RepositoryAdapter<any>
const noConfig = { findOne: async () => null } as unknown as RepositoryAdapter<any>

/** Fila con SOLO `amountReserved > 0`: nada cobrado, ninguna parte, ninguna sesión de Stripe, sin lock de líneas. */
const onlyReserved = { amountReserved: 40, amountPaid: 0 }

describe('#214 — hasOpenPart: el predicado', () => {
  it('> 0 = hay una parte en curso; 0, null, undefined o ausente = no', () => {
    expect(hasOpenPart({ amountReserved: 40 })).toBe(true)
    expect(hasOpenPart({ amountReserved: 0.01 })).toBe(true)
    expect(hasOpenPart({ amountReserved: 0 })).toBe(false)
    expect(hasOpenPart({ amountReserved: undefined })).toBe(false)
    expect(hasOpenPart({ amountReserved: null as unknown as number })).toBe(false)
    expect(hasOpenPart({})).toBe(false)
    // La fila puede venir como texto (driver): se lee como número.
    expect(hasOpenPart({ amountReserved: '25' as unknown as number })).toBe(true)
    expect(hasOpenPart({ amountReserved: '0' as unknown as number })).toBe(false)
  })
  it('es independiente de hasPaidParts, y hasPartialPayments es la unión', () => {
    expect(hasPaidParts(onlyReserved)).toBe(false)
    expect(hasPartialPayments(onlyReserved)).toBe(true)
    expect(hasPartialPayments({ amountReserved: 0, amountPaid: 0 })).toBe(false)
  })
})

describe('#214 — hasOpenPart en cada guard, con una fila que SOLO tiene amountReserved > 0', () => {
  it('assertSettleable rebota con el mensaje de "parte esperando a Stripe" (no el de pagos parciales)', () => {
    const order = { ...orderRepo(onlyReserved).order } as OrderDTO
    expect(() => assertSettleable(order)).toThrow(ConflictError)
    expect(() => assertSettleable(order)).toThrow(/esperando la confirmación de Stripe/)
    expect(() => assertSettleable({ ...order, amountReserved: 0 } as OrderDTO)).not.toThrow()
  })

  it('payOrder / chargeToRoom / billOrder: 409 y ningún puerto ni update', async () => {
    const { repo, updates } = orderRepo(onlyReserved)
    const ports = { recordPayment: async () => { throw new Error('no debe llegar') }, chargeToFolio: async () => { throw new Error('no debe llegar') } }
    const deps: SettlementDeps = { orders: repo, lines, tables, hotels, userRepo, auth, sockets: {}, ports, reservations: { findById: async () => ({ id: 'r1', hotelId: 'h1', status: 'checked_in' }) } }
    await expect(payOrder(deps, 'o1', { method: 'cash' }, user)).rejects.toThrow(/esperando la confirmación de Stripe/)
    await expect(chargeToRoom(deps, 'o1', {}, user)).rejects.toThrow(/esperando la confirmación de Stripe/)
    await expect(billOrder(deps, 'o1', { tip: 5 }, user)).rejects.toThrow(/esperando la confirmación de Stripe/)
    expect(updates).toEqual([])
  })

  it('cancelOrder: 409 "cobro en curso", la comanda sigue viva y sin update', async () => {
    const { repo, updates } = orderRepo(onlyReserved)
    const deps = { orders: repo, lines, tables, config: noConfig, userRepo, auth, sockets: {} } as unknown as OrdersDeps
    await expect(cancelOrder(deps, 'o1', 'se fue', user)).rejects.toThrow(/cobro en curso/)
    expect(updates).toEqual([])
  })

  it('líneas (addLine / voidLine) y descuentos: 409 "pagos parciales", sin update', async () => {
    const { repo, updates } = orderRepo(onlyReserved)
    const linesDeps = { orders: repo, lines, items: { findById: async () => ({ id: 'i1', hotelId: 'h1', name: 'X', price: 1 }), findOne: async () => ({ id: 'i1', hotelId: 'h1', name: 'X', price: 1 }) } as any, categories: noConfig, stations: { findMany: async () => [] } as any, config: noConfig, hotels, userRepo, auth, sockets: {} } as unknown as OrderLinesDeps
    await expect(addLine(linesDeps, 'o1', { menuItemId: 'i1', quantity: 1 }, user)).rejects.toThrow(/pagos parciales/)
    await expect(voidLine(linesDeps, 'o1', 'l1', 'motivo', user)).rejects.toThrow(/pagos parciales/)
    const discountsDeps = { orders: repo, lines, config: noConfig, userRepo, auth } as unknown as DiscountsDeps
    await expect(applyOrderDiscount(discountsDeps, 'o1', { type: 'percent', value: 10, reason: 'x' }, user)).rejects.toThrow(/pagos parciales/)
    expect(updates).toEqual([])
  })
})
