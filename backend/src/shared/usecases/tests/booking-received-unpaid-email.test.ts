import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendBookingReceivedUnpaidEmail, shouldSendReceivedUnpaidEmail } from '../booking-received-unpaid-email'
import { NOTIFICATION_DEFAULTS } from '../../../services/notification-defaults'

const HOTEL = {
  id: 'h1', name: 'Hotel Boutique Palma', phone: '+1 809 555 0100', email: 'info@palma.com',
  checkIn: '15:00', checkOut: '12:00', timezone: 'America/Santo_Domingo',
}
const RESERVA = {
  id: '9503bb41-cad6-4f99', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
  checkIn: '2026-09-12', checkOut: '2026-09-13', totalAmount: 76.7, deposit: 0,
  currency: 'USD', status: 'pending',
}
const GUEST = { id: 'g1', hotelId: 'h1', name: 'E2E Huésped', email: 'huesped@example.com' }

function harness(over: { reserva?: any; guest?: any; hotel?: any; sender?: any; platform?: any; hermanas?: any[] } = {}) {
  const sent: any[] = []
  const warns: unknown[] = []
  const findManyCalls: unknown[] = []
  const repo = (row: any) => ({ findById: async () => row, findMany: async () => (row ? [row] : []) })
  const reserva = over.reserva === undefined ? RESERVA : over.reserva
  const reservationsRepo = {
    findById: async () => reserva,
    findMany: async (where: unknown) => { findManyCalls.push(where); return over.hermanas ?? (reserva ? [reserva] : []) },
  }
  // silentLogger() es una instancia (métodos en el prototype): no se puede spreadear, se envuelve.
  const base = silentLogger()
  const logger: any = {
    info: base.info.bind(base), error: base.error.bind(base), debug: base.debug.bind(base),
    warn: (m: unknown, meta?: unknown) => { warns.push([m, meta]) },
  }
  const deps: any = {
    emailSender: over.sender ?? { enqueueNotification: async (i: any) => { sent.push(i); return 'q1' } },
    reservationsRepo,
    hotelRepo: repo(over.hotel === undefined ? HOTEL : over.hotel),
    guestRepo: repo(over.guest === undefined ? GUEST : over.guest),
    logger,
    ...(over.platform === undefined
      ? { platformIdentity: async () => ({ platformName: 'SolmiOS Test' }) }
      : over.platform === null ? {} : { platformIdentity: over.platform }),
  }
  return { sent, warns, findManyCalls, run: () => sendBookingReceivedUnpaidEmail(deps, RESERVA.id) }
}

describe('guard shouldSendReceivedUnpaidEmail', () => {
  it('hubo pasarela → no (el acuse sale al pagar)', () => {
    expect(shouldSendReceivedUnpaidEmail({ hasCheckout: true })).toBe(false)
  })
  it('sin pasarela y sin pago → sí', () => {
    expect(shouldSendReceivedUnpaidEmail({ hasCheckout: false })).toBe(true)
    expect(shouldSendReceivedUnpaidEmail({ hasCheckout: false, paid: false })).toBe(true)
  })
  it('flujo viejo sin el dato → no', () => {
    expect(shouldSendReceivedUnpaidEmail({})).toBe(false)
  })
  it('sin pasarela pero ya pagada → no', () => {
    expect(shouldSendReceivedUnpaidEmail({ hasCheckout: false, paid: true })).toBe(false)
  })
})

