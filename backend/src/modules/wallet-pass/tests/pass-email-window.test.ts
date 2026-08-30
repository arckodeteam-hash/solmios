import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendWalletPassEmail } from '../usecases/pass-email'
import { resolveReservationInfo } from '../usecases/generate-pass'

// El huésped recibe el PIN pero antes no sabía DESDE QUÉ HORA le sirve: el correo mostraba
// solo '2026-09-12' / '2026-09-13'. Con la ventana real cargada en la cerradura (15:00 → 12:00),
// probar la puerta a las 11 de la mañana daba "el código no anda" sin explicación.

function mailHarness() {
  const queued: any[] = []
  const emailService: any = { enqueue: async (i: any) => { queued.push(i); return { id: 'q1' } } }
  return { queued, emailService }
}

const BASE = {
  to: 'huesped@example.com', hotelId: 'h1', reservationId: 'res1',
  hotelName: 'Hotel Boutique Palma', guestName: 'Huésped',
  checkIn: '2026-09-12', checkOut: '2026-09-13',
  roomNumber: '103', lockCode: '401697',
}

describe('correo del código: ventana de apertura', () => {
  it('muestra la hora en la que el código empieza y deja de abrir', async () => {
    const h = mailHarness()
    await sendWalletPassEmail({ emailService: h.emailService, logger: silentLogger() },
      { ...BASE, checkInTime: '15:00', checkOutTime: '12:00' })
    const html = h.queued[0].html as string
    expect(html).toContain('2026-09-12 · 15:00')
    expect(html).toContain('2026-09-13 · 12:00')
  })

  it('lo explica en texto, no solo en la tabla', async () => {
    const h = mailHarness()
    await sendWalletPassEmail({ emailService: h.emailService, logger: silentLogger() },
      { ...BASE, checkInTime: '15:00', checkOutTime: '12:00' })
    const html = h.queued[0].html as string
    expect(html).toContain('abre la puerta desde')
    expect(html).toContain('deja de funcionar')
  })

  it('refleja el horario ACORDADO cuando hay early check-in', async () => {
    const h = mailHarness()
    await sendWalletPassEmail({ emailService: h.emailService, logger: silentLogger() },
      { ...BASE, checkInTime: '09:00', checkOutTime: '18:30' })
    const html = h.queued[0].html as string
    expect(html).toContain('09:00')
    expect(html).toContain('18:30')
    expect(html).not.toContain('15:00')
  })

  it('sin horas se degrada a solo fecha, no rompe el correo', async () => {
    const h = mailHarness()
    await sendWalletPassEmail({ emailService: h.emailService, logger: silentLogger() }, BASE)
    const html = h.queued[0].html as string
    expect(html).toContain('2026-09-12')
    expect(html).toContain('401697')
    // Y NO inventa un horario: si el caller no lo pasó, no aparece ninguno.
    expect(html).not.toContain('15:00')
    expect(html).not.toContain('12:00')
    expect(html).not.toMatch(/2026-09-12\s*·/)
  })
})

describe('las horas del correo salen del MISMO cálculo que la cerradura', () => {
  const HOTEL = { id: 'h1', name: 'Palma', checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo' }

  function deps(reserva: any): any {
    const one = (row: any) => ({ findOne: async () => row })
    return {
      reservationRepo: one(reserva),
      hotelRepo: one(HOTEL),
      guestRepo: one({ id: 'g1', name: 'Huésped', email: 'h@x.com' }),
      roomRepo: one({ id: 'r1', number: '103' }),
      logger: silentLogger(),
    }
  }

  it('sin acuerdo propio toma el horario del hotel', async () => {
    const info = await resolveReservationInfo(
      deps({ id: 'res1', hotelId: 'h1', guestId: 'g1', roomId: 'r1', checkIn: '2026-09-12', checkOut: '2026-09-13' }),
      'res1',
    )
    expect(info?.checkInTime).toBe('15:00')
    expect(info?.checkOutTime).toBe('12:00')
  })

  it('el horario acordado con el huésped pisa al del hotel', async () => {
    const info = await resolveReservationInfo(
      deps({ id: 'res1', hotelId: 'h1', guestId: 'g1', roomId: 'r1', checkIn: '2026-09-12', checkOut: '2026-09-13', checkInTime: '09:00' }),
      'res1',
    )
    expect(info?.checkInTime).toBe('09:00')
  })
})
