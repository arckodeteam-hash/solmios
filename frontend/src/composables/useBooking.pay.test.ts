// useBooking.pay.test.ts — Revalidación completa antes de pagar (Tarea 15 / tasks.md 1.6).
//
// "Implementar revalidación completa (inventario, tarifa, cantidad, ocupación, extras,
// total) inmediatamente antes de habilitar el pago, bloqueando el cobro si algo cambió
// desde la búsqueda inicial. Acceptance: si la última unidad disponible se vende a otro
// huésped mientras el primero completa el flujo, el segundo NO puede pagar y ve un mensaje
// explicando qué cambió."
//
// El BACKEND ya revalida las 5 dimensiones al crear la reserva (no confía en nada que el
// cliente mandó):
//   - inventario/cantidad: lock + re-lectura DENTRO de la transacción, todo-o-nada
//     (`public-booking-race.test.ts`: "el comprador que chequeó primero pero insertó
//     último recibe 409" — la carrera exacta del acceptance).
//   - tarifa/total: se recalcula con `sumStayPrice` sobre `RoomRates`/`SeasonAssignments`
//     ACTUALES, nunca con el precio que el cliente mandó.
//   - ocupación/capacidad: filtro de capacidad al asignar la unidad física (Tarea 10,
//     ver `public-booking-room-resolution.test.ts` / `public-booking-group.test.ts`).
//   - extras/promo: `upsell inactivo/inexistente → se ignora`, `maxUses alcanzado →
//     max_uses_reached`, race condition de promo con optimistic lock
//     (`public-booking-promo-upsells.test.ts`).
//
// El GAP real (por qué este archivo existe) era la otra mitad del acceptance: "el segundo
// NO puede pagar y VE UN MENSAJE explicando qué cambió" es un comportamiento del FRONTEND
// (`useBooking.ts` `pay()`) que no tenía NINGÚN test — ni para el flujo de 1 habitación ni
// para el de grupo, y compartido por las 2 superficies (widget y landing, ambas llaman a
// `store.pay()`).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { useBookingStore } from './useBooking'
import { BookingService } from '@/services/Booking.service'
import { ApiError } from '@/services/http'
import type { PublicRatesResponse } from '@/types'

vi.mock('@/services/Booking.service', () => ({
  BookingService: {
    getRates: vi.fn(),
    getUpsells: vi.fn().mockResolvedValue([]),
    createBooking: vi.fn(),
    createBookingGroup: vi.fn(),
  },
}))

