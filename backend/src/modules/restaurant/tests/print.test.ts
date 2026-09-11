// restaurant/tests/print.test.ts — #216 (REST-14): precuenta, ticket y comanda de cocina en 80 mm.
//
// Dos capas:
//  1. Render PURO (usecases/print-templates.ts) con datos fijos: cada papel trae mesa, líneas, totales,
//     desglose de impuesto por nombre (configuration('taxes')), propina sugerida, "no es comprobante
//     fiscal"; la comanda de cocina NO trae precios ni cabeceras de combo; el CSS es de 80 mm.
//  2. Usecase (usecases/print.ts) sobre repos en memoria: filtra las líneas anuladas de los tres
//     papeles, la cocina solo imprime lo confirmado (`sentAt`) y por estación — y por defecto solo lo de
//     ESTE envío (`batch=last`) —, el ticket exige comanda cobrada y lee el pago por puerto o las partes
//     (#214) de `restaurant_order_payments`, y una comanda de OTRO hotel es 403 (IDOR) — nada se renderiza.
//  3. Descuentos (#215): fila por línea y de la comanda con motivo, Σ líneas netas − desc. comanda =
//     Subtotal, e impuesto prorrateado sobre el neto que cuadra con `order.tax` (computeOrderTotals).
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { ForbiddenError } from 'arckode-framework'
import { renderPrecuenta, renderTicket, renderKitchen, taxBreakdown, lineNet, discountLabel, type PrintOrderData, type PrintLine } from '../usecases/print-templates'
import { printOrder, lastBatch, type PrintDeps } from '../usecases/print'
import { computeOrderTotals } from '../usecases/order-totals'
import { round2 } from '../../../shared/utils/money'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser, OrderPaymentDTO } from '../types'

// ─── Datos fijos del render ───
const fixed = (extra: Partial<PrintOrderData> = {}): PrintOrderData => ({
  hotel: { name: 'Hotel Sol & Mar', address: 'Av. Malecón 123', phone: '809-555-0000', taxId: '1-31-12345-6', currency: 'DOP', timezone: 'America/Santo_Domingo' },
  order: { number: 'CMD-2026-0007', type: 'dine_in', status: 'sent', openedAt: '2026-09-11T18:30:00.000Z', covers: 3, subtotal: 650, tax: 117, tip: 0, total: 767 },
  place: 'Terraza · Mesa 3',
  waiter: 'Carlos Mendoza',
  lines: [
    { name: 'Pizza Margarita', quantity: 2, unitPrice: 250, lineTotal: 550, taxRate: 18, notes: 'sin cebolla', modifiers: [{ name: 'Grande', priceDelta: 25 }], kind: 'item', stationId: 's1', stationName: 'Cocina', sentAt: '2026-09-11T18:35:00.000Z' },
    { name: 'Agua', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, modifiers: [], kind: 'item', stationId: 's2', stationName: 'Bar', sentAt: '2026-09-11T18:35:00.000Z' },
  ],
  taxes: [{ name: 'ITBIS', rate: 18 }],
  tipSuggestions: [10, 15, 20],
  payments: [],
  printedAt: '2026-09-11T19:00:00.000Z',
  ...extra,
})

