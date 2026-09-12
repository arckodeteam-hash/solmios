// #272 — Correos de cancelación web: huésped (su idioma) + buzón del hotel (es).
import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendBookingCancelledEmails, refundLine } from '../booking-cancelled-email'
import { NOTIFICATION_DEFAULTS } from '../../../services/notification-defaults'

const HOTEL = {
  id: 'h1', name: 'Hotel Boutique Palma', phone: '+1 809 555 0100', email: 'info@palma.com',
}
const RESERVA = {
  id: '9503bb41-cad6-4f99', hotelId: 'h1', guestId: 'g1', roomId: 'r1', status: 'cancelled',
  checkIn: '2026-09-12', checkOut: '2026-09-13', totalAmount: 150, currency: 'USD',
  refundAmount: 100, cancellationFee: 50, refundStatus: 'done',
  refundedAt: '2026-09-10T10:00:00.000Z', cancelledAt: '2026-09-10T10:00:00.000Z',
}
const GUEST = { id: 'g1', hotelId: 'h1', name: 'E2E Huésped', email: 'huesped@example.com' }

function harness(over: { reserva?: any; guest?: any; hotel?: any; enqueue?: (i: any) => Promise<string> } = {}) {
  const sent: any[] = []
  const repo = (row: any) => ({ findById: async () => row, findMany: async () => (row ? [row] : []) })
  const deps: any = {
    emailSender: { enqueueNotification: over.enqueue ?? (async (i: any) => { sent.push(i); return 'q1' }) },
    reservationsRepo: repo(over.reserva === undefined ? RESERVA : over.reserva),
    hotelRepo: repo(over.hotel === undefined ? HOTEL : over.hotel),
    guestRepo: repo(over.guest === undefined ? GUEST : over.guest),
    logger: silentLogger(),
  }
  return {
    sent,
    run: (ev: Partial<{ reservationId: string; hotelId: string; reservationIds: string[] }> = {}) =>
      sendBookingCancelledEmails(deps, { reservationId: RESERVA.id, hotelId: 'h1', ...ev }),
  }
}