function localDate(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function ratesResponse(): PublicRatesResponse {
  return {
    roomTypes: [{
      id: 'double', name: 'double', fromPrice: 200, availableCount: 3, capacity: 2,
      surfaceArea: 20, taxBreakdown: [], photoUrl: null,
    }],
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 2,
    taxes: [],
    checkIn: localDate(1),
    checkOut: localDate(3),
    cancellationPolicy: null,
    cancellationSummary: null,
  } as unknown as PublicRatesResponse
}

/** Arma un store con carrito de 1 línea (endpoint de 1 habitación) y datos de huésped válidos
 *  — el mínimo para que `pay()` llegue hasta el POST en vez de cortar en las validaciones. */
function setupSingleRoom() {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = ratesResponse()
  store.checkIn = localDate(1)
  store.checkOut = localDate(3)
  store.cart = [{
    key: 'double|2', roomType: 'double', roomName: 'double', occupancy: 2, quantity: 1,
    unitPrice: 200, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null,
  }]
  store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
  return store
}

/** Igual, pero con 2 líneas (fuerza el endpoint de GRUPO). */
function setupGroup() {
  const store = useBookingStore()
  store.init('hotel-demo')
  store.ratesResponse = ratesResponse()
  store.checkIn = localDate(1)
  store.checkOut = localDate(3)
  store.cart = [
    { key: 'double|2', roomType: 'double', roomName: 'double', occupancy: 2, quantity: 1, unitPrice: 200, unitTaxBreakdown: [], maxAvailable: 3, photoUrl: null },
    { key: 'suite|2', roomType: 'suite', roomName: 'suite', occupancy: 2, quantity: 1, unitPrice: 300, unitTaxBreakdown: [], maxAvailable: 1, photoUrl: null },
  ]
  store.setGuest({ name: 'Ana Pérez', email: 'ana@example.com', phone: '8095550000' })
  return store
}

describe('useBooking — pay() ante un 409 de revalidación (Tarea 15 / tasks.md 1.6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('la última unidad se vendió mientras completaba el flujo → NO paga, ve el motivo exacto del backend', async () => {
    const store = setupSingleRoom()
    vi.mocked(BookingService.createBooking).mockRejectedValue(
      new ApiError(409, '"double" ya no está disponible para esas fechas'),
    )

    await store.pay()

    // El mensaje es el que el backend mandó — no uno genérico que esconda QUÉ cambió.
    expect(store.error).toBe('"double" ya no está disponible para esas fechas')
    expect(store.status).toBe('failed')
    // No se creó ninguna reserva del lado del cliente ni se redirigió a Stripe.
    expect(store.reservation).toBeNull()
    // El botón de pagar vuelve a estar disponible — no queda trabado en "Procesando…".
    expect(store.isSubmitting).toBe(false)
  })

  it('mismo caso para una reserva de GRUPO (2+ habitaciones) — el mensaje también informa el máximo real', async () => {
    const store = setupGroup()
    vi.mocked(BookingService.createBookingGroup).mockRejectedValue(
      new ApiError(409, 'Solo hay 0 habitación(es) de "suite" disponibles para esas fechas (pediste 1)'),
    )

    await store.pay()

    expect(store.error).toContain('Solo hay 0 habitación(es) de "suite"')
    expect(store.status).toBe('failed')
    expect(store.reservation).toBeNull()
    expect(store.isSubmitting).toBe(false)
  })

  it('la capacidad ya no alcanza (Tarea 10) → mismo camino: mensaje específico, no genérico', async () => {
    const store = setupSingleRoom()
    vi.mocked(BookingService.createBooking).mockRejectedValue(
      new ApiError(409, 'Esta habitación admite hasta 2 huésped(es); pediste 4'),
    )

    await store.pay()

    expect(store.error).toBe('Esta habitación admite hasta 2 huésped(es); pediste 4')
    expect(store.status).toBe('failed')
  })

  it('el promo se agotó justo antes de pagar → mensaje específico, no "no se pudo crear la reserva"', async () => {
    const store = setupSingleRoom()
    store.promoCode = 'WELCOME10'
    // Sin `promoResult.valid` no viaja `promoPayload`, pero eso no afecta este test: lo que
    // se prueba es que el error del backend (agotado ENTRE la validación y el submit) llega
    // intacto al huésped, sea cual sea la causa.
    vi.mocked(BookingService.createBooking).mockRejectedValue(new ApiError(400, 'promo_invalid'))

    await store.pay()

    expect(store.error).toBe('promo_invalid')
    expect(store.status).toBe('failed')
  })

  it('reintentar después de un fallo genera un idempotencyKey NUEVO (no reusa el intento fallido)', async () => {
    const store = setupSingleRoom()
    vi.mocked(BookingService.createBooking).mockRejectedValueOnce(new ApiError(409, 'no disponible'))

    await store.pay()
    const failedKey = store.idempotencyKey
    expect(failedKey).toBe('')

    vi.mocked(BookingService.createBooking).mockResolvedValueOnce({
      reservationId: 'r1', accessToken: 't1', checkoutUrl: null,
      totalBreakdown: { subtotal: 200, promoDiscount: 0, upsellsTotal: 0, taxes: 0, total: 200 },
    })
    await store.pay()

    // Retomó y generó una key propia para el segundo intento — nunca quedó vacía en el POST.
    expect(vi.mocked(BookingService.createBooking).mock.calls[1]![0].idempotencyKey).toBeTruthy()
  })

  it('un error de red (no ApiError) también se muestra — no queda el huésped sin saber qué pasó', async () => {
    const store = setupSingleRoom()
    vi.mocked(BookingService.createBooking).mockRejectedValue(new TypeError('Failed to fetch'))

    await store.pay()

    expect(store.error).toBe('Failed to fetch')
    expect(store.status).toBe('failed')
  })

  it('un throw no-Error (caso extremo) cae al mensaje genérico, nunca se queda en blanco', async () => {
    const store = setupSingleRoom()
    vi.mocked(BookingService.createBooking).mockRejectedValue('boom')

    await store.pay()

    expect(store.error).toBe('No se pudo crear la reserva. Probá de nuevo.')
    expect(store.status).toBe('failed')
  })
})
