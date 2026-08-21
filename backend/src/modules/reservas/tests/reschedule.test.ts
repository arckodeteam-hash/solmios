// reservas/tests/reschedule.test.ts — IDOR #668 en el flujo de reagendado (planning).
//
// buildQuote() (usado por quoteReschedule y commitReschedule) lee `input.roomId` directo del
// body sin validar hotel — mismo patrón de IDOR que ya se había fixeado en `create` (crud.ts)
// pero que faltaba acá y en `validate-update.ts`. Sin el guard, un hotel_admin podía:
//   1) via quoteReschedule (GET dry-run): ver basePrice/disponibilidad de una room de OTRO hotel.
//   2) via commitReschedule: mover su reserva a esa room ajena (además de la fuga de datos).
// Regresión: cualquier refactor de buildQuote que borre el check de `room.hotelId !== existing.hotelId`
// reintroduce el IDOR en silencio.

import { describe, it, expect } from 'bun:test'
import { quoteReschedule, commitReschedule, type RescheduleDeps } from '../usecases/reschedule'
import { paidSourceFrom } from '../../../shared/usecases/reservation-paid'

// Lo cobrado real (GH-0.2). Repos vacíos ⇒ la implementación REAL cae al `deposit` de la reserva,
// que es lo que estos tests modelan (sin folio ni factura de por medio).
const noMoneyRows = { findMany: async () => [] as any[] }
const paidOf = paidSourceFrom({ folioRepo: noMoneyRows, invoiceRepo: noMoneyRows, paymentRepo: noMoneyRows })

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const silentCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any

const HOTEL = 'hotel-a'
const OTRO_HOTEL = 'hotel-b'

const hotelAdmin = { id: 'u1', role: 'hotel_admin', hotelId: HOTEL }

function makeReservation(over: Record<string, any> = {}) {
  return {
    id: 'r1', hotelId: HOTEL, roomId: 'room-1', checkIn: '2030-01-10', checkOut: '2030-01-12',
    totalAmount: 200, currency: 'USD', status: 'confirmed', ...over,
  }
}

function makeRepo(reserva: any, overrides: Record<string, any> = {}) {
  return {
    findById: async () => reserva,
    findMany: async () => [],
    update: async (id: string, data: any) => ({ ...reserva, ...data, id }),
    ...overrides,
  }
}

// buildQuote() (reschedule.ts) lee por findById; assertUpdateValidations (validate-update.ts,
// vía commitReschedule → updateReservation) lee la MISMA room por findOne({id}) — igual que
// createReservation. El mock necesita ambos métodos.
function makeRoomRepo(rooms: Record<string, any>) {
  return {
    findById: async (id: string) => rooms[id] ?? null,
    findOne: async (query: { id: string }) => rooms[query.id] ?? null,
  }
}

function makeDeps(reserva: any, rooms: Record<string, any>, repoOverrides: Record<string, any> = {}): RescheduleDeps {
  return {
    repo: makeRepo(reserva, repoOverrides),
    roomRepo: makeRoomRepo(rooms),
    logger: noopLogger,
    cache: silentCache,
    paidOf,
    sockets: {},
    // STR-2: el commit reprecia y el saldo persistido tiene que moverse con el total nuevo.
    addonsOf: async () => [],
  }
}

describe('quoteReschedule — IDOR #668 (dry-run, no debe escribir ni filtrar la room ajena)', () => {
  it('rechaza cotizar el cambio a una habitación de otro hotel', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: OTRO_HOTEL, basePrice: 999 } })
    const call = quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    await expect(call).rejects.toThrow('La habitación no pertenece a este hotel')
  })

  it('el error de la room ajena no filtra su basePrice ni sus datos', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: OTRO_HOTEL, basePrice: 999 } })
    try {
      await quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
      throw new Error('no debería llegar acá — se esperaba ConflictError')
    } catch (e: any) {
      expect(e.message).not.toContain('999')
      expect(JSON.stringify(e)).not.toContain('999')
    }
  })

  it('acepta cotizar el cambio a otra habitación del MISMO hotel (control)', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } })
    const quote = await quoteReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(quote.roomId).toBe('room-2')
    expect(quote.basePrice).toBe(120)
    expect(quote.available).toBe(true)
  })
})

describe('commitReschedule — IDOR #668 (aplica el cambio real)', () => {
  it('rechaza mover la reserva a una habitación de otro hotel, sin mutar la reserva', async () => {
    const reserva = makeReservation()
    let updateCalled = false
    const deps = makeDeps(
      reserva,
      { 'room-2': { id: 'room-2', hotelId: OTRO_HOTEL, basePrice: 999 } },
      { update: async (id: string, data: any) => { updateCalled = true; return { ...reserva, ...data, id } } },
    )
    const call = commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    await expect(call).rejects.toThrow('La habitación no pertenece a este hotel')
    expect(updateCalled).toBe(false)
  })

  it('acepta reagendar (commit) a otra habitación del MISMO hotel (control)', async () => {
    const reserva = makeReservation()
    const deps = makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } })
    const result = await commitReschedule(deps, 'r1', { roomId: 'room-2' }, hotelAdmin)
    expect(result.reservation.roomId).toBe('room-2')
    expect(result.quote.roomId).toBe('room-2')
  })

  it('SEC3-2: el commit dispara ceilingGuard al escribir totalAmount (un reprice que BAJA deja links vivos si no)', async () => {
    // El commit escribe `totalAmount:newTotal` vía updateReservation → crud dispara `afterCeilingDrop`
    // (crud.ts:286). Si el hook no se cablea, el callback es undefined y una reprogramación que
    // abarata deja Checkout Sessions abiertas por el saldo VIEJO.
    const reserva = makeReservation()
    const clamped: Array<{ hotelId: string; reservationId: string }> = []
    const deps: RescheduleDeps = {
      ...makeDeps(reserva, { 'room-2': { id: 'room-2', hotelId: HOTEL, basePrice: 120 } }),
      ceilingGuard: async (hotelId, reservationId) => { clamped.push({ hotelId, reservationId }) },
    }
    // reprice a una room más barata y menos noches: baja el total → creditAmount > 0.
    await commitReschedule(deps, 'r1', { roomId: 'room-2', checkIn: '2030-01-10', checkOut: '2030-01-11', pricingMode: 'reprice' }, hotelAdmin)
    expect(clamped).toEqual([{ hotelId: HOTEL, reservationId: 'r1' }])
  })
})
