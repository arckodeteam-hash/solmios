// bookingengine/tests/public-reservation-receipt.test.ts — #270 (MR-05)
//
// Cubre `GET /api/public/reservations/:id/receipt.pdf?token=X` (usecase `getPublicReceiptPdf`):
// - Sin token → 404 (anti-enumeración).
// - Token incorrecto → 404 con EXACTAMENTE el mismo body que sin token y que reserva inexistente.
// - Token válido → 200 `application/pdf`, y el documento (toPdf stub = el HTML tal cual) lleva
//   localizador, hotel + RNC, huésped, cada línea del desglose (alojamiento, upsell, amenidad,
//   promo, cada impuesto), total, referencia de Stripe y la leyenda "no es factura fiscal".
// - Grupo: líder con groupId + 2 hermanas → 3 líneas de habitación y el total del grupo.
// - `buildReceiptHtmlFor` (sin token, para el correo) devuelve el HTML o null.
//
// Mismo doble de ORM que public-reservation.test.ts: `findMany` filtrando en memoria.
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getPublicReceiptPdf, buildReceiptHtmlFor } from '../usecases/public-receipt'
import { getPublicReservation } from '../usecases/public-reservation'
import { buildReceiptLines, renderReceiptHtml } from '../../../shared/usecases/payment-receipt'

const VALID_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const BREAKDOWN = {
  subtotal: 330, // 250 alojamiento + 50 upsell + 30 amenidad
  promoDiscount: 33,
  upsellsTotal: 50,
  // MR-10 (#275): `upsells[]` cotizados por `kind` — el recibo lee esta forma, no un `price × qty` plano.
  upsells: [{ id: 'u1', name: 'Desayuno buffet', kind: 'per_person', unitPrice: 25, quantity: 2, nights: 1, total: 50 }],
  childAmenitiesTotal: 30,
  roomAmenitiesTotal: 0,
  taxes: 83.16, // 18% + 10% sobre 297
  taxBreakdown: [
    { name: 'ITBIS', rate: 18, amount: 53.46 },
    { name: 'Propina legal', rate: 10, amount: 29.7 },
  ],
  total: 380.16,
}

function baseReservation(over: Record<string, unknown> = {}) {
  return {
    id: 'res-12345678-abcd', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
    accessToken: VALID_TOKEN,
    status: 'confirmed', checkIn: '2026-10-10', checkOut: '2026-10-12',
    adults: 2, children: 1, childrenAges: [6], needsCrib: true, cribCount: 1,
    totalAmount: 380.16, currency: 'USD', paymentMethod: 'card', promoCode: 'VERANO10',
    priceBreakdown: BREAKDOWN,
    childAmenities: [{ id: 'ca1', name: 'Silla alta', price: 30, quantity: 1, total: 30 }],
    roomAmenities: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    ...over,
  }
}

function makeOrm(opts: { reservations?: any[]; payments?: any[]; rooms?: any[]; hotel?: any } = {}) {
  const reservations = opts.reservations ?? [baseReservation()]
  const hotel = opts.hotel ?? {
    id: 'h1', name: 'Hotel Sol & Mar', address: 'Calle 1 #23', municipality: 'Puerto Plata', country: 'DO',
    phone: '+1 809 555 0100', email: 'info@solymar.test', ownerTaxId: '1-31-12345-6', logo: 'https://cdn.test/logo.png',
  }
  const guest = { id: 'g1', hotelId: 'h1', name: 'Ana <Pérez>', email: 'ana@example.com', phone: '+1 809 555 0199' }
  const rooms = opts.rooms ?? [{ id: 'r1', hotelId: 'h1', number: '101', name: 'Vista Mar', type: 'double' }]
  const payments = opts.payments ?? [
    { id: 'p1', hotelId: 'h1', reservationId: reservations[0].id, method: 'card', amount: 380.16, status: 'completed', reference: 'cs_test_123', createdAt: '2026-09-01T10:05:00.000Z' },
  ]
  const calls: string[] = []
  const orm: any = {
    findMany: async (model: string, query: any) => {
      calls.push(model)
      const matches = (row: any) => Object.entries(query ?? {}).every(([k, v]) => row[k] === v)
      if (model === 'Reservations') return reservations.filter(matches)
      if (model === 'Hotels') return [hotel].filter(matches)
      if (model === 'Guests') return [guest].filter(matches)
      if (model === 'Rooms') return rooms.filter(matches)
      if (model === 'Payment') return payments.filter(matches)
      return []
    },
  }
  return { orm, reservations, hotel, guest, rooms, payments, calls }
}

