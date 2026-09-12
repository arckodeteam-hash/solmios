import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./http', () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { ReservationService, mapReservation, STATUS_MAP } from './Reservation.service'
import { http } from './http'

const rawReservation = (over: Record<string, unknown> = {}) => ({
  id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room1',
  checkIn: '2026-01-01', checkOut: '2026-01-03', channel: 'direct',
  totalAmount: 200, status: 'confirmada', ...over,
})

describe('Reservation.service — mapReservation', () => {
  it('normaliza status en español al enum en inglés', () => {
    expect(mapReservation(rawReservation({ status: 'confirmada' })).status).toBe('confirmed')
    expect(mapReservation(rawReservation({ status: 'check_in' })).status).toBe('checked_in')
    expect(mapReservation(rawReservation({ status: 'cancelada' })).status).toBe('cancelled')
  })

  it('status desconocido cae a "pending"', () => {
    expect(mapReservation(rawReservation({ status: 'lo-que-sea' })).status).toBe('pending')
    expect(STATUS_MAP['booking' as keyof typeof STATUS_MAP]).toBeUndefined()
  })

  it('mapea el canal a source y desconocido cae a "other"', () => {
    expect(mapReservation(rawReservation({ channel: 'booking.com' })).source).toBe('booking')
    expect(mapReservation(rawReservation({ channel: 'inexistente' })).source).toBe('other')
  })

  it('deriva paymentStatus según deposit vs totalAmount', () => {
    // sin depósito → pending
    expect(mapReservation(rawReservation({ deposit: 0, totalAmount: 200 })).paymentStatus).toBe('pending')
    // depósito parcial → partial
    expect(mapReservation(rawReservation({ deposit: 50, totalAmount: 200 })).paymentStatus).toBe('partial')
    // depósito cubre el total → paid
    expect(mapReservation(rawReservation({ deposit: 200, totalAmount: 200 })).paymentStatus).toBe('paid')
  })

  it('aplica defaults a adults/children/guestId/roomId ausentes', () => {
    const r = mapReservation({ id: 'r1', hotelId: 'h1', guestId: null, roomId: null, checkIn: 'a', checkOut: 'b', channel: 'direct', totalAmount: 100, status: 'pending' })
    expect(r.adults).toBe(2)
    expect(r.children).toBe(0)
    expect(r.guestId).toBe('')
    expect(r.roomId).toBe('')
  })
})