describe('correos de cancelación web (#272)', () => {
  it('(a) reembolso hecho: correo al huésped con el monto y "5-10 días hábiles"', async () => {
    const h = harness()
    const r = await h.run()
    expect(r.guest).toBe(true)
    expect(h.sent[0].event).toBe('reservation_cancelled_guest')
    expect(h.sent[0].to).toBe('huesped@example.com')
    expect(h.sent[0].language).toBe('es')
    const v = h.sent[0].variables
    expect(v.refund_amount).toBe(100)
    expect(v.refund_amount_text).toBe('100.00 USD')
    expect(v.cancellation_fee_text).toBe('50.00 USD')
    expect(v.total_amount).toBe('150.00 USD')
    expect(v.refund_line).toContain('5-10 días hábiles')
    expect(h.sent[0].relatedType).toBe('reservation')
    expect(h.sent[0].relatedId).toBe(RESERVA.id)
  })

  it('(b) refundAmount 0: "sin reembolso según la política"', async () => {
    const h = harness({ reserva: { ...RESERVA, refundAmount: 0, refundStatus: 'none', cancellationFee: 150 } })
    await h.run()
    const v = h.sent[0].variables
    expect(v.refund_amount).toBe(0)
    expect(String(v.refund_line).toLowerCase()).toContain('sin reembolso según la política')
    expect(v.refund_amount_text).toBe('0.00 USD')
  })

  it('(c) hotel con email: segundo encolado al buzón del hotel, en español y con link al panel', async () => {
    const h = harness()
    const r = await h.run()
    expect(r.staff).toBe(true)
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1].event).toBe('reservation_cancelled_staff')
    expect(h.sent[1].to).toBe('info@palma.com')
    expect(h.sent[1].language).toBe('es')
    expect(h.sent[1].variables.reservation_link).toContain(`/panel/reservations?open=${RESERVA.id}`)
    expect(h.sent[1].variables.reservation_id).toBe(RESERVA.id)
  })

  it('(d) grupo de 3 reservas: rooms_count 3 en los dos correos', async () => {
    const h = harness()
    await h.run({ reservationIds: [RESERVA.id, 'r2', 'r3'] })
    expect(h.sent[0].variables.rooms_count).toBe(3)
    expect(h.sent[1].variables.rooms_count).toBe(3)
  })

  it('sin reservationIds: rooms_count 1', async () => {
    const h = harness(); await h.run()
    expect(h.sent[0].variables.rooms_count).toBe(1)
  })

  it('(e) reembolso fallido: huésped "el hotel lo está gestionando", staff "Reintentar"', async () => {
    const h = harness({ reserva: { ...RESERVA, refundStatus: 'failed' } })
    await h.run()
    expect(h.sent[0].variables.refund_line).toContain('el hotel lo está gestionando')
    expect(h.sent[0].variables.refund_line).not.toContain('Reintentar')
    expect(h.sent[1].variables.refund_line).toContain('Reintentar')
  })

  it('reembolso pendiente (todavía sin procesar): mismo texto de "gestionando", sin "Reintentar"', async () => {
    const h = harness({ reserva: { ...RESERVA, refundStatus: 'pending' } })
    await h.run()
    expect(h.sent[0].variables.refund_line).toContain('el hotel lo está gestionando')
    expect(h.sent[1].variables.refund_line).not.toContain('Reintentar')
  })

  it('(f) tenancy: hotelId del evento distinto al de la reserva → no encola nada', async () => {
    const h = harness()
    const r = await h.run({ hotelId: 'OTRO' })
    expect(r).toEqual({ guest: false, staff: false })
    expect(h.sent).toHaveLength(0)
  })

  it('(g) enqueue lanza → devuelve {guest:false, staff:false} sin tirar', async () => {
    const h = harness({ enqueue: async () => { throw new Error('smtp caído') } })
    const r = await h.run()
    expect(r).toEqual({ guest: false, staff: false })
  })

  it('huésped en inglés: correo del huésped en en, el del hotel sigue en es', async () => {
    const h = harness({ guest: { ...GUEST, language: 'en' } })
    await h.run()
    expect(h.sent[0].language).toBe('en')
    expect(h.sent[0].variables.refund_line).toContain('5-10 business days')
    expect(h.sent[1].language).toBe('es')
  })

  it('sin email de huésped: sólo el correo al hotel', async () => {
    const h = harness({ guest: { id: 'g1', hotelId: 'h1', name: 'X' } })
    const r = await h.run()
    expect(r).toEqual({ guest: false, staff: true })
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].event).toBe('reservation_cancelled_staff')
  })

  it('hotel sin email: sólo el correo al huésped', async () => {
    const h = harness({ hotel: { ...HOTEL, email: '' } })
    const r = await h.run()
    expect(r).toEqual({ guest: true, staff: false })
    expect(h.sent).toHaveLength(1)
  })

  it('reserva inexistente: no-op', async () => {
    const h = harness({ reserva: null })
    expect(await h.run()).toEqual({ guest: false, staff: false })
  })
})

describe('refundLine', () => {
  it('sin plata → sin reembolso en los 3 idiomas', () => {
    expect(refundLine(0, 'done', 'USD', 'es')).toContain('Sin reembolso')
    expect(refundLine(0, 'done', 'USD', 'en')).toContain('No refund')
    expect(refundLine(0, 'done', 'USD', 'pt')).toContain('Sem reembolso')
  })
  it('done → procesado con el monto', () => {
    expect(refundLine(100, 'done', 'USD', 'es')).toBe('Reembolso de 100.00 USD procesado: lo verás en tu tarjeta en 5-10 días hábiles.')
  })
  it('failed/pending/otro → pendiente', () => {
    for (const st of ['failed', 'pending', 'none', '']) {
      expect(refundLine(100, st, 'USD', 'pt')).toContain('pendente')
    }
  })
})

// La plantilla es la otra mitad del contrato: toda variable que pide la provee el usecase.
describe('plantillas reservation_cancelled_*', () => {
  const langs: string[] = ['es', 'en', 'pt']
  const bodyOf = (event: string, lang: string): string =>
    (NOTIFICATION_DEFAULTS as any)[event][lang].subject + ' ' + (NOTIFICATION_DEFAULTS as any)[event][lang].body

  it('toda variable de las plantillas la provee el usecase (los 3 idiomas, guest y staff)', async () => {
    const h = harness(); await h.run()
    for (const [i, event] of ['reservation_cancelled_guest', 'reservation_cancelled_staff'].entries()) {
      const provided = new Set(Object.keys(h.sent[i].variables))
      for (const lang of langs) {
        const used = [...bodyOf(event, lang).matchAll(/\{(\w+)\}/g)].map(m => m[1])
        const missing = used.filter(v => !provided.has(v))
        expect({ event, lang, missing }).toEqual({ event, lang, missing: [] })
      }
    }
  })
})
