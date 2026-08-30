import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendCheckinEmail } from '../usecases/checkin-email'

// El correo de bienvenida/check-in lleva el código de la puerta. Tiene que anunciar la MISMA
// hora con la que ese código abre: antes leía `hotel.checkInTime` (campo inexistente) y decía
// siempre 14:00, y aun después del fix ignoraba el horario acordado con el huésped porque el
// input no lo transportaba.

const HOTEL = { id: 'h1', name: 'Palma', checkIn: '15:00', checkOut: '12:00', phone: '809' }

function harness(input: any) {
  const sent: any[] = []
  const one = (row: any) => ({ findById: async () => row, findOne: async () => row, findMany: async () => (row ? [row] : []) })
  const deps: any = {
    emailSender: { enqueueNotification: async (i: any) => { sent.push(i); return 'q1' } },
    guestRepo: one({ id: 'g1', hotelId: 'h1', name: 'Huésped', email: 'h@x.com' }),
    roomRepo: one({ id: 'r1', hotelId: 'h1', number: '103' }),
    hotelRepo: one(HOTEL),
    messageLogRepo: { create: async () => ({}) },
    lockCodeRepo: { findMany: async () => [{ code: '401697', status: 'active' }] },
    logger: silentLogger(),
  }
  return { sent, run: () => sendCheckinEmail(deps, input) }
}

const BASE = {
  reservationId: 'res1', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
  checkIn: '2026-09-12', checkOut: '2026-09-13',
}

describe('horario en el correo que lleva el código', () => {
  it('usa el horario configurado por el hotel, no el viejo 14:00', async () => {
    const h = harness(BASE)
    await h.run()
    expect(h.sent[0].variables.checkin_time).toBe('15:00')
    expect(h.sent[0].variables.checkin_time).not.toBe('14:00')
    expect(h.sent[0].variables.checkout_time).toBe('12:00')
  })

  it('el horario acordado con el huésped pisa al del hotel', async () => {
    const h = harness({ ...BASE, checkInTime: '09:00', checkOutTime: '18:30' })
    await h.run()
    expect(h.sent[0].variables.checkin_time).toBe('09:00')
    expect(h.sent[0].variables.checkout_time).toBe('18:30')
  })

  it('un horario acordado inválido no rompe: cae al del hotel', async () => {
    const h = harness({ ...BASE, checkInTime: '99:99' })
    await h.run()
    expect(h.sent[0].variables.checkin_time).toBe('15:00')
  })

  it('el correo lleva el código de la puerta junto al horario', async () => {
    const h = harness(BASE)
    await h.run()
    expect(h.sent[0].variables.lock_code).toBe('401697')
  })
})