describe('#216 — render 80 mm con datos fijos', () => {
  it('precuenta: hotel (nombre/dirección/RNC), mesa, líneas con cantidad y modificador, subtotal, impuesto por nombre, total, propina sugerida y "no es comprobante fiscal"', () => {
    const html = renderPrecuenta(fixed())
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('@page { size: 80mm auto')
    expect(html).toContain('PRECUENTA')
    expect(html).toContain('Hotel Sol &amp; Mar')          // escapado
    expect(html).toContain('Av. Malecón 123')
    expect(html).toContain('RNC 1-31-12345-6')
    expect(html).toContain('CMD-2026-0007')
    expect(html).toContain('Terraza · Mesa 3')
    expect(html).toContain('Carlos Mendoza')
    expect(html).toContain('2× Pizza Margarita')
    expect(html).toContain('Grande (+RD$25.00)')
    expect(html).toContain('sin cebolla')
    expect(html).toContain('RD$650.00')                     // subtotal
    expect(html).toContain('ITBIS 18%')                      // impuesto por nombre desde configuration('taxes')
    expect(html).toContain('RD$117.00')
    expect(html).toContain('RD$767.00')                     // total
    expect(html).toContain('Propina sugerida')
    expect(html).toContain('10% → propina RD$65.00')
    expect(html).toContain('total RD$832.00')
    expect(html).toContain('No es comprobante fiscal')
    expect(html).not.toContain('Propina</span>')            // sin propina fijada, no se lista
  })

  it('precuenta con propina ya fijada (comanda billed): el total NO la incluye — se sugiere aparte', () => {
    const html = renderPrecuenta(fixed({ order: { ...fixed().order, status: 'billed', tip: 100, total: 867 } }))
    expect(html).toContain('<span class="n">TOTAL</span><span class="a">RD$767.00</span>')
    expect(html).not.toContain('RD$867.00')
    expect(html).not.toContain('Propina</span>')
  })

  it('ticket: método de pago, monto, referencia, propina y cambio si hubo entrega en efectivo', () => {
    const html = renderTicket(fixed({
      order: { ...fixed().order, status: 'paid', tip: 50, total: 817 },
      payments: [{ method: 'cash', amount: 817, reference: 'AB12CD34', at: '2026-09-11T19:10:00.000Z', tendered: 1000 }],
    }))
    expect(html).toContain('TICKET')
    expect(html).toContain('Efectivo')
    expect(html).toContain('RD$817.00')
    expect(html).toContain('AB12CD34')
    expect(html).toContain('Propina')
    expect(html).toContain('RD$50.00')
    expect(html).toContain('Recibido')
    expect(html).toContain('RD$1000.00')
    expect(html).toContain('Cambio')
    expect(html).toContain('RD$183.00')
    expect(html).toContain('No es comprobante fiscal')
  })

  it('ticket de un cargo a la habitación dice que fue a la habitación', () => {
    const html = renderTicket(fixed({ order: { ...fixed().order, status: 'charged' }, place: 'Hab. 204 · Pérez', payments: [{ method: 'folio', amount: 767 }] }))
    expect(html).toContain('Cargo a la habitación')
    expect(html).toContain('Hab. 204 · Pérez')
  })

  // ─── #215: descuentos y cortesías en precuenta y ticket ───
  const discounted = (): PrintOrderData => {
    // Pizza 100 con 10 % de línea (−10) · Postre 100 cortesía (−100) · Vino 200 (tasa 10 %) · descuento de comanda 10 % sobre 290 (−29)
    const lines: PrintLine[] = [
      { name: 'Pizza', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, modifiers: [], kind: 'item', discountType: 'percent', discountValue: 10, discountAmount: 10, discountReason: 'Plato con demora' },
      { name: 'Postre', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, modifiers: [], kind: 'item', discountType: 'percent', discountValue: 100, discountAmount: 100, discountReason: 'Cortesía de la casa' },
      { name: 'Vino', quantity: 1, unitPrice: 200, lineTotal: 200, taxRate: 10, modifiers: [], kind: 'item' },
    ]
    const t = computeOrderTotals(lines.map((l, i) => ({ id: `l${i}`, ...l })), { tip: 0, discountType: 'percent', discountValue: 10 })
    return fixed({
      lines,
      taxes: [{ name: 'ITBIS', rate: 18 }, { name: 'Bebidas', rate: 10 }],
      order: { ...fixed().order, subtotal: t.subtotal, tax: t.tax, total: t.total, discountType: 'percent', discountValue: 10, discountAmount: t.discountAmount, discountReason: 'Huésped del hotel', discountTotal: t.discountTotal },
    })
  }

  it('#215 precuenta con descuentos: fila "Descuento/Cortesía (motivo)" bajo cada línea, fila del descuento de comanda con motivo y total de descuentos', () => {
    const d = discounted()
    const html = renderPrecuenta(d)
    expect(html).toContain('<span class="n">Descuento 10% (Plato con demora)</span><span class="a">−RD$10.00</span>')
    expect(html).toContain('<span class="n">Cortesía (Cortesía de la casa)</span><span class="a">−RD$100.00</span>')
    // Σ netas = 90 + 0 + 200 = 290 → 10 % de comanda = 29 → Subtotal 261; descuentos = 10 + 100 + 29 = 139.
    expect(html).toContain('<span class="n">Descuento 10% (Huésped del hotel)</span><span class="a">−RD$29.00</span>')
    expect(html).toContain('Descuentos y cortesías aplicados</span><span class="a">−RD$139.00</span>')
    expect(html).toContain('<span class="n">Subtotal</span><span class="a">RD$261.00</span>')
    // El Vino no tiene descuento propio: no lleva fila.
    expect(html.split('1× Vino')[1].split('<div class="hr">')[0]).not.toContain('class="row disc"')
  })

  it('#215 la suma de las líneas cuadra con el Subtotal: Σ(bruto − desc. línea) − desc. comanda = subtotal persistido', () => {
    const d = discounted()
    const netSum = round2(d.lines.reduce((s, l) => s + lineNet(l), 0) - Number(d.order.discountAmount))
    expect(netSum).toBe(d.order.subtotal)
    expect(d.order.subtotal).toBe(261)   // (100 − 10) + (100 − 100) + 200 = 290; − 29 de comanda
    expect(d.order.discountTotal).toBe(139)
  })

  it('#215 el desglose por tasa se prorratea sobre el NETO con descuento y su suma cuadra con order.tax', () => {
    const d = discounted()
    const rows = taxBreakdown(d.lines, d.taxes, Number(d.order.discountAmount))
    expect(rows.map((r) => r.label)).toEqual(['Bebidas 10%', 'ITBIS 18%'])
    expect(round2(rows.reduce((s, r) => s + r.amount, 0))).toBe(d.order.tax)
    const html = renderTicket({ ...d, order: { ...d.order, status: 'paid' }, payments: [{ method: 'cash', amount: d.order.total }] })
    for (const r of rows) expect(html).toContain(`<span class="n">${r.label}</span><span class="a">RD$${r.amount.toFixed(2)}</span>`)
    // Sin descuento de comanda el prorrateo es 1:1 con el neto de línea (no se rompe el caso simple).
    expect(taxBreakdown(fixed().lines, [{ name: 'ITBIS', rate: 18 }])).toEqual([{ label: 'ITBIS 18%', amount: 117 }])
  })

  it('discountLabel: cortesía = percent 100; porcentaje con su tasa; monto fijo = "Descuento"; motivo entre paréntesis', () => {
    expect(discountLabel({ discountType: 'percent', discountValue: 100, discountReason: 'Cortesía de la casa' })).toBe('Cortesía (Cortesía de la casa)')
    expect(discountLabel({ discountType: 'percent', discountValue: 12.5 })).toBe('Descuento 12.5%')
    expect(discountLabel({ discountType: 'amount', discountValue: 50, discountReason: ' Promoción ' })).toBe('Descuento (Promoción)')
  })

  // ─── #214: ticket con pagos divididos ───
  it('#214 ticket con 50 % efectivo / 50 % tarjeta muestra AMBAS partes (método, monto, referencia), la propina de cada una, el cambio del efectivo y el total pagado', () => {
    const html = renderTicket(fixed({
      order: { ...fixed().order, status: 'paid', tip: 30, total: 797 },
      payments: [
        { method: 'cash', amount: 383.5, tip: 10, reference: 'CASH0001', at: '2026-09-11T19:10:00.000Z', tendered: 400 },
        { method: 'card', amount: 383.5, tip: 20, reference: 'CARD0002', at: '2026-09-11T19:12:00.000Z' },
      ],
    }))
    expect(html).toContain('<span class="n">Pago 1/2 · Efectivo</span><span class="a">RD$393.50</span>')
    expect(html).toContain('<span class="n">Pago 2/2 · Tarjeta</span><span class="a">RD$403.50</span>')
    expect(html).toContain('CASH0001')
    expect(html).toContain('CARD0002')
    expect(html).toContain('<span class="n">incl. propina</span><span class="a">RD$10.00</span>')
    expect(html).toContain('<span class="n">incl. propina</span><span class="a">RD$20.00</span>')
    expect(html).toContain('<span class="n">Recibido</span><span class="a">RD$400.00</span>')
    expect(html).toContain('<span class="n">Cambio</span><span class="a">RD$6.50</span>')     // 400 − (383.50 + 10)
    expect(html).toContain('<span class="n">Total pagado</span><span class="a">RD$797.00</span>')
    expect(html).toContain('<span class="n">TOTAL</span><span class="a">RD$797.00</span>')
    expect(html).toContain('<span class="n">Propina</span><span class="a">RD$30.00</span>')
  })

  it('comanda de cocina: mesa/zona, comensales, hora de envío, platos con notas y modificadores por estación — SIN precios ni cabecera de combo', () => {
    const html = renderKitchen(fixed({
      lines: [
        ...fixed().lines,
        { name: 'Combo Familiar', quantity: 1, unitPrice: 300, lineTotal: 300, taxRate: 18, modifiers: [], kind: 'combo_header', sentAt: '2026-09-11T18:35:00.000Z' },
        { name: 'Papas', quantity: 2, unitPrice: 0, lineTotal: 0, taxRate: 0, modifiers: [], kind: 'combo_component', stationId: 's1', stationName: 'Cocina', sentAt: '2026-09-11T18:35:00.000Z' },
      ],
    }))
    expect(html).toContain('Terraza · Mesa 3')
    expect(html).toContain('3 cub.')
    expect(html).toContain('14:35')                          // 18:35Z en Santo Domingo
    expect(html).toContain('2× Pizza Margarita')
    expect(html).toContain('Grande')
    expect(html).toContain('sin cebolla')
    expect(html).toContain('2× Papas')                       // el componente sí se prepara
    expect(html).not.toContain('Combo Familiar')             // la cabecera no es un plato
    expect(html).toContain('>Cocina<')                       // agrupado por estación
    expect(html).toContain('>Bar<')
    expect(html).not.toContain('RD$')
    expect(html).not.toContain('Subtotal')
    expect(html).not.toContain('TOTAL')
  })

  it('comanda de cocina de UNA estación: título con la estación, sin separadores de otras', () => {
    const html = renderKitchen(fixed({ station: { id: 's1', name: 'Cocina' }, lines: fixed().lines.filter((l) => l.stationId === 's1') }))
    expect(html).toContain('<div class="c b xl">Cocina</div>')
    expect(html).not.toContain('class="station"')
    expect(html).not.toContain('Agua')
  })

  it('taxBreakdown: una tasa configurada = una fila con su nombre; dos que suman la tasa de la línea = dos filas; ninguna coincide = "Impuesto N%"', () => {
    const lines = fixed().lines
    expect(taxBreakdown(lines, [{ name: 'ITBIS', rate: 18 }])).toEqual([{ label: 'ITBIS 18%', amount: 117 }])
    expect(taxBreakdown(lines, [{ name: 'ITBIS', rate: 16 }, { name: 'Ley 2%', rate: 2 }])).toEqual([{ label: 'ITBIS 16%', amount: 104 }, { label: 'Ley 2% 2%', amount: 13 }])
    expect(taxBreakdown(lines, [{ name: 'IVA', rate: 21 }])).toEqual([{ label: 'Impuesto 18%', amount: 117 }])
    expect(taxBreakdown(lines.map((l) => ({ ...l, taxRate: 0 })), [{ name: 'ITBIS', rate: 18 }])).toEqual([])
  })

  it('escapa HTML del hotel y de las líneas (un nombre con <script> no se ejecuta en la pestaña)', () => {
    const html = renderPrecuenta(fixed({ hotel: { ...fixed().hotel, name: '<b>H</b>' }, lines: [{ ...fixed().lines[0], name: '<script>alert(1)</script>', notes: '"x"' }] }))
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;H&lt;/b&gt;')
    expect(html).toContain('&quot;x&quot;')
  })
})