describe('Reservation.service — endpoints', () => {
  beforeEach(() => vi.clearAllMocks())

  it('list arma el querystring solo con params presentes y mapea data+total', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [rawReservation(), rawReservation({ id: 'r2' })], total: 2 } as any)

    const res = await ReservationService.list({ hotelId: 'h1', status: 'confirmed', limit: 10 })

    const url = vi.mocked(http.get).mock.calls[0][0] as string
    expect(url).toContain('/reservas?')
    expect(url).toContain('hotelId=h1')
    expect(url).toContain('status=confirmed')
    expect(url).toContain('limit=10')
    expect(res.reservations).toHaveLength(2)
    expect(res.total).toBe(2)
  })

  it('list sin params pega a /reservas sin querystring', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: [], total: 0 } as any)
    await ReservationService.list()
    expect(http.get).toHaveBeenCalledWith('/reservas')
  })

  it('create postea el input crudo a /reservas y devuelve la reserva mapeada', async () => {
    vi.mocked(http.post).mockResolvedValue(rawReservation({ status: 'pendiente' }) as any)

    const input = { hotelId: 'h1', roomId: 'room1', checkIn: '2026-01-01', checkOut: '2026-01-03', totalAmount: 200 }
    const res = await ReservationService.create(input)

    expect(http.post).toHaveBeenCalledWith('/reservas', input)
    expect(res.status).toBe('pending')
  })

  it('update pega PUT a /reservas/:id con el patch', async () => {
    vi.mocked(http.put).mockResolvedValue(rawReservation({ status: 'check_in' }) as any)

    const res = await ReservationService.update('r1', { status: 'check_in' })

    expect(http.put).toHaveBeenCalledWith('/reservas/r1', { status: 'check_in' })
    expect(res.status).toBe('checked_in')
  })

  it('checkin postea a /reservas/:id/checkin y devuelve folioId+guestId', async () => {
    vi.mocked(http.post).mockResolvedValue({ ok: true, folioId: 'f1', guestId: 'g1' } as any)

    const res = await ReservationService.checkin('r1')

    expect(http.post).toHaveBeenCalledWith('/reservas/r1/checkin', {})
    expect(res).toEqual({ folioId: 'f1', guestId: 'g1' })
  })

  it('checkout envía el settle en el body', async () => {
    vi.mocked(http.post).mockResolvedValue({ settlement: { folioId: 'f1', invoiceId: 'i1', balance: 0, amountPaid: 100, invoiceNumber: 'A-1' } } as any)

    await ReservationService.checkout('r1', { method: 'cash', amount: 100 })

    expect(http.post).toHaveBeenCalledWith('/reservas/r1/checkout', { settle: { method: 'cash', amount: 100 }, acknowledgeDebt: false })
  })

  // El servidor exige la confirmación cuando la estadía se cierra debiendo: si el flag no viaja,
  // el checkout con deuda vuelve con 409 y la pantalla no puede completarlo.
  it('checkout con deuda manda acknowledgeDebt', async () => {
    vi.mocked(http.post).mockResolvedValue({} as any)

    await ReservationService.checkout('r1', null, true)

    expect(http.post).toHaveBeenCalledWith('/reservas/r1/checkout', { settle: null, acknowledgeDebt: true })
  })

  it('remove pega DELETE a /reservas/:id', async () => {
    vi.mocked(http.delete).mockResolvedValue(undefined as any)
    await ReservationService.remove('r1')
    expect(http.delete).toHaveBeenCalledWith('/reservas/r1')
  })

  it('getById usa el endpoint enriquecido /reservations/:id (no /reservas)', async () => {
    vi.mocked(http.get).mockResolvedValue({ id: 'r1' } as any)
    await ReservationService.getById('r1')
    expect(http.get).toHaveBeenCalledWith('/reservations/r1')
  })

  // El modal de cancelación anuncia el reembolso que el servidor APLICÓ, no el que cotizó el
  // preview (entre abrir y confirmar puede cruzarse un borde de tier de la política). Ese dato
  // viaja por acá: si `mapReservation` no lo propaga, el modal cae al monto viejo y el mostrador
  // devuelve de más. El test del modal mockea este service entero, así que no cubre el transporte.
  it('cancel devuelve los montos APLICADOS de la cancelación (no se pierden en el mapeo)', async () => {
    vi.mocked(http.post).mockResolvedValue(
      rawReservation({ status: 'cancelada', refundAmount: 60, cancellationFee: 90 }) as any,
    )

    const result = await ReservationService.cancel('r1', { reason: 'Solicitud del huésped' })

    expect(http.post).toHaveBeenCalledWith('/reservas/r1/cancel', { reason: 'Solicitud del huésped' })
    expect(result.refundAmount).toBe(60)
    expect(result.cancellationFee).toBe(90)
  })

  it('una reserva sin cancelación no inventa montos', async () => {
    const r = mapReservation(rawReservation())
    expect(r.refundAmount).toBeUndefined()
    expect(r.cancellationFee).toBeUndefined()
  })
})

describe('Reservation.service — issueInvoice', () => {
  beforeEach(() => vi.clearAllMocks())

  const body = { invoiceId: 'inv1', invoiceNumber: 'F-0001', source: 'reservation' as const, linkedPayments: 1, amountPaid: 200 }

  it('sin notes pega POST a /reservas/:id/invoice con body vacío y devuelve el resultado sin transformar', async () => {
    vi.mocked(http.post).mockResolvedValue(body as any)

    const result = await ReservationService.issueInvoice('r1')

    expect(http.post).toHaveBeenCalledWith('/reservas/r1/invoice', {})
    expect(result).toEqual(body)
  })

  it('con notes las manda en el body', async () => {
    vi.mocked(http.post).mockResolvedValue(body as any)

    const result = await ReservationService.issueInvoice('r1', 'x')

    expect(http.post).toHaveBeenCalledWith('/reservas/r1/invoice', { notes: 'x' })
    expect(result).toEqual(body)
  })
})
