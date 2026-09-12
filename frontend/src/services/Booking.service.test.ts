// services/Booking.service.test.ts — F0 0.20
// Cubre los 2 métodos: createBooking (mapeo DTO friendly → body plano + slug→hotelId +
// aplanado de respuesta) y getReservation (token en query). El http client va mockeado;
// PublicHotelService también, para no repetir el getBySlug en cada test de createBooking.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('./PublicHotel.service', () => ({
  PublicHotelService: { getBySlug: vi.fn() },
}))

import { BookingService } from './Booking.service'
import { http } from './http'
import { PublicHotelService } from './PublicHotel.service'
import type { PublicReservationResponse } from '@/types/booking'

const hotel = { id: 'hotel-uuid', slug: 'hotel-demo', name: 'Hotel Demo' }

describe('Booking.service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createBooking resuelve slug→hotelId, mapea guest→flat y envía successUrl/cancelUrl', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValue(hotel as any)
    vi.mocked(http.post).mockResolvedValue({
      reservation: { id: 'res-1', accessToken: 'tok-123' },
      guest: { id: 'g1' },
      checkoutUrl: 'https://stripe/checkout/cs_1',
    } as any)

    const res = await BookingService.createBooking({
      slug: 'hotel-demo',
      roomId: 'room-1',
      roomType: 'double',
      checkIn: '2026-08-01',
      checkOut: '2026-08-03',
      adults: 2,
      guest: { name: 'Ana', email: 'ana@x.com', phone: '+18095550000' },
      successUrl: 'https://demo/h/hotel-demo?booking=1',
      cancelUrl: 'https://demo/h/hotel-demo',
    })

    // Slug → hotelId resuelto.
    expect(PublicHotelService.getBySlug).toHaveBeenCalledWith('hotel-demo')
    // Body plano que pide el schema ExtendedPublicBookingSchema.
    expect(http.post).toHaveBeenCalledWith('/public/booking', {
      hotelId: 'hotel-uuid',
      roomId: 'room-1',
      roomType: 'double',
      guestName: 'Ana',
      guestEmail: 'ana@x.com',
      guestPhone: '+18095550000',
      checkIn: '2026-08-01',
      checkOut: '2026-08-03',
      adults: 2,
      successUrl: 'https://demo/h/hotel-demo?booking=1',
      cancelUrl: 'https://demo/h/hotel-demo',
    })
    // Respuesta aplana (spec booking-unification R-1).
    expect(res).toEqual({
      reservationId: 'res-1',
      accessToken: 'tok-123',
      checkoutUrl: 'https://stripe/checkout/cs_1',
    })
  })

  it('createBooking incluye children/promoCode/upsells solo cuando vienen', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValue(hotel as any)
    vi.mocked(http.post).mockResolvedValue({
      reservation: { id: 'res-2', accessToken: 'tok-456' },
      guest: null,
      checkoutUrl: null,
    } as any)

    const res = await BookingService.createBooking({
      slug: 'hotel-demo',
      roomId: 'room-1',
      roomType: 'suite',
      checkIn: '2026-08-10',
      checkOut: '2026-08-12',
      adults: 2,
      children: 1,
      guest: { name: 'Bob', email: 'b@x.com', phone: '+18095551111' },
      promoCode: 'VERANO10',
      upsells: [{ id: 'breakfast', quantity: 2 }],
    })

    const body = vi.mocked(http.post).mock.calls[0]![1] as Record<string, unknown>
    expect(body.children).toBe(1)
    expect(body.promoCode).toBe('VERANO10')
    expect(body.upsells).toEqual([{ id: 'breakfast', quantity: 2 }])
    // Sin successUrl/cancelUrl → no se mandan (el backend deriva de PUBLIC_BASE_URL).
    expect(body.successUrl).toBeUndefined()
    expect(body.cancelUrl).toBeUndefined()

    // Stripe no configurado/gateway caído: checkoutUrl null + SIN paymentError → el widget
    // muestra la reserva pendiente (no rompe).
    expect(res).toEqual({
      reservationId: 'res-2',
      accessToken: 'tok-456',
      checkoutUrl: null,
    })
    expect(res.paymentError).toBeUndefined()
  })

  it('createBooking incluye mealPlan solo cuando viene (#265/#268 MR-03)', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValue(hotel as any)
    vi.mocked(http.post).mockResolvedValue({
      reservation: { id: 'res-mp', accessToken: 'tok-mp' },
      guest: null,
      checkoutUrl: null,
    } as any)

    const base = {
      slug: 'hotel-demo',
      roomType: 'suite',
      checkIn: '2026-08-10',
      checkOut: '2026-08-12',
      adults: 2,
      guest: { name: 'Bob', email: 'b@x.com', phone: '+18095551111' },
    }

    // Con mealPlan → viaja tal cual al backend (antes se perdía en el mapeo campo-por-campo
    // y la reserva quedaba `room_only` con mealPlanTotal=0).
    await BookingService.createBooking({ ...base, mealPlan: 'breakfast' })
    const withPlan = vi.mocked(http.post).mock.calls[0]![1] as Record<string, unknown>
    expect(withPlan.mealPlan).toBe('breakfast')

    // Sin mealPlan → la clave no viaja (mismo criterio que upsells/needsCrib).
    await BookingService.createBooking(base)
    const withoutPlan = vi.mocked(http.post).mock.calls[1]![1] as Record<string, unknown>
    expect('mealPlan' in withoutPlan).toBe(false)
  })

  it('createBooking propaga paymentError cuando Stripe falla (reserva sigue creada)', async () => {
    vi.mocked(PublicHotelService.getBySlug).mockResolvedValue(hotel as any)
    vi.mocked(http.post).mockResolvedValue({
      reservation: { id: 'res-3', accessToken: 'tok-789' },
      guest: null,
      checkoutUrl: null,
      paymentError: 'payment_gateway_unavailable',
    } as any)

    const res = await BookingService.createBooking({
      slug: 'hotel-demo',
      roomId: 'room-1',
      roomType: 'double',
      checkIn: '2026-09-01',
      checkOut: '2026-09-02',
      adults: 1,
      guest: { name: 'Carl', email: 'c@x.com', phone: '+18095552222' },
    })

    expect(res.paymentError).toBe('payment_gateway_unavailable')
    expect(res.checkoutUrl).toBeNull()
  })

  it('getReservation manda el token como query param', async () => {
    const raw: PublicReservationResponse = {
      reservation: {
        id: 'res-1', hotelId: 'h1', roomId: 'r1', checkIn: '2026-08-01', checkOut: '2026-08-03',
        status: 'pending', paymentStatus: 'unpaid',
      },
      guest: { id: 'g1', name: 'Ana' },
      paymentStatus: 'unpaid',
    }
    vi.mocked(http.get).mockResolvedValue(raw as any)

    const res = await BookingService.getReservation('res-1', 'tok-123')

    expect(http.get).toHaveBeenCalledWith('/public/reservations/res-1?token=tok-123')
    expect(res).toBe(raw)
  })

  it('getCalendar arma la query con from/to/guests/currency y encodea el slug', async () => {
    vi.mocked(http.get).mockResolvedValue({
      currency: 'DOP', chargeCurrency: 'DOP', from: '2026-08-01', to: '2026-08-31', guests: 3, days: [],
    } as any)

    await BookingService.getCalendar('hotel demo', {
      from: '2026-08-01', to: '2026-08-31', guests: 3, currency: 'DOP',
    })

    expect(http.get).toHaveBeenCalledWith(
      '/public/hotels/hotel%20demo/calendar?from=2026-08-01&to=2026-08-31&guests=3&currency=DOP',
    )
  })

  it('getCalendar recorta el rango al tope de 90 días (pedir más devuelve 400)', async () => {
    vi.mocked(http.get).mockResolvedValue({ days: [] } as any)

    await BookingService.getCalendar('hotel-demo', { from: '2026-01-01', to: '2026-12-31' })

    // 90 días inclusive desde el 1 de enero = hasta el 31 de marzo.
    expect(http.get).toHaveBeenCalledWith(
      '/public/hotels/hotel-demo/calendar?from=2026-01-01&to=2026-03-31',
    )
  })

  it('getReservation encodea id y token (UUIDs con guiones no necesitan, pero chars especiales sí)', async () => {
    vi.mocked(http.get).mockResolvedValue({
      reservation: { id: 'r&1', hotelId: 'h1', roomId: 'r1', checkIn: '', checkOut: '', status: 'pending' },
      guest: null,
      paymentStatus: 'unpaid',
    } as any)

    await BookingService.getReservation('r&1', 'tok with space')
    expect(http.get).toHaveBeenCalledWith('/public/reservations/r%261?token=tok+with+space')
  })
})
