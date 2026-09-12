import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { sendBookingPaidEmail } from '../booking-paid-email'
import { cancellationPolicyText } from '../cancellation-text'
import { NOTIFICATION_DEFAULTS } from '../../../services/notification-defaults'

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

interface HarnessOver {
  reserva?: any; guest?: any; hotel?: any
  /** Repo de reservas completo (gana sobre `reserva`/`siblings`) — tests de grupo de #276. */
  reservationsRepo?: any
  /** Hermanas del grupo (lo que devuelve findMany({ hotelId, groupId })). */
  siblings?: any[]
  rooms?: Record<string, any>
  configRow?: any
  attachReceipt?: boolean
  publicUrl?: string
  enqueue?: (i: any) => Promise<string>
}

function harness(over: HarnessOver = {}) {
  const sent: any[] = []
  const notifications: any[] = []
  const repo = (row: any) => ({ findById: async () => row, findMany: async () => (row ? [row] : []) })
  const reserva = over.reserva === undefined ? RESERVA : over.reserva
  const deps: any = {
    emailSender: { enqueueNotification: over.enqueue ?? (async (i: any) => { sent.push(i); return 'q1' }) },
    reservationsRepo: over.reservationsRepo
      ?? { findById: async () => reserva, findMany: async () => over.siblings ?? (reserva ? [reserva] : []) },
    hotelRepo: repo(over.hotel === undefined ? HOTEL : over.hotel),
    guestRepo: repo(over.guest === undefined ? GUEST : over.guest),
    logger: silentLogger(),
  }
  // Deps opcionales (#270): sólo se inyectan si el test los pide, así los casos viejos siguen
  // probando el contrato mínimo de 5 deps.
  if (over.rooms) deps.roomsRepo = { findById: async (id: string) => over.rooms![id] ?? null }
  if (over.configRow !== undefined) deps.configRepo = { findOne: async () => over.configRow }
  if (over.attachReceipt !== undefined) deps.attachReceipt = over.attachReceipt
  if (over.publicUrl !== undefined) deps.publicUrl = over.publicUrl
  deps.notificationsRepo = { create: async (row: any) => { notifications.push(row); return row } }
  return { sent, notifications, run: () => sendBookingPaidEmail(deps, RESERVA.id) }
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

  // #276 MR-11: el cobro de un grupo queda repartido entre las hermanas; el mail habla del
  // pedido entero, no de la fila líder.
  describe('reserva de grupo', () => {
    const LIDER = { ...RESERVA, groupId: 'g1', totalAmount: 100, deposit: 118 }
    const HERMANAS = [
      LIDER,
      { ...RESERVA, id: 'res-2', guestId: null, groupId: 'g1', totalAmount: 100, deposit: 118 },
      { ...RESERVA, id: 'res-3', guestId: null, groupId: 'g1', totalAmount: 200, deposit: 236 },
    ]

    it('suma total y pagado de todas las hermanas', async () => {
      const calls: any[] = []
      const h = harness({ reservationsRepo: {
        findById: async () => LIDER,
        findMany: async (f: any) => { calls.push(f); return HERMANAS },
      } })
      expect(await h.run()).toBe(true)
      expect(calls[0]).toEqual({ hotelId: 'h1', groupId: 'g1' })
      const v = h.sent[0].variables
      expect(v.total_amount).toBe('400.00 USD')
      expect(v.deposit_amount).toBe('472.00 USD')
      expect(v.pending_amount).toBe('—')
    })

    it('ignora las hermanas canceladas', async () => {
      const h = harness({ reservationsRepo: {
        findById: async () => LIDER,
        findMany: async () => [...HERMANAS, { ...RESERVA, id: 'res-4', groupId: 'g1', status: 'cancelled', totalAmount: 500, deposit: 0 }],
      } })
      await h.run()
      expect(h.sent[0].variables.total_amount).toBe('400.00 USD')
      expect(h.sent[0].variables.pending_amount).toBe('—')
    })

    it('si la consulta no trae a la líder, igual la cuenta', async () => {
      const h = harness({ reservationsRepo: {
        findById: async () => LIDER,
        findMany: async () => HERMANAS.slice(1),
      } })
      await h.run()
      expect(h.sent[0].variables.total_amount).toBe('400.00 USD')
      expect(h.sent[0].variables.deposit_amount).toBe('472.00 USD')
    })

    it('si falla la carga de hermanas usa sólo la líder (best-effort)', async () => {
      const h = harness({ reservationsRepo: {
        findById: async () => LIDER,
        findMany: async () => { throw new Error('db down') },
      } })
      expect(await h.run()).toBe(true)
      const v = h.sent[0].variables
      expect(v.total_amount).toBe('100.00 USD')
      expect(v.deposit_amount).toBe('118.00 USD')
    })

    it('sin groupId no consulta hermanas', async () => {
      let called = false
      const h = harness({ reservationsRepo: {
        findById: async () => RESERVA,
        findMany: async () => { called = true; return [] },
      } })
      await h.run()
      expect(called).toBe(false)
      expect(h.sent[0].variables.total_amount).toBe('76.70 USD')
    })
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

// #270: el correo es el recibo completo — desglose, ocupación, grupo, adjunto y aviso al hotel si falla.
describe('recibo completo (#270)', () => {
  const RESERVA_270 = {
    ...RESERVA, accessToken: 'tok-abc', totalAmount: 406.2, deposit: 406.2,
    adults: 2, children: 1, childrenAges: [6], needsCrib: true,
    estimatedArrival: '18:00', specialRequests: 'Piso alto', promoCode: 'VERANO10',
    childAmenities: [{ key: 'crib-kit', name: 'Kit bebé', price: 15, quantity: 1, total: 15 }],
    roomAmenities: [],
    priceBreakdown: {
      subtotal: 300, promoDiscount: 10, upsellsTotal: 20,
      // MR-10 (#275): `upsells[]` cotizados por `kind` (per_person: unitPrice × quantity).
      upsells: [{ id: 'u1', name: 'Desayuno', kind: 'per_person', unitPrice: 10, quantity: 2, nights: 1, total: 20 }],
      childAmenitiesTotal: 15, roomAmenitiesTotal: 0,
      // Impuestos sobre el alojamiento neto (300 − 10 = 290): 18% = 52.2 y 10% = 29.
      // total = 290 + 20 + 15 + 81.2 = 406.2
      taxes: 81.2,
      taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 52.2 }, { name: 'Propina legal', rate: 10, amount: 29 }],
      total: 406.2,
    },
  }
  const HOTEL_270 = { ...HOTEL, slug: 'palma', logo: '/uploads/logo.png' }

  it('(a) lleva el desglose completo con los importes exactos del priceBreakdown', async () => {
    const h = harness({ reserva: RESERVA_270, hotel: HOTEL_270, publicUrl: 'https://app.test', configRow: null })
    expect(await h.run()).toBe(true)
    const v = h.sent[0].variables
    expect(v.extras_lines).toContain('Desayuno × 2 = 20.00 USD')
    expect(v.extras_lines.startsWith('<ul><li>')).toBe(true)
    expect(v.child_amenities_lines).toContain('Kit bebé')
    expect(v.child_amenities_lines).toContain('15.00 USD')
    expect(v.room_amenities_lines).toBe('')
    expect(v.tax_lines).toContain('ITBIS')
    expect(v.tax_lines).toContain('18%')
    expect(v.tax_lines).toContain('52.20 USD')
    expect(v.tax_lines).toContain('Propina legal')
    expect(v.tax_lines).toContain('10%')
    expect(v.promo_code).toBe('VERANO10')
    expect(v.promo_discount).toBe('10.00 USD')
    expect(v.subtotal).toBe('300.00 USD')
    expect(v.total_amount).toBe('406.20 USD')
    expect(v.adults).toBe('2')
    expect(v.children).toBe('1')
    expect(v.children_ages).toBe('6')
    expect(v.crib).toBe('Sí')
    expect(v.meal_plan).toBe('Sólo alojamiento')
    expect(v.estimated_arrival).toBe('18:00')
    expect(v.special_requests).toBe('Piso alto')
    const q = new URLSearchParams({ booking: RESERVA.id, token: 'tok-abc' }).toString()
    expect(v.manage_url).toContain(`/h/palma/confirm?${q}`)
    expect(v.receipt_url).toBe(`https://app.test/api/public/reservations/${RESERVA.id}/receipt.pdf?${new URLSearchParams({ token: 'tok-abc' })}`)
    expect(v.hotel_logo_url).toBe('https://app.test/uploads/logo.png')
    expect(v.logo_url).toBe(v.hotel_logo_url)
    expect(v.platform_name).toBe('SolmiOS')
    expect(v.rooms_lines).toBe('')
    expect(v.rooms_count).toBe('1')
  })

  it('(a ter) un upsell por persona y noche muestra personas × noches; per_night sólo noches', async () => {
    const h = harness({
      reserva: { ...RESERVA_270, priceBreakdown: { ...RESERVA_270.priceBreakdown, upsells: [
        { id: 'u1', name: 'Desayuno', kind: 'per_person_per_night', unitPrice: 10, quantity: 1, nights: 3, persons: 2, total: 60 },
        { id: 'u2', name: 'Parking', kind: 'per_night', unitPrice: 15, quantity: 1, nights: 3, total: 45 },
        { id: 'u3', name: 'Transfer', kind: 'per_stay', unitPrice: 30, quantity: 1, nights: 1, total: 30 },
      ] } },
    })
    await h.run()
    const v = h.sent[0].variables
    expect(v.extras_lines).toContain('Desayuno × 2 personas × 3 noches = 60.00 USD')
    expect(v.extras_lines).toContain('Parking × 3 noches = 45.00 USD')
    expect(v.extras_lines).toContain('Transfer × 1 = 30.00 USD')
  })

  it('(a bis) platform_name sale de la configuración de plataforma y los valores se escapan', async () => {
    const h = harness({
      reserva: { ...RESERVA_270, specialRequests: '<b>x</b>', priceBreakdown: { ...RESERVA_270.priceBreakdown, upsells: [{ id: 'u1', name: '<i>Spa</i>', kind: 'per_stay', unitPrice: 5, quantity: 1, nights: 1, total: 5 }] } },
      configRow: { value: JSON.stringify({ platformName: 'HotelSoft' }) },
    })
    await h.run()
    const v = h.sent[0].variables
    expect(v.platform_name).toBe('HotelSoft')
    expect(v.extras_lines).toContain('&lt;i&gt;Spa&lt;/i&gt;')
    expect(v.manage_url).toBe('')   // sin publicUrl ni slug no hay link
    expect(v.hotel_logo_url).toBe('')
  })

  it('sin datos nuevos las variables igual existen (vacías o con "—")', async () => {
    const h = harness(); await h.run()
    const v = h.sent[0].variables
    expect(v.extras_lines).toBe('')
    expect(v.tax_lines).toBe('')
    expect(v.promo_code).toBe('')
    expect(v.promo_discount).toBe('—')
    expect(v.crib).toBe('No')
    expect(v.estimated_arrival).toBe('—')
    expect(v.special_requests).toBe('—')
    expect(v.total_amount).toBe('76.70 USD')   // sin priceBreakdown cae a totalAmount
  })

  it('(b) grupo: total del grupo (Σ hermanas vivas, #276) y una línea por habitación SIN el número', async () => {
    // `settle()` prorratea el depósito: cada hermana lleva su parte, la líder NO lleva los 900.
    const leader = { ...RESERVA_270, groupId: 'g1', roomId: 'r1', totalAmount: 300, deposit: 300, priceBreakdown: { ...RESERVA_270.priceBreakdown, total: 900 } }
    const siblings = [
      { ...leader, createdAt: '2026-09-01T10:00:00Z' },
      { ...RESERVA, id: 'sib-2', groupId: 'g1', roomId: 'r2', totalAmount: 300, deposit: 300, adults: 2, children: 0, createdAt: '2026-09-01T10:00:01Z' },
      { ...RESERVA, id: 'sib-3', groupId: 'g1', roomId: 'r3', totalAmount: 300, deposit: 300, adults: 1, children: 2, createdAt: '2026-09-01T10:00:02Z' },
      // Cancelada: ni suma al total ni aparece como línea.
      { ...RESERVA, id: 'sib-4', groupId: 'g1', roomId: 'r4', status: 'cancelled', totalAmount: 500, deposit: 0, createdAt: '2026-09-01T10:00:03Z' },
    ]
    const rooms = {
      r1: { id: 'r1', number: '101', type: 'Doble' },
      r2: { id: 'r2', number: '102', type: 'Doble', name: 'Doble vista mar' },
      r3: { id: 'r3', number: '201', type: 'Suite' },
      r4: { id: 'r4', number: '301', type: 'Penthouse' },
    }
    const h = harness({ reserva: leader, siblings, rooms })
    expect(await h.run()).toBe(true)
    const v = h.sent[0].variables
    expect(v.total_amount).toBe('900.00 USD')
    expect(v.deposit_amount).toBe('900.00 USD')
    expect(v.pending_amount).toBe('—')
    expect(v.rooms_lines).not.toContain('Penthouse')
    expect(v.rooms_count).toBe('3')
    expect((v.rooms_lines.match(/<li>/g) ?? []).length).toBe(3)
    expect(v.rooms_lines).toContain('Doble')
    expect(v.rooms_lines).toContain('Doble vista mar')
    expect(v.rooms_lines).toContain('Suite')
    expect(v.rooms_lines).toContain('300.00 USD')
    for (const n of ['101', '102', '201', '301']) expect(v.rooms_lines).not.toContain(n)
  })

  it('(c) si el envío falla avisa al hotel con una notificación system y devuelve false', async () => {
    const h = harness({ enqueue: async () => { throw new Error('smtp down') } })
    expect(await h.run()).toBe(false)
    expect(h.notifications).toHaveLength(1)
    const n = h.notifications[0]
    expect(n.type).toBe('system')
    expect(n.hotelId).toBe(RESERVA.hotelId)
    expect(n.userId).toBeUndefined()   // broadcast a todo el hotel
    expect(n.title).toContain('huesped@example.com')
    expect(n.message).toContain('smtp down')
    expect(n.metadata.reservationId).toBe(RESERVA.id)
    expect(n.metadata.link).toBe(`/reservas/${RESERVA.id}`)
    expect(typeof n.id).toBe('string')
  })

  it('(d) el recibo PDF viaja como marcador DIFERIDO: el worker de la cola lo genera, no este usecase', async () => {
    const h = harness({ attachReceipt: true })
    expect(await h.run()).toBe(true)
    // Sin base64 ni Buffer: acá no se lanza Chromium (el webhook de Stripe espera este await).
    expect(h.sent[0].attachments).toEqual([{
      kind: 'receipt',
      reservationId: RESERVA.id,
      filename: `recibo-${RESERVA.id.slice(0, 8)}.pdf`,
    }])
  })

  it('sin attachReceipt (deps mínimos) no hay adjunto', async () => {
    const h = harness(); await h.run()
    expect(h.sent[0].attachments).toBeUndefined()
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

// La plantilla es la otra mitad del contrato: aunque el usecase no mande el número de
// habitación, si la plantilla lo pide igual renderiza la fila (vacía o con basura).
describe('plantilla reservation_confirmed', () => {
  const langs: string[] = ['es', 'en', 'pt']
  const bodyOf = (lang: unknown): string =>
    (NOTIFICATION_DEFAULTS as any).reservation_confirmed[String(lang)].body as string

  it.each(langs)('%s: no pide datos de la habitación', (lang) => {
    const body = bodyOf(lang)
    expect(body).not.toContain('{room_number}')
    expect(body).not.toContain('{room_type}')
    expect(body).not.toContain('{room_capacity}')
    expect(body).not.toContain('{room_base_price}')
    expect(body).not.toContain('{lock_code}')
  })

  it.each(langs)('%s: muestra las horas de entrada y salida', (lang) => {
    const body = bodyOf(lang)
    expect(body).toContain('{checkin_time}')
    expect(body).toContain('{checkout_time}')
  })

  it.each(langs)('%s: lleva política de cancelación y datos del hotel', (lang) => {
    const body = bodyOf(lang)
    expect(body).toContain('{cancellation_policy}')
    expect(body).toContain('{hotel_address}')
    expect(body).toContain('{hotel_email}')
  })

  it('toda variable de la plantilla la provee el usecase (los 3 idiomas)', async () => {
    const h = harness(); await h.run()
    const provided = new Set(Object.keys(h.sent[0].variables))
    for (const lang of langs) {
      const body = bodyOf(lang)
      const used = [...body.matchAll(/\{(\w+)\}/g)].map(m => m[1])
      const missing = used.filter(v => !provided.has(v))
      expect({ lang, missing }).toEqual({ lang, missing: [] })
    }
  })
})