// ─── Usecase sobre repos en memoria ───
const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new ForbiddenError('Forbidden: resource belongs to another user')
  },
  authenticate: (() => []) as any,
} as unknown as Auth

function backed<T extends object>(rows: any[]): RepositoryAdapter<T> {
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    findMany: async (q: any = {}) => rows.filter((r) => match(r, q)),
    findById: async (id: any) => rows.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => rows.find((r) => match(r, q)) ?? null,
    create: async (d: any) => { rows.push(d); return d }, update: async () => null, delete: async () => true, count: async () => rows.length,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
  } as unknown as RepositoryAdapter<T>
}

const SENT = '2026-09-11T18:35:00.000Z'
function fixture() {
  const orders: any[] = [
    { id: 'o-sent', hotelId: 'h1', number: 'CMD-1', type: 'dine_in', status: 'sent', tableId: 't1', waiterId: 'u-waiter', covers: 2, subtotal: 300, tax: 54, tip: 0, total: 354, openedAt: SENT },
    { id: 'o-paid', hotelId: 'h1', number: 'CMD-2', type: 'takeaway', status: 'paid', settlement: 'payment', paymentId: 'pay-1', subtotal: 100, tax: 18, tip: 20, total: 138, openedAt: SENT, closedAt: SENT },
    { id: 'o-room', hotelId: 'h1', number: 'CMD-3', type: 'room_service', status: 'charged', settlement: 'folio', roomId: 'room-204', guestId: 'g1', subtotal: 100, tax: 18, tip: 0, total: 118, openedAt: SENT, closedAt: SENT },
    { id: 'o-cancel', hotelId: 'h1', number: 'CMD-4', type: 'dine_in', status: 'cancelled', tableId: 't1', subtotal: 0, tax: 0, tip: 0, total: 0 },
    { id: 'o-other', hotelId: 'h2', number: 'CMD-9', type: 'dine_in', status: 'sent', tableId: 't9', subtotal: 50, tax: 9, tip: 0, total: 59 },
    // #214: cobrada por partes (50 % efectivo / 50 % tarjeta); order.tip = Σ propinas de las partes.
    { id: 'o-split', hotelId: 'h1', number: 'CMD-5', type: 'dine_in', status: 'paid', settlement: 'payment', amountPaid: 118, tableId: 't1', subtotal: 100, tax: 18, tip: 5, total: 123, openedAt: SENT, closedAt: SENT },
    // #216: dos envíos a cocina (el segundo solo a Cocina).
    { id: 'o-two', hotelId: 'h1', number: 'CMD-6', type: 'dine_in', status: 'sent', tableId: 't1', subtotal: 300, tax: 54, tip: 0, total: 354, openedAt: SENT },
  ]
  const SENT2 = '2026-09-11T18:50:00.000Z'
  const lines: any[] = [
    { id: 'l1', hotelId: 'h1', orderId: 'o-sent', kind: 'item', name: 'Pizza', quantity: 1, unitPrice: 200, lineTotal: 200, taxRate: 18, status: 'new', stationId: 's1', stationName: 'Cocina', sentAt: SENT, notes: 'sin cebolla' },
    { id: 'l2', hotelId: 'h1', orderId: 'o-sent', kind: 'item', name: 'Cerveza', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, status: 'new', stationId: 's2', stationName: 'Bar', sentAt: SENT },
    { id: 'l3', hotelId: 'h1', orderId: 'o-sent', kind: 'item', name: 'Plato anulado', quantity: 1, unitPrice: 999, lineTotal: 999, taxRate: 18, status: 'voided', voidReason: 'Cliente cambió', stationId: 's1', stationName: 'Cocina', sentAt: SENT },
    { id: 'l4', hotelId: 'h1', orderId: 'o-sent', kind: 'item', name: 'Postre sin enviar', quantity: 1, unitPrice: 80, lineTotal: 80, taxRate: 18, status: 'new', stationId: 's1', stationName: 'Cocina' },
    { id: 'l5', hotelId: 'h1', orderId: 'o-paid', kind: 'item', name: 'Sandwich', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, status: 'served', sentAt: SENT },
    { id: 'l6', hotelId: 'h1', orderId: 'o-room', kind: 'item', name: 'Desayuno', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, status: 'served', sentAt: SENT },
    { id: 'l9', hotelId: 'h2', orderId: 'o-other', kind: 'item', name: 'Secreto del otro hotel', quantity: 1, unitPrice: 50, lineTotal: 50, taxRate: 18, status: 'new', sentAt: SENT },
    { id: 'l10', hotelId: 'h1', orderId: 'o-split', kind: 'item', name: 'Paella', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, status: 'served', sentAt: SENT },
    { id: 'l11', hotelId: 'h1', orderId: 'o-two', kind: 'item', name: 'Entrada', quantity: 1, unitPrice: 100, lineTotal: 100, taxRate: 18, status: 'ready', stationId: 's1', stationName: 'Cocina', sentAt: SENT },
    { id: 'l12', hotelId: 'h1', orderId: 'o-two', kind: 'item', name: 'Refresco', quantity: 1, unitPrice: 50, lineTotal: 50, taxRate: 18, status: 'ready', stationId: 's2', stationName: 'Bar', sentAt: SENT },
    { id: 'l13', hotelId: 'h1', orderId: 'o-two', kind: 'item', name: 'Postre tardío', quantity: 2, unitPrice: 75, lineTotal: 150, taxRate: 18, status: 'new', stationId: 's1', stationName: 'Cocina', sentAt: SENT2 },
  ]
  const orderPayments: any[] = [
    { id: 'p1', hotelId: 'h1', orderId: 'o-split', seq: 1, method: 'cash', amount: 59, tip: 0, status: 'completed', paymentId: 'pay-cash', completedAt: SENT },
    { id: 'p2', hotelId: 'h1', orderId: 'o-split', seq: 2, method: 'card', amount: 59, tip: 5, status: 'completed', paymentId: 'pay-card', completedAt: SENT2 },
    { id: 'p3', hotelId: 'h1', orderId: 'o-split', seq: 3, method: 'card', amount: 59, tip: 0, status: 'expired' },   // Checkout vencido: no se imprime
  ]
  const paymentCalls: string[] = []
  const deps: PrintDeps = {
    orders: backed<OrderDTO>(orders),
    lines: backed<OrderItemDTO>(lines),
    tables: backed<TableDTO>([{ id: 't1', hotelId: 'h1', name: '3', zone: 'Terraza', status: 'occupied' }, { id: 't9', hotelId: 'h2', name: '9', status: 'occupied' }]),
    config: backed<any>([{ id: 'c1', hotelId: 'h1', key: 'taxes', value: [{ nombre: 'ITBIS', tasa: 18, activo: true }, { nombre: 'Viejo', tasa: 5, activo: false }] }]),
    hotels: backed<any>([
      { id: 'h1', name: 'Hotel Sol', address: 'Calle 1', phone: '809-1', ownerTaxId: 'RNC-1', currency: 'DOP', timezone: 'America/Santo_Domingo', taxRate: 18, taxName: 'ITBIS' },
      { id: 'h2', name: 'Otro Hotel', currency: 'USD' },
    ]),
    userRepo: backed<any>([
      { id: 'u-admin', hotelId: 'h1', role: 'hotel_admin', name: 'Ana Admin' },
      { id: 'u-waiter', hotelId: 'h1', role: 'waiter', name: 'Carlos Mozo' },
      { id: 'u-h2', hotelId: 'h2', role: 'hotel_admin', name: 'Otro' },
    ]),
    auth: strictAuth,
    rooms: backed<any>([{ id: 'room-204', hotelId: 'h1', number: '204' }]),
    guests: backed<any>([{ id: 'g1', hotelId: 'h1', name: 'Juan Pérez' }]),
    orderPayments: backed<OrderPaymentDTO>(orderPayments),
    ports: {
      paymentById: async (hotelId: string, id: string) => {
        paymentCalls.push(`${hotelId}/${id}`)
        if (hotelId !== 'h1') return null
        if (id === 'pay-1') return { id: 'pay-1abcdef', type: 'charge', method: 'cash', status: 'completed', amount: 138, processedAt: SENT, metadata: { source: 'restaurant' } }
        if (id === 'pay-cash') return { id: 'pay-cashXYZ', type: 'charge', method: 'cash', status: 'completed', amount: 59, processedAt: SENT, metadata: { source: 'restaurant', tendered: 100 } }
        if (id === 'pay-card') return { id: 'pay-cardXYZ', type: 'charge', method: 'card', status: 'completed', amount: 64, processedAt: SENT2, metadata: { source: 'restaurant' } }
        return null
      },
    },
  }
  return { deps, paymentCalls }
}
const admin: CurrentUser = { id: 'u-admin', hotelId: 'h1', role: 'hotel_admin', permissions: ['restaurant:view', 'restaurant:pay'] }
const waiter: CurrentUser = { id: 'u-waiter', hotelId: 'h1', role: 'waiter', permissions: ['restaurant:view'] }

