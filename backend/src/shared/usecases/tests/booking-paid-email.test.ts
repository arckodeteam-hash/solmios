import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendBookingPaidEmail } from '../booking-paid-email'
import { cancellationPolicyText } from '../cancellation-text'

const HOTEL = {
  id: 'h1', name: 'Hotel Boutique Palma', phone: '+1 809 555 0100', email: 'info@palma.com',
  address: 'Calle 1', municipality: 'Punta Cana', province: 'La Altagracia', country: 'RD',
  checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo',
  cancellationType: 'strict',
}
const RESERVA = {
  id: '9503bb41-cad6-4f99', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
  checkIn: '2026-09-12', checkOut: '2026-09-13', totalAmount: 76.7, deposit: 76.7,
  currency: 'USD', paymentMethod: 'card',
}
const GUEST = { id: 'g1', hotelId: 'h1', name: 'E2E Huésped', email: 'huesped@example.com' }

function harness(over: { reserva?: any; guest?: any; hotel?: any } = {}) {
  const sent: any[] = []
  const repo = (row: any) => ({ findById: async () => row, findMany: async () => (row ? [row] : []) })
  const deps: any = {
    emailSender: { enqueueNotification: async (i: any) => { sent.push(i); return 'q1' } },
    reservationsRepo: repo(over.reserva === undefined ? RESERVA : over.reserva),
    hotelRepo: repo(over.hotel === undefined ? HOTEL : over.hotel),
    guestRepo: repo(over.guest === undefined ? GUEST : over.guest),
    logger: silentLogger(),
  }
  return { sent, run: () => sendBookingPaidEmail(deps, RESERVA.id) }
}

describe('correo de confirmación de pago', () => {
  it('se encola con el evento de confirmación', async () => {
    const h = harness()
    expect(await h.run()).toBe(true)
    expect(h.sent[0].event).toBe('reservation_confirmed')
    expect(h.sent[0].to).toBe('huesped@example.com')
  })

  it('NO lleva número de habitación ni código de acceso', async () => {
    const h = harness(); await h.run()
    const v = h.sent[0].variables
    expect(v.room_number).toBe('')
    expect(v.lock_code).toBe('')
  })

  it('lleva las fechas CON la hora del hotel', async () => {
    const h = harness(); await h.run()
    const v = h.sent[0].variables
    expect(v.checkin_date).toBe('2026-09-12')
    expect(v.checkin_time).toBe('15:00')
    expect(v.checkout_time).toBe('12:00')
  })

  it('el horario acordado con el huésped pisa al del hotel', async () => {
    const h = harness({ reserva: { ...RESERVA, checkInTime: '09:00' } }); await h.run()
    expect(h.sent[0].variables.checkin_time).toBe('09:00')
  })

  it('confirma la plata: total, pagado y pendiente', async () => {
    const h = harness(); await h.run()
    const v = h.sent[0].variables
    expect(v.total_amount).toBe('76.70 USD')
    expect(v.deposit_amount).toBe('76.70 USD')
    expect(v.pending_amount).toBe('—')       // pagó todo
    expect(v.payment_method).toBe('Tarjeta')
  })

  it('muestra el saldo cuando el pago fue parcial', async () => {
    const h = harness({ reserva: { ...RESERVA, deposit: 30 } }); await h.run()
    expect(h.sent[0].variables.pending_amount).toBe('46.70 USD')
  })

  it('lleva la política de cancelación del hotel y sus datos de contacto', async () => {
    const h = harness(); await h.run()
    const v = h.sent[0].variables
    expect(v.cancellation_policy).toContain('7 días')
    expect(v.hotel_address).toContain('Punta Cana')
    expect(v.hotel_phone).toBe('+1 809 555 0100')
  })

  it('sin email de huésped no encola nada (y no revienta)', async () => {
    const h = harness({ guest: { id: 'g1', hotelId: 'h1', name: 'X' } })
    expect(await h.run()).toBe(false)
    expect(h.sent).toHaveLength(0)
  })

  it('tenancy: huésped de otro hotel no recibe el correo', async () => {
    const h = harness({ guest: { ...GUEST, hotelId: 'OTRO' } })
    expect(await h.run()).toBe(false)
    expect(h.sent).toHaveLength(0)
  })

  it('reserva inexistente: no-op', async () => {
    const h = harness({ reserva: null })
    expect(await h.run()).toBe(false)
  })
})

describe('texto de la política de cancelación', () => {
  it('cada preset tiene su redacción', () => {
    expect(cancellationPolicyText('flexible')).toContain('gratuita')
    expect(cancellationPolicyText('moderate')).toContain('72 horas')
    expect(cancellationPolicyText('strict')).toContain('7 días')
    expect(cancellationPolicyText('non_refundable')).toContain('no admite')
  })
  it('sin política cargada NO promete cancelación gratis: remite al hotel', () => {
    const txt = cancellationPolicyText(null)
    expect(txt).toContain('Consultá')
    expect(txt).not.toContain('gratuita')
  })
  it('traduce', () => {
    expect(cancellationPolicyText('strict', 'en')).toContain('7 days')
    expect(cancellationPolicyText('strict', 'pt')).toContain('7 dias')
  })
})
