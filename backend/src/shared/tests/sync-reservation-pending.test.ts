// shared/tests/sync-reservation-pending.test.ts — La columna persistida `reservations.pendingAmount`
// tiene que decir lo MISMO que el detalle.
//
// Hallazgo ARCH-6/ARCH-7 (2026-08-19): `getExtendedDetail` empezó a calcular el pendiente con la
// fórmula única (extras + otros cobros), pero la columna persistida —la que lee el listado y el
// planning— seguía con el valor viejo. Mismo nombre de campo, dos números según el endpoint.
//
// Hallazgo MED-1/MED-2 (2ª vuelta): `paidOf` era opcional y las llamadas de este archivo lo omitían,
// así que la suite sólo ejercitaba el fallback a `reservations.deposit` — que ES el bug de GH-0.2.
// Ahora `paidOf` es obligatorio (no compila sin él) y los casos de abajo mueven plata que existe
// SÓLO en `payments`: si alguien vuelve a medir contra `deposit`, estos tests mueren.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { syncReservationPending } from '../usecases/sync-reservation-pending'
import { paidSourceFrom, type PaidSource } from '../usecases/reservation-paid'

function repoWith(reservation: any | null) {
  const updates: any[] = []
  const repo = {
    findById: async () => reservation,
    update: async (id: string, patch: any) => { updates.push({ id, ...patch }); return { ...reservation, ...patch } },
  } as unknown as RepositoryAdapter<any>
  return { repo, updates }
}

/** Reserva sin un peso cobrado en `payments`: el saldo queda a merced de `deposit`. */
const noMoney: PaidSource = paidSourceFrom({
  folioRepo: { findMany: async () => [] } as any,
  invoiceRepo: { findMany: async () => [] } as any,
  paymentRepo: { findMany: async () => [] } as any,
})

/**
 * `paidOf` real sobre plata cobrada POR FOLIO: no toca `reservations.deposit` (folios.applyPayment
 * no lo escribe — ver `shared/usecases/reservation-paid`). Es el escenario exacto de GH-0.2.
 */
function paidByFolio(amount: number, hotelId = 'h1'): PaidSource {
  return paidSourceFrom({
    folioRepo: { findMany: async (w: any) => (w?.hotelId === hotelId ? [{ id: 'f1', hotelId, reservationId: w.reservationId }] : []) } as any,
    invoiceRepo: { findMany: async () => [] } as any,
    paymentRepo: {
      findMany: async (w: any) => (w?.folioId === 'f1' && w?.hotelId === hotelId
        ? [{ id: 'p1', type: 'charge', status: 'completed', amount }] : []),
    } as any,
  })
}

describe('syncReservationPending', () => {
  it('persiste el pendiente con extras y otros cobros', async () => {
    const { repo, updates } = repoWith({ id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 40, deposit: 100, pendingAmount: 400 })
    const pending = await syncReservationPending(repo, async () => [{ amount: 30, quantity: 2, kind: 'service' }], 'r1', noMoney)
    // 500 + 40 + 60 − 100 = 500
    expect(pending).toBe(500)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 500 }])
  })

  it('no escribe si el valor no cambió', async () => {
    const { repo, updates } = repoWith({ id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 100, pendingAmount: 400 })
    expect(await syncReservationPending(repo, async () => [], 'r1', noMoney)).toBe(400)
    expect(updates).toHaveLength(0)
  })

  it('nunca persiste un pendiente negativo', async () => {
    const { repo, updates } = repoWith({ id: 'r1', hotelId: 'h1', totalAmount: 100, deposit: 500, pendingAmount: 100 })
    expect(await syncReservationPending(repo, async () => [], 'r1', noMoney)).toBe(0)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 0 }])
  })

  it('reserva inexistente → 0 y sin escrituras', async () => {
    const { repo, updates } = repoWith(null)
    expect(await syncReservationPending(repo, async () => [], 'fantasma', noMoney)).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('acepta la reserva ya cargada y no vuelve a leerla', async () => {
    let reads = 0
    const updates: any[] = []
    const repo = {
      findById: async () => { reads++; return null },
      update: async (id: string, patch: any) => { updates.push({ id, ...patch }); return patch },
    } as unknown as RepositoryAdapter<any>
    await syncReservationPending(repo, async () => [], 'r1', noMoney, { id: 'r1', hotelId: 'h1', totalAmount: 200, deposit: 0, pendingAmount: 0 })
    expect(reads).toBe(0)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 200 }])
  })

  // ── GH-0.2 / MED-1: la columna mide contra `payments`, no contra `deposit` ────────────────────
  it('descuenta lo cobrado POR FOLIO, que nunca toca `deposit`', async () => {
    // Reserva de 500, `deposit` = 0 (nadie lo movió), $300 cobrados en efectivo contra el folio.
    // Con `paidOf` la columna guarda 200. Sin él —el bug— guardaría 500 y el listado mostraría el
    // saldo completo de una reserva mayormente pagada.
    const { repo, updates } = repoWith({ id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 0, pendingAmount: 500 })
    const pending = await syncReservationPending(repo, async () => [], 'r1', paidByFolio(300))
    expect(pending).toBe(200)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 200 }])
  })

  it('el pago por folio que cancela el total deja la columna en 0', async () => {
    const { repo, updates } = repoWith({ id: 'r1', hotelId: 'h1', totalAmount: 500, otherCharges: 0, deposit: 0, pendingAmount: 500 })
    expect(await syncReservationPending(repo, async () => [], 'r1', paidByFolio(500))).toBe(0)
    expect(updates).toEqual([{ id: 'r1', pendingAmount: 0 }])
  })
})