describe('#216 — printOrder (usecase)', () => {
  it('precuenta: mesa/zona, mozo, comensales, líneas vivas y totales; la línea anulada NO aparece; el impuesto se llama como en configuration(taxes)', async () => {
    const html = await printOrder(fixture().deps, 'o-sent', { doc: 'precuenta' }, waiter)
    expect(html).toContain('Hotel Sol')
    expect(html).toContain('RNC RNC-1')
    expect(html).toContain('Terraza · Mesa 3')
    expect(html).toContain('Carlos Mozo')
    expect(html).toContain('Comensales')
    expect(html).toContain('1× Pizza')
    expect(html).toContain('1× Cerveza')
    expect(html).toContain('1× Postre sin enviar')          // consumido aunque no confirmado a cocina: se cobra
    expect(html).not.toContain('Plato anulado')
    expect(html).not.toContain('RD$999')
    expect(html).toContain('ITBIS 18%')
    expect(html).not.toContain('Viejo')                      // impuesto inactivo no se lista
    expect(html).toContain('RD$300.00')
    expect(html).toContain('RD$354.00')
  })

  it('comanda de cocina: solo líneas con sentAt y vivas (ni la anulada ni la sin enviar); con ?station= solo esa estación; sin precios', async () => {
    const all = await printOrder(fixture().deps, 'o-sent', { doc: 'kitchen' }, waiter)
    expect(all).toContain('1× Pizza')
    expect(all).toContain('sin cebolla')
    expect(all).toContain('1× Cerveza')
    expect(all).not.toContain('Postre sin enviar')
    expect(all).not.toContain('Plato anulado')
    expect(all).not.toContain('RD$')
    const bar = await printOrder(fixture().deps, 'o-sent', { doc: 'kitchen', station: 's2' }, waiter)
    expect(bar).toContain('1× Cerveza')
    expect(bar).not.toContain('Pizza')
    expect(bar).toContain('<div class="c b xl">Bar</div>')
    await expect(printOrder(fixture().deps, 'o-sent', { doc: 'kitchen', station: 's-nada' }, waiter)).rejects.toThrow(/enviados a cocina/)
  })

  it('ticket: comanda cobrada → método/monto/referencia del pago leído por puerto (acotado al hotel); comanda sin cobrar → 409', async () => {
    const { deps, paymentCalls } = fixture()
    const html = await printOrder(deps, 'o-paid', { doc: 'ticket' }, admin)
    expect(paymentCalls).toEqual(['h1/pay-1'])
    expect(html).toContain('TICKET')
    expect(html).toContain('Para llevar')
    expect(html).toContain('Efectivo')
    expect(html).toContain('RD$138.00')
    expect(html).toContain('PAY-1ABC')                       // referencia = inicio del id del pago
    expect(html).toContain('Propina')
    expect(html).toContain('RD$20.00')
    await expect(printOrder(deps, 'o-sent', { doc: 'ticket' }, admin)).rejects.toThrow(/después de cobrar/)
  })

  it('ticket de cargo a la habitación: "Hab. 204 · Juan Pérez" y "Cargo a la habitación", sin pedirle nada a payments', async () => {
    const { deps, paymentCalls } = fixture()
    const html = await printOrder(deps, 'o-room', { doc: 'ticket' }, admin)
    expect(paymentCalls).toEqual([])
    expect(html).toContain('Hab. 204 · Juan Pérez')
    expect(html).toContain('Cargo a la habitación')
    expect(html).toContain('RD$118.00')
  })

  it('#214 ticket de una comanda cobrada por partes: 50 % efectivo / 50 % tarjeta muestra AMBAS con referencia y propina, el cambio del efectivo, y no la parte vencida', async () => {
    const { deps, paymentCalls } = fixture()
    const html = await printOrder(deps, 'o-split', { doc: 'ticket' }, admin)
    expect(paymentCalls).toEqual(['h1/pay-cash', 'h1/pay-card'])   // una consulta por parte cobrada, ninguna por la vencida
    expect(html).toContain('<span class="n">Pago 1/2 · Efectivo</span><span class="a">RD$59.00</span>')
    expect(html).toContain('<span class="n">Pago 2/2 · Tarjeta</span><span class="a">RD$64.00</span>')
    expect(html).toContain('PAY-CASH')
    expect(html).toContain('PAY-CARD')
    expect(html).toContain('<span class="n">Recibido</span><span class="a">RD$100.00</span>')
    expect(html).toContain('<span class="n">Cambio</span><span class="a">RD$41.00</span>')
    expect(html).toContain('<span class="n">Total pagado</span><span class="a">RD$123.00</span>')
    expect(html).toContain('<span class="n">TOTAL</span><span class="a">RD$123.00</span>')
  })

  it('#216 comanda de cocina = lo de ESTE envío por defecto (batch=last: el sentAt más reciente dentro de la estación); batch=all reimprime todo', async () => {
    const last = await printOrder(fixture().deps, 'o-two', { doc: 'kitchen' }, waiter)
    expect(last).toContain('2× Postre tardío')
    expect(last).not.toContain('Entrada')
    expect(last).not.toContain('Refresco')
    // La estación Bar no participó del último envío: su último envío propio es el primero.
    const bar = await printOrder(fixture().deps, 'o-two', { doc: 'kitchen', station: 's2' }, waiter)
    expect(bar).toContain('1× Refresco')
    expect(bar).not.toContain('Postre tardío')
    const all = await printOrder(fixture().deps, 'o-two', { doc: 'kitchen', batch: 'all' }, waiter)
    expect(all).toContain('Entrada')
    expect(all).toContain('Refresco')
    expect(all).toContain('Postre tardío')
    await expect(printOrder(fixture().deps, 'o-two', { doc: 'kitchen', batch: 'x' }, waiter)).rejects.toThrow(/batch inválido/)
    expect(lastBatch([{ sentAt: '2026-01-01T00:00:00Z' }, { sentAt: '2026-01-02T00:00:00Z' }, { sentAt: null }]).map((l) => l.sentAt)).toEqual(['2026-01-02T00:00:00Z'])
    expect(lastBatch([{ sentAt: null }])).toEqual([])
  })

  it('permiso por documento: el ticket exige restaurant:pay (el mozo con solo view → 403); precuenta/cocina exigen view (cajero con solo pay → 403)', async () => {
    await expect(printOrder(fixture().deps, 'o-paid', { doc: 'ticket' }, waiter)).rejects.toThrow(/restaurant:pay/)
    const cajero: CurrentUser = { id: 'u-admin', hotelId: 'h1', role: 'cajero', permissions: ['restaurant:pay'] }
    await expect(printOrder(fixture().deps, 'o-sent', { doc: 'precuenta' }, cajero)).rejects.toThrow(/restaurant:view/)
    await expect(printOrder(fixture().deps, 'o-sent', { doc: 'kitchen' }, cajero)).rejects.toThrow(/restaurant:view/)
    expect(await printOrder(fixture().deps, 'o-paid', { doc: 'ticket' }, cajero)).toContain('TICKET')
  })

  it('IDOR: una comanda de OTRO hotel es 403 y no se filtra nada de ella; super_admin sí la ve', async () => {
    await expect(printOrder(fixture().deps, 'o-other', { doc: 'precuenta' }, admin)).rejects.toBeInstanceOf(ForbiddenError)
    const sa: CurrentUser = { id: 'u-admin', hotelId: 'h1', role: 'super_admin', permissions: ['*:*'] }
    expect(await printOrder(fixture().deps, 'o-other', { doc: 'precuenta' }, sa)).toContain('Secreto del otro hotel')
  })

  it('doc inválido → 400; comanda inexistente → 404; cancelada → 409', async () => {
    await expect(printOrder(fixture().deps, 'o-sent', { doc: 'pdf' }, admin)).rejects.toThrow(/doc inválido/)
    await expect(printOrder(fixture().deps, 'nope', { doc: 'precuenta' }, admin)).rejects.toThrow(/no encontrada/)
    await expect(printOrder(fixture().deps, 'o-cancel', { doc: 'precuenta' }, admin)).rejects.toThrow(/cancelada/)
  })
})