const deps = { toPdf: async (html: string) => Buffer.from(html), platformName: 'SolmiOS' }

describe('getPublicReceiptPdf — recibo de pago público (#270)', () => {
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  it('sin token → 404 y no genera PDF', async () => {
    const { orm, reservations } = makeOrm()
    let pdfCalls = 0
    const res = await getPublicReceiptPdf(orm, reservations[0].id, undefined, { toPdf: async (h) => { pdfCalls++; return Buffer.from(h) } })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
    expect(pdfCalls).toBe(0)
  })

  it('token inválido → 404 con el MISMO body que sin token, que reserva inexistente y que GET /reservations/:id', async () => {
    const { orm, reservations } = makeOrm()
    const noToken = await getPublicReceiptPdf(orm, reservations[0].id, undefined, deps)
    const badToken = await getPublicReceiptPdf(orm, reservations[0].id, 'wrong-token', deps)
    const missing = await getPublicReceiptPdf(orm, 'no-such-id', VALID_TOKEN, deps)
    const sibling = await getPublicReservation(orm, reservations[0].id, 'wrong-token')
    expect(badToken.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(badToken.body).toEqual(noToken.body)
    expect(missing.body).toEqual(noToken.body)
    expect(sibling.body).toEqual(noToken.body)
    expect(badToken.headers).toBeUndefined()
  })

  it('accessToken null (reserva creada desde el panel) → 404 mismo body', async () => {
    const { orm, reservations } = makeOrm({ reservations: [baseReservation({ accessToken: null })] })
    const res = await getPublicReceiptPdf(orm, reservations[0].id, VALID_TOKEN, deps)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('token válido → 200 application/pdf con el recibo completo', async () => {
    const { orm, reservations } = makeOrm()
    const res = await getPublicReceiptPdf(orm, reservations[0].id, VALID_TOKEN, deps)
    expect(res.status).toBe(200)
    expect(res.headers?.['content-type']).toBe('application/pdf')
    expect(res.headers?.['content-disposition']).toBe('inline; filename="recibo-res-1234.pdf"')
    expect(Buffer.isBuffer(res.body)).toBe(true)

    const html = res.body.toString()
    // Cabecera y leyenda.
    expect(html).toContain('RECIBO DE PAGO')
    expect(html).toContain('no es factura fiscal')
    expect(html).toContain('@page { size: A4')
    // Localizador = id.slice(0, 8).
    expect(html).toContain('Localizador res-1234')
    // Hotel: nombre (escapado), RNC, dirección, teléfono, email, logo http(s).
    expect(html).toContain('Hotel Sol &amp; Mar')
    expect(html).toContain('RNC/NIF: 1-31-12345-6')
    expect(html).toContain('Calle 1 #23, Puerto Plata, DO')
    expect(html).toContain('+1 809 555 0100')
    expect(html).toContain('info@solymar.test')
    expect(html).toContain('<img src="https://cdn.test/logo.png"')
    // Huésped escapado (nunca HTML crudo).
    expect(html).toContain('Ana &lt;Pérez&gt;')
    expect(html).not.toContain('Ana <Pérez>')
    expect(html).toContain('ana@example.com')
    // Fechas, noches y huéspedes.
    expect(html).toContain('2 noches')
    expect(html).toContain('2 adultos · 1 niño (6 años) · cuna solicitada')
    // Líneas del desglose.
    expect(html).toContain('Alojamiento · Vista Mar · Doble')
    // Sin número de habitación: puede reasignarse hasta la víspera (mismo criterio que el correo).
    expect(html).not.toContain('(101)')
    expect(html).toContain('250.00 USD')
    expect(html).toContain('Desayuno buffet')
    expect(html).toContain('50.00 USD')
    expect(html).toContain('Silla alta')
    expect(html).toContain('30.00 USD')
    expect(html).toContain('Descuento promo (VERANO10)')
    expect(html).toContain('-33.00 USD')
    expect(html).toContain('Subtotal</span><span>330.00 USD')
    // Impuestos uno por uno con nombre y %.
    expect(html).toContain('ITBIS (18%)')

    expect(html).toContain('53.46 USD')
    expect(html).toContain('Propina legal (10%)')
    expect(html).toContain('29.70 USD')
    // Total.
    expect(html).toContain('TOTAL</span><span>380.16 USD')
    // Pago: método, referencia de Stripe, emisión y pie.
    expect(html).toContain('Método: Tarjeta')
    expect(html).toContain('Referencia: cs_test_123')
    expect(html).toContain('Emitido:')
    expect(html).toContain('Emitido a través de SolmiOS')
  })

  it('sin pago registrado → referencia "—" y método de la reserva', async () => {
    const { orm, reservations } = makeOrm({ payments: [] })
    const res = await getPublicReceiptPdf(orm, reservations[0].id, VALID_TOKEN, deps)
    expect(res.status).toBe(200)
    const html = res.body.toString()
    expect(html).toContain('Referencia: —')
    expect(html).toContain('Método: Tarjeta')
  })

  it('logo que no es URL http(s) no se inyecta', async () => {
    const { orm, reservations } = makeOrm({ hotel: { id: 'h1', name: 'Hotel X', logo: 'javascript:alert(1)' } })
    const res = await getPublicReceiptPdf(orm, reservations[0].id, VALID_TOKEN, deps)
    expect(res.body.toString()).not.toContain('<img')
    expect(res.body.toString()).not.toContain('RNC/NIF')
  })

  it('grupo: líder + 2 hermanas → 3 líneas de habitación y el total del grupo', async () => {
    const groupBreakdown = {
      subtotal: 600, promoDiscount: 0, upsellsTotal: 0, upsells: [],
      childAmenitiesTotal: 0, roomAmenitiesTotal: 0,
      taxes: 108, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 108 }], total: 708,
    }
    const lead = baseReservation({
      id: 'lead-0001-xxxx', groupId: 'grp-1', roomId: 'r1', totalAmount: 200, promoCode: undefined,
      priceBreakdown: groupBreakdown, childAmenities: [], createdAt: '2026-09-01T10:00:00.000Z',
    })
    const sis1 = baseReservation({
      id: 'sis-0001', groupId: 'grp-1', roomId: 'r2', totalAmount: 200, priceBreakdown: undefined,
      childAmenities: [], children: 0, childrenAges: [], needsCrib: false, cribCount: 0, createdAt: '2026-09-01T10:00:01.000Z',
    })
    const sis2 = baseReservation({
      id: 'sis-0002', groupId: 'grp-1', roomId: 'r3', totalAmount: 200, priceBreakdown: undefined,
      childAmenities: [], children: 0, childrenAges: [], needsCrib: false, cribCount: 0, createdAt: '2026-09-01T10:00:02.000Z',
    })
    const rooms = [
      { id: 'r1', hotelId: 'h1', number: '101', type: 'double' },
      { id: 'r2', hotelId: 'h1', number: '102', type: 'double' },
      { id: 'r3', hotelId: 'h1', number: '201', type: 'suite' },
    ]
    const { orm } = makeOrm({
      reservations: [lead, sis1, sis2], rooms,
      payments: [{ id: 'p1', hotelId: 'h1', reservationId: lead.id, method: 'card', amount: 708, status: 'completed', reference: 'cs_group_1' }],
    })
    const res = await getPublicReceiptPdf(orm, lead.id, VALID_TOKEN, deps)
    expect(res.status).toBe(200)
    const html = res.body.toString()
    expect(html.match(/Alojamiento · /g)?.length).toBe(3)
    expect(html.match(/Alojamiento · Doble/g)?.length).toBe(2)
    expect(html).toContain('Alojamiento · Suite')
    expect(html).not.toMatch(/Hab\. (101|102|201)/)
    expect(html).toContain('3 habitaciones')
    expect(html).toContain('6 adultos')
    expect(html).toContain('Subtotal</span><span>600.00 USD')
    expect(html).toContain('TOTAL</span><span>708.00 USD')
    expect(html).toContain('Referencia: cs_group_1')

    const lines = buildReceiptLines(lead, [lead, sis1, sis2], rooms)
    expect(lines.filter((l) => l.kind === 'room').map((l) => l.amount)).toEqual([200, 200, 200])
    expect(lines.find((l) => l.kind === 'total')?.amount).toBe(708)

    // Las hermanas comparten el accessToken: pedir el recibo con el id de una hermana devuelve
    // el MISMO recibo del grupo (localizador de la líder, total 708), no uno con 3 habitaciones
    // y el total de una sola.
    const viaSibling = await getPublicReceiptPdf(orm, sis2.id, VALID_TOKEN, deps)
    expect(viaSibling.status).toBe(200)
    const html2 = viaSibling.body.toString()
    expect(html2).toContain('TOTAL</span><span>708.00 USD')
    expect(html2).toContain('ITBIS (18%)')
    expect(html2).toContain(`Localizador ${lead.id.slice(0, 8)}`)
    expect(html2.match(/Alojamiento · /g)?.length).toBe(3)
  })

  it('buildReceiptHtmlFor (sin token, para el correo) devuelve el HTML o null', async () => {
    const { orm, reservations } = makeOrm()
    const html = await buildReceiptHtmlFor(orm, reservations[0].id, 'SolmiOS')
    expect(html).toContain('Localizador res-1234')
    expect(html).toContain('cs_test_123')
    expect(await buildReceiptHtmlFor(orm, 'nope')).toBeNull()
  })
})

describe('buildReceiptLines / renderReceiptHtml (puros)', () => {
  it('1 habitación: alojamiento = subtotal − upsells − amenidades; promo negativa; impuestos; total', () => {
    const lines = buildReceiptLines(baseReservation())
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([
      ['room', 250], ['upsell', 50], ['child_amenity', 30], ['discount', -33],
      ['tax', 53.46], ['tax', 29.7], ['total', 380.16],
    ])
    const upsell = lines.find((l) => l.kind === 'upsell')!
    expect(upsell).toMatchObject({ description: 'Desayuno buffet', quantity: 2, unitPrice: 25 })
  })

  it('upsell por persona y noche: cantidad = personas × noches (cuadra con el unitario) y el detalle va en la descripción', () => {
    const lines = buildReceiptLines(baseReservation({ priceBreakdown: { ...BREAKDOWN, upsells: [
      { id: 'u1', name: 'Desayuno', kind: 'per_person_per_night', unitPrice: 10, quantity: 1, nights: 3, persons: 2, total: 60 },
      { id: 'u2', name: 'Parking', kind: 'per_night', unitPrice: 15, quantity: 1, nights: 3, total: 45 },
    ] } }))
    const upsells = lines.filter((l) => l.kind === 'upsell')
    expect(upsells[0]).toEqual({ kind: 'upsell', description: 'Desayuno · 2 personas × 3 noches', quantity: 6, unitPrice: 10, amount: 60 })
    expect(upsells[1]).toEqual({ kind: 'upsell', description: 'Parking · 3 noches', quantity: 3, unitPrice: 15, amount: 45 })
    for (const u of upsells) expect(u.quantity! * u.unitPrice!).toBe(u.amount)
    expect(lines.find((l) => l.kind === 'discount')?.description).toBe('Descuento promo (VERANO10)')
    expect(lines.filter((l) => l.kind === 'tax').map((l) => l.rate)).toEqual([18, 10])
  })

  it('sin priceBreakdown (reserva vieja) → alojamiento = totalAmount, sin impuestos', () => {
    const lines = buildReceiptLines({ roomId: 'r1', totalAmount: 120, priceBreakdown: null })
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([['room', 120], ['total', 120]])
  })

  it('renderReceiptHtml escapa todo lo que viene de datos', () => {
    const html = renderReceiptHtml({
      locator: '<x>', issuedAt: '2026-09-12T00:00:00.000Z', currency: 'USD',
      hotel: { name: '<script>', taxId: '"rnc"' }, guest: { name: '<b>g</b>' },
      stay: { checkIn: '2026-10-10', checkOut: '2026-10-11', nights: 1, adults: 1, children: 0, needsCrib: false, rooms: 1 },
      lines: [{ kind: 'room', description: '<i>hab</i>', amount: 10 }, { kind: 'tax', description: '<t>', rate: 18, amount: 1.8 }, { kind: 'tax', description: 'Tasa municipal', rate: 0.5, amount: 0.05 }, { kind: 'total', description: 'Total', amount: 11.85 }],
      payment: { method: '<m>', reference: '<r>' },
    })
    for (const raw of ['<x>', '<script>', '"rnc"', '<b>g</b>', '<i>hab</i>', '<t>', '<m>', '<r>']) expect(html).not.toContain(raw)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;t&gt; (18%)')
    // rate es porcentaje siempre: 0.5 → "0.5%", nunca "50%".
    expect(html).toContain('Tasa municipal (0.5%)')
    expect(html).toContain('TOTAL</span><span>11.85 USD')
  })
})