describe('correo "recibimos tu pedido" sin pasarela', () => {
  it('se encola con el evento reservation_received_unpaid, localizador y plataforma', async () => {
    const h = harness()
    expect(await h.run()).toBe(true)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].event).toBe('reservation_received_unpaid')
    expect(h.sent[0].to).toBe('huesped@example.com')
    expect(h.sent[0].relatedType).toBe('reservation')
    expect(h.sent[0].relatedId).toBe(RESERVA.id)
    const v = h.sent[0].variables
    expect(v.locator).toBe('9503bb41')
    expect(v.platform_name).toBe('SolmiOS Test')
  })

  it('lleva fechas CON hora, total y contacto del hotel', async () => {
    const h = harness(); await h.run()
    const v = h.sent[0].variables
    expect(v.guest_name).toBe('E2E Huésped')
    expect(v.hotel_name).toBe('Hotel Boutique Palma')
    expect(v.checkin_date).toBe('2026-09-12')
    expect(v.checkin_time).toBe('15:00')
    expect(v.checkout_date).toBe('2026-09-13')
    expect(v.checkout_time).toBe('12:00')
    expect(v.total_amount).toBe('76.70 USD')
    expect(v.hotel_phone).toBe('+1 809 555 0100')
    expect(v.hotel_email).toBe('info@palma.com')
  })

  // Grupo sin pasarela: el huésped pidió 3 habitaciones; el acuse con el total de UNA (la líder)
  // le decía que debía menos de lo que va a cobrarle el hotel.
  describe('reserva de grupo', () => {
    const LIDER = { ...RESERVA, groupId: 'grp1', totalAmount: 100 }
    const HERMANAS = [
      LIDER,
      { ...RESERVA, id: 'res-2', guestId: null, groupId: 'grp1', totalAmount: 120 },
      { ...RESERVA, id: 'res-3', guestId: null, groupId: 'grp1', totalAmount: 80 },
    ]

    it('total_amount suma las 3 hermanas del grupo, consultadas por hotelId + groupId', async () => {
      const h = harness({ reserva: LIDER, hermanas: HERMANAS }); await h.run()
      expect(h.findManyCalls).toEqual([{ hotelId: 'h1', groupId: 'grp1' }])
      expect(h.sent[0].variables.total_amount).toBe('300.00 USD')
      // El localizador sigue siendo el de la líder: es el que el hotel busca.
      expect(h.sent[0].variables.locator).toBe('9503bb41')
    })

    it('una hermana cancelada no entra en el total', async () => {
      const h = harness({
        reserva: LIDER,
        hermanas: [...HERMANAS, { ...RESERVA, id: 'res-4', groupId: 'grp1', status: 'cancelled', totalAmount: 500 }],
      })
      await h.run()
      expect(h.sent[0].variables.total_amount).toBe('300.00 USD')
    })

    it('sin groupId no consulta hermanas', async () => {
      const h = harness(); await h.run()
      expect(h.findManyCalls).toEqual([])
      expect(h.sent[0].variables.total_amount).toBe('76.70 USD')
    })
  })

  it('sin platformIdentity, platform_name va vacío (no hardcodea el nombre)', async () => {
    const h = harness({ platform: null }); await h.run()
    expect(h.sent[0].variables.platform_name).toBe('')
  })

  it('emailSender que tira → false sin throw y loguea warn', async () => {
    const h = harness({ sender: { enqueueNotification: async () => { throw new Error('smtp caído') } } })
    expect(await h.run()).toBe(false)
    expect(h.warns).toHaveLength(1)
    expect(String((h.warns[0] as unknown[])[0])).toContain('booking-received-unpaid-email')
  })

  it('reserva sin email de huésped → false y no encola', async () => {
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

// La plantilla es la otra mitad del contrato: toda variable que pida la tiene que proveer el usecase.
describe('plantilla reservation_received_unpaid', () => {
  const langs: string[] = ['es', 'en', 'pt']

  it('toda variable de la plantilla la provee el usecase (los 3 idiomas)', async () => {
    const h = harness(); await h.run()
    const provided = new Set(Object.keys(h.sent[0].variables))
    for (const lang of langs) {
      const tpl = (NOTIFICATION_DEFAULTS as any).reservation_received_unpaid[lang]
      const used = [...`${tpl.subject} ${tpl.body}`.matchAll(/\{(\w+)\}/g)].map(m => m[1])
      const missing = used.filter(v => !provided.has(v))
      expect({ lang, missing }).toEqual({ lang, missing: [] })
    }
  })
})
