// restaurant/tests/reports-daily.test.ts — #213: cierre del día del restaurante.
// Criterios del issue: 3 comandas (efectivo 100, tarjeta 200 + propina 20, folio 150) → total 450,
// propinas 20, por método 100/200/0/150, 3 comandas, ticket promedio 150; una comanda `cancelled` y una
// línea `voided` salen en "Anuladas" con monto y motivo y NO suman; día sin ventas → `empty`; token de
// otro hotel no ve nada; bordes: comensales, combos, rango, zona horaria, sin puerto de payments.
//
// Auditoría de #213: la plata sale de `payments` (por día contable) y del cargo al folio, NUNCA de la
// comanda. Acá los puertos son dobles en memoria con la misma forma que los conectores reales; el
// recorrido con ORM real (SQLite) y el refund hecho por `payments` sin tocar la comanda está en
// reports-money-orm.test.ts.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { dailyReport, resolveRange, localDateHour, MAX_RANGE_DAYS, type ReportsDeps, type ReportPayment, type ReportFolioCharge } from '../usecases/reports'
import type { OrderDTO, OrderItemDTO, CurrentUser } from '../types'

const TZ = 'America/Santo_Domingo'   // UTC-4, sin DST
const userH1: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }
const userH2: CurrentUser = { id: 'u2', hotelId: 'h2', role: 'hotel_admin' }
// "Ahora": 2026-09-11 15:00 local (19:00Z).
const NOW = new Date('2026-09-11T19:00:00.000Z')

function backed<T extends object>(store: any[]): RepositoryAdapter<T> {
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    create: async (d: any) => { store.push(d); return d },
    update: async () => null, delete: async () => true, count: async (q: any = {}) => store.filter((r) => match(r, q)).length,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
  } as unknown as RepositoryAdapter<T>
}

type PaymentRow = ReportPayment & { hotelId: string; businessDate: string }
interface Fixture {
  orders: any[]
  lines: any[]
  payments: PaymentRow[]
  folioCharges: Record<string, ReportFolioCharge & { hotelId: string }>
  hotels?: any[]
  users?: any[]
  withPaymentsPort?: boolean
  withFolioPort?: boolean
}

function makeDeps(f: Fixture): ReportsDeps & { calls: { days: string[]; refs: string[] } } {
  const calls = { days: [] as string[], refs: [] as string[] }
  const hotels = f.hotels ?? [{ id: 'h1', currency: 'DOP', timezone: TZ }, { id: 'h2', currency: 'USD', timezone: TZ }]
  return {
    orders: backed<OrderDTO>(f.orders), lines: backed<OrderItemDTO>(f.lines), hotels: backed<any>(hotels),
    ...(f.users ? { users: backed<any>(f.users) } : {}),
    ports: {
      ...(f.withPaymentsPort === false ? {} : {
        paymentsOfDay: async (hotelId, day) => { calls.days.push(`${hotelId}:${day}`); return f.payments.filter((p) => p.hotelId === hotelId && p.businessDate === day) },
      }),
      ...(f.withFolioPort === false ? {} : {
        folioCharge: async (hotelId, ref) => { calls.refs.push(ref); const c = f.folioCharges[ref]; return c && c.hotelId === hotelId ? c : null },
      }),
    },
    calls,
  }
}

// Comanda cerrada el 2026-09-11 a la hora local `hh` (UTC-4); `businessDate` = ese día (lo sella el cierre, ver business-date.ts).
function order(id: string, patch: Partial<OrderDTO> & { hh?: number; date?: string }): OrderDTO {
  const { hh = 13, date = '2026-09-11', ...rest } = patch
  const closedAt = new Date(`${date}T${String(hh).padStart(2, '0')}:30:00.000-04:00`).toISOString()
  return { id, hotelId: 'h1', number: `CMD-${id}`, type: 'dine_in', status: 'paid', subtotal: 0, tax: 0, tip: 0, total: 0, closedAt, businessDate: date, openedAt: closedAt, createdAt: closedAt, updatedAt: closedAt, ...rest } as OrderDTO
}
function line(id: string, orderId: string, name: string, unitPrice: number, quantity: number, patch: Partial<OrderItemDTO> = {}): OrderItemDTO {
  return { id, hotelId: 'h1', orderId, menuItemId: `mi-${name}`, name, unitPrice, quantity, taxRate: 0, lineTotal: unitPrice * quantity, status: 'served', stationId: 'st-cocina', stationName: 'Cocina', kind: 'item', createdAt: '', updatedAt: '', ...patch } as OrderItemDTO
}
/** Cobro del POS tal como lo asienta connectors/restaurante-payments.ts: bruto (con propina), `metadata.source/orderId`. */
function charge(id: string, orderId: string, method: string, amount: number, patch: Partial<PaymentRow> = {}): PaymentRow {
  return { id, hotelId: 'h1', type: 'charge', method, status: 'completed', amount, metadata: { source: 'restaurant', orderId }, businessDate: '2026-09-11', processedAt: '2026-09-11T17:30:00.000Z', ...patch }
}
/** Devolución tal como la asienta payments/usecases/refund.ts: hereda `metadata` del cobro + `refundOf`. */
function refund(id: string, of: PaymentRow, amount: number, patch: Partial<PaymentRow> = {}): PaymentRow {
  return { id, hotelId: of.hotelId, type: 'refund', method: 'card', status: 'completed', amount, metadata: { ...(of.metadata ?? {}), refundOf: of.id }, businessDate: '2026-09-11', processedAt: '2026-09-11T20:00:00.000Z', createdBy: 'u-caja', ...patch }
}

/** Fixture del criterio de aceptación: efectivo 100, tarjeta 200 + propina 20, folio 150 (sin impuesto para que cierre redondo). */
function acceptanceFixture(): Fixture {
  return {
    orders: [
      order('o-cash', { subtotal: 100, tax: 0, tip: 0, total: 100, settlement: 'payment', paymentId: 'p-cash', covers: 2, hh: 12 }),
      order('o-card', { subtotal: 200, tax: 0, tip: 20, total: 220, settlement: 'payment', paymentId: 'p-card', covers: 3, hh: 13 }),
      order('o-folio', { status: 'charged', subtotal: 150, tax: 0, tip: 0, total: 150, settlement: 'folio', folioId: 'f1', type: 'room_service', hh: 21 }),
    ],
    lines: [
      line('l1', 'o-cash', 'Pizza', 50, 2),
      line('l2', 'o-card', 'Pizza', 50, 3, { stationId: 'st-cocina' }),
      line('l3', 'o-card', 'Vino', 50, 1, { stationId: 'st-bar', stationName: 'Bar' }),
      line('l4', 'o-folio', 'Desayuno', 75, 2),
    ],
    payments: [
      charge('p-cash', 'o-cash', 'cash', 100),
      charge('p-card', 'o-card', 'card', 220),   // bruto: 200 + 20 de propina
      // Ruido del mismo día que NO es del restaurante: un cobro de recepción y uno de reprogramación.
      charge('p-recepcion', '', 'card', 999, { metadata: {} }),
      charge('p-resched', '', 'cash', 50, { metadata: { source: 'reschedule-credit', reservationId: 'r1' } }),
    ],
    folioCharges: { 'pos:o-folio': { hotelId: 'h1', amount: 150, taxes: 0, total: 150 } },
  }
}

describe('dailyReport — criterio de aceptación (3 comandas del día)', () => {
  it('total 450, propinas 20, por método 100/200/0/150, 3 comandas, ticket promedio 150', async () => {
    const deps = makeDeps(acceptanceFixture())
    const r = await dailyReport(deps, { date: '2026-09-11' }, userH1, NOW)
    expect(r.empty).toBe(false)
    expect(r.currency).toBe('DOP')
    expect(r.sales.total).toBe(450)
    expect(r.sales.subtotal + r.sales.tax).toBe(r.sales.total)
    expect(r.sales.tips).toBe(20)
    expect(r.sales.collected).toBe(470)
    expect(r.sales.orders).toBe(3)
    expect(r.sales.averageTicket).toBe(150)
    expect(r.byMethod.cash).toEqual({ amount: 100, orders: 1 })
    expect(r.byMethod.card).toEqual({ amount: 200, orders: 1 })
    expect(r.byMethod.transfer).toEqual({ amount: 0, orders: 0 })
    expect(r.byMethod.folio).toEqual({ amount: 150, orders: 1 })
    expect(r.byMethod.other).toEqual({ amount: 0, orders: 0 })
    // Un día = una consulta de pagos por hotel; el folio se pide por comanda cargada (referencia 'pos:').
    expect(deps.calls.days).toEqual(['h1:2026-09-11'])
    expect(deps.calls.refs).toEqual(['pos:o-folio'])
  })

  it('la plata sale de payments, no de la comanda: si el cobro asentado difiere del total de la comanda, manda el cobro', async () => {
    const f = acceptanceFixture()
    f.orders[0].total = 999; f.orders[0].subtotal = 999   // comanda "dice" 999; en caja entraron 100
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.byMethod.cash.amount).toBe(100)
    expect(r.sales.total).toBe(450)
  })

  it('cargo a habitación: vale lo que asentó el folio (neto + SU impuesto), aunque el ticket no tuviera impuesto', async () => {
    const f = acceptanceFixture()
    f.folioCharges['pos:o-folio'] = { hotelId: 'h1', amount: 150, taxes: 27, total: 177 }
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.byMethod.folio).toEqual({ amount: 177, orders: 1 })
    expect(r.sales.total).toBe(477)
    expect(r.sales.tax).toBe(27)
    expect(r.sales.subtotal).toBe(450)
  })

  it('comensales: solo dine_in con dato; ticket por comensal = ventas / comensales', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r.sales.covers).toBe(5)           // 2 + 3; room service no cuenta
    expect(r.sales.averagePerCover).toBe(90) // 450 / 5
    expect(r.byType.dine_in).toEqual({ amount: 300, orders: 2 })
    expect(r.byType.room_service).toEqual({ amount: 150, orders: 1 })
    expect(r.byType.takeaway).toEqual({ amount: 0, orders: 0 })
  })

  it('top ítems por cantidad y por importe, y ventas por estación', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r.topItemsByQuantity[0]).toEqual({ menuItemId: 'mi-Pizza', name: 'Pizza', quantity: 5, amount: 250 })
    expect(r.topItemsByAmount.map((i) => i.name)).toEqual(['Pizza', 'Desayuno', 'Vino'])
    expect(r.byStation).toEqual([
      { stationId: 'st-cocina', stationName: 'Cocina', quantity: 7, amount: 400 },
      { stationId: 'st-bar', stationName: 'Bar', quantity: 1, amount: 50 },
    ])
  })

  it('franja horaria en la zona del hotel (UTC-4): 12, 13 y 21 h; byDay trae el día con sus totales', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r.byHour).toEqual([
      { hour: 12, orders: 1, amount: 100 }, { hour: 13, orders: 1, amount: 200 }, { hour: 21, orders: 1, amount: 150 },
    ])
    expect(r.byDay).toEqual([{ date: '2026-09-11', orders: 3, amount: 450, tips: 20 }])
    expect(r.timezone).toBe(TZ)
  })

  it('la comanda de las 21:30 locales (01:30Z del día siguiente) es de HOY, no de mañana', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-12' }, userH1, NOW)
    expect(r.empty).toBe(true)
    expect(r.sales.orders).toBe(0)
  })
})

describe('dailyReport — anulaciones con motivo', () => {
  function voidFixture(): Fixture {
    const f = acceptanceFixture()
    // Comanda cancelada después de enviar: sus líneas quedaron `voided` con el motivo (#207) y la comanda guarda cancelReason (#213).
    f.orders.push(order('o-cancel', { status: 'cancelled', subtotal: 40, tax: 7.2, total: 47.2, cancelReason: 'Cliente se fue', hh: 14 }))
    f.lines.push(line('l5', 'o-cancel', 'Hamburguesa', 40, 1, { taxRate: 18, status: 'voided', voidReason: 'Cliente se fue', voidedBy: 'u-mozo', voidedAt: '2026-09-11T18:00:00.000Z' }))
    // Línea anulada dentro de la comanda pagada en efectivo: no suma a ventas, aparece con su motivo.
    f.lines.push(line('l6', 'o-cash', 'Postre', 30, 1, { status: 'voided', voidReason: 'Error de carga', voidedBy: 'u-mozo', voidedAt: '2026-09-11T16:10:00.000Z' }))
    return f
  }

  it('comanda cancelled y línea voided salen en Anuladas con monto y motivo, y NO suman a ventas', async () => {
    const r = await dailyReport(makeDeps(voidFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r.sales.total).toBe(450)
    expect(r.sales.orders).toBe(3)
    expect(r.voided.orders).toBe(1)
    expect(r.voided.lines).toBe(1)
    expect(r.voided.amount).toBe(77.2)   // 47.2 (40 + 18%) + 30
    const cancelled = r.voided.rows.find((x) => x.kind === 'order')!
    expect(cancelled).toMatchObject({ orderNumber: 'CMD-o-cancel', amount: 47.2, reason: 'Cliente se fue', quantity: 1 })
    expect(cancelled.name).toContain('Hamburguesa')
    const voided = r.voided.rows.find((x) => x.kind === 'line')!
    expect(voided).toMatchObject({ orderNumber: 'CMD-o-cash', name: 'Postre', amount: 30, reason: 'Error de carga', by: 'u-mozo' })
    // El postre anulado tampoco entra en el top de ítems.
    expect(r.topItemsByQuantity.find((i) => i.name === 'Postre')).toBeUndefined()
  })

  it('comanda cancelada `open` (líneas sin anular, sin cancelReason en filas viejas) igual aparece, sin motivo', async () => {
    const f = acceptanceFixture()
    f.orders.push(order('o-old', { status: 'cancelled', subtotal: 10, total: 10, hh: 10 }))
    f.lines.push(line('l9', 'o-old', 'Café', 10, 1, { status: 'new' }))
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    const row = r.voided.rows.find((x) => x.orderId === 'o-old')!
    expect(row).toMatchObject({ kind: 'order', amount: 10, reason: null })
  })

  it('combo: el header cuenta como ítem con su precio; los componentes (en 0) no inflan el top ni las anulaciones', async () => {
    const f = acceptanceFixture()
    f.lines.push(line('c1', 'o-cash', 'Combo Familiar', 0, 1, { kind: 'combo_header', comboId: 'cb1', menuItemId: undefined, lineTotal: 0 }))
    f.lines.push(line('c2', 'o-cash', 'Hamburguesa', 0, 2, { kind: 'combo_component', parentLineId: 'c1', lineTotal: 0 }))
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.topItemsByQuantity.find((i) => i.name === 'Hamburguesa')).toBeUndefined()
    expect(r.topItemsByQuantity.find((i) => i.name === 'Combo Familiar')).toMatchObject({ menuItemId: null, quantity: 1 })
  })
})

describe('dailyReport — descuentos y cortesías (#215)', () => {
  /**
   * Día con: una línea al 10 % (Pizza 100 → −10, por la recepcionista), una cortesía de línea al 100 %
   * (Vino 50 → −50, por el dueño), una cortesía por MONTO igual al bruto (Postre 30 → −30) y un
   * descuento de COMANDA del 20 % sobre la comanda o-cash (base 100 → −20). Los cobros asentados ya
   * vienen descontados (la plata sigue saliendo de payments).
   */
  function discountsFixture(): Fixture {
    const f = acceptanceFixture()
    // o-cash: Pizza 2×50 = 100 con descuento de comanda 20 % → subtotal 80, cobro 80.
    Object.assign(f.orders[0], { subtotal: 80, total: 80, discountType: 'percent', discountValue: 20, discountAmount: 20, discountTotal: 20, discountReason: 'Huésped del hotel', discountBy: 'u-owner', discountAt: '2026-09-11T16:10:00.000Z' })
    f.payments[0].amount = 80
    // o-card: Pizza 3×50 = 150 con 10 % de línea (−15), Vino 50 cortesía 100 % (−50), Postre 30 cortesía por monto (−30) → subtotal 85 + propina 20.
    Object.assign(f.lines[1], { discountType: 'percent', discountValue: 10, discountAmount: 15, discountReason: 'Plato con demora o error', discountBy: 'u-recep', discountAt: '2026-09-11T17:00:00.000Z' })
    Object.assign(f.lines[2], { discountType: 'percent', discountValue: 100, discountAmount: 50, discountReason: 'Cortesía de la casa', discountBy: 'u-owner', discountAt: '2026-09-11T17:05:00.000Z' })
    f.lines.push(line('l5', 'o-card', 'Postre', 30, 1, { discountType: 'amount', discountValue: 30, discountAmount: 30, discountReason: 'Cumpleaños', discountBy: 'u-recep', discountAt: '2026-09-11T17:20:00.000Z' }))
    Object.assign(f.orders[1], { subtotal: 85, total: 105, discountTotal: 95 })
    f.payments[1].amount = 105
    // Línea anulada CON descuento: no cuenta (ya salió de la venta) — no es un descuento, es una anulación.
    f.lines.push(line('l6', 'o-card', 'Agua', 10, 1, { status: 'voided', voidReason: 'Se cayó', discountType: 'percent', discountValue: 100, discountAmount: 10 }))
    f.users = [{ id: 'u-owner', hotelId: 'h1', name: 'Doña Marta' }, { id: 'u-recep', hotelId: 'h1', name: 'Rosa Pérez' }]
    return f
  }

  it('total descontado, cantidad, comandas con descuento y cortesías (100 % o monto = bruto) con motivo, usuario resuelto y comanda', async () => {
    const r = await dailyReport(makeDeps(discountsFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r.discounts.amount).toBe(115)            // 20 + 15 + 50 + 30
    expect(r.discounts.count).toBe(4)
    expect(r.discounts.orders).toBe(2)
    expect(r.discounts.courtesies).toEqual({ count: 2, amount: 80 })
    // Más reciente primero.
    expect(r.discounts.rows.map((d) => d.name)).toEqual(['Postre', 'Vino', 'Pizza', 'Comanda completa'])
    const vino = r.discounts.rows.find((d) => d.name === 'Vino')!
    expect(vino).toMatchObject({ kind: 'line', orderId: 'o-card', orderNumber: 'CMD-o-card', quantity: 1, base: 50, amount: 50, percent: 100, courtesy: true, reason: 'Cortesía de la casa', by: 'u-owner', byName: 'Doña Marta', at: '2026-09-11T17:05:00.000Z' })
    const postre = r.discounts.rows.find((d) => d.name === 'Postre')!
    expect(postre).toMatchObject({ courtesy: true, percent: 100, amount: 30, byName: 'Rosa Pérez', reason: 'Cumpleaños' })
    const pizza = r.discounts.rows.find((d) => d.name === 'Pizza')!
    expect(pizza).toMatchObject({ kind: 'line', quantity: 3, base: 150, amount: 15, percent: 10, courtesy: false, byName: 'Rosa Pérez' })
    const whole = r.discounts.rows.find((d) => d.kind === 'order')!
    expect(whole).toMatchObject({ orderId: 'o-cash', name: 'Comanda completa', base: 100, amount: 20, percent: 20, courtesy: false, reason: 'Huésped del hotel', byName: 'Doña Marta' })
    // La línea anulada con descuento va a Anuladas, no a Descuentos.
    expect(r.discounts.rows.some((d) => d.name === 'Agua')).toBe(false)
    expect(r.voided.lines).toBe(1)
    // La plata sigue saliendo de payments (ya descontada): 80 + 85 + 150.
    expect(r.sales.total).toBe(315)
    expect(r.sales.tips).toBe(20)
  })

  it('sin repo de users (o usuario borrado) el descuento se lista igual con byName null; sin descuentos, sección en cero', async () => {
    const f = discountsFixture()
    f.users = [{ id: 'u-owner', hotelId: 'h1', name: 'Doña Marta' }]   // u-recep ya no existe
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.discounts.rows.find((d) => d.name === 'Pizza')!.byName).toBeNull()
    expect(r.discounts.rows.find((d) => d.name === 'Vino')!.byName).toBe('Doña Marta')
    const f2 = discountsFixture(); delete f2.users
    const r2 = await dailyReport(makeDeps(f2), { date: '2026-09-11' }, userH1, NOW)
    expect(r2.discounts.rows.every((d) => d.byName === null)).toBe(true)
    const r3 = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r3.discounts).toEqual({ orders: 0, count: 0, amount: 0, courtesies: { count: 0, amount: 0 }, rows: [] })
  })
})

describe('dailyReport — reembolsos: se leen de payments (type refund) y RESTAN del método y de la propina', () => {
  it('refund hecho desde /api/payments/:id/refund SIN tocar la comanda (sigue `paid`): tarjeta 200 → 0, propina 20 → 0, reembolsado 220', async () => {
    const f = acceptanceFixture()
    f.payments.push(refund('rf-1', f.payments[1], 220))
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.byMethod.card).toEqual({ amount: 0, orders: 1 })
    expect(r.sales.tips).toBe(0)
    expect(r.sales.total).toBe(250)          // 100 efectivo + 150 folio
    expect(r.sales.subtotal + r.sales.tax).toBe(r.sales.total)
    expect(r.sales.collected).toBe(250)
    expect(r.sales.orders).toBe(3)           // la comanda vendida sigue contando
    expect(r.refunded).toEqual({ orders: 1, amount: 220 })
    expect(r.byDay).toEqual([{ date: '2026-09-11', orders: 3, amount: 250, tips: 0 }])
    expect(r.voided.rows.find((x) => x.kind === 'refund')).toMatchObject({ orderNumber: 'CMD-o-card', amount: 220, by: 'u-caja', at: '2026-09-11T20:00:00.000Z' })
  })

  it('refund por refundOrder (comanda `refunded`, closedAt intacto): la venta queda en su día y la devolución en el suyo', async () => {
    const f = acceptanceFixture()
    // Vendida el 10; devuelta el 11. La comanda conserva businessDate/closedAt del 10 (settlement.refundOrder ya no los pisa).
    f.orders[1] = order('o-card', { status: 'refunded', subtotal: 200, tax: 0, tip: 20, total: 220, settlement: 'payment', paymentId: 'p-card', covers: 3, date: '2026-09-10', hh: 13, refundedAt: '2026-09-11T20:00:00.000Z' })
    f.payments[1] = charge('p-card', 'o-card', 'card', 220, { status: 'refunded', businessDate: '2026-09-10' })
    f.payments.push(refund('rf-1', f.payments[1], 220, { businessDate: '2026-09-11' }))

    const day10 = await dailyReport(makeDeps(f), { date: '2026-09-10' }, userH1, NOW)
    expect(day10.byMethod.card).toEqual({ amount: 200, orders: 1 })
    expect(day10.sales.tips).toBe(20)
    expect(day10.refunded).toEqual({ orders: 0, amount: 0 })

    const day11 = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(day11.sales.orders).toBe(2)                      // efectivo + folio
    expect(day11.byMethod.card).toEqual({ amount: -200, orders: 0 })
    expect(day11.sales.tips).toBe(-20)
    expect(day11.sales.total).toBe(50)                      // 100 + 150 − 200
    expect(day11.refunded).toEqual({ orders: 1, amount: 220 })
    expect(day11.voided.rows.find((x) => x.kind === 'refund')).toMatchObject({ orderNumber: 'CMD-o-card', amount: 220 })

    const range = await dailyReport(makeDeps(f), { from: '2026-09-10', to: '2026-09-11' }, userH1, NOW)
    expect(range.byMethod.card).toEqual({ amount: 0, orders: 1 })
    expect(range.sales.tips).toBe(0)
    expect(range.sales.total).toBe(250)
    expect(range.refunded).toEqual({ orders: 1, amount: 220 })
  })

  it('devolución parcial: sale primero de la venta (no de la propina); el impuesto se descuenta en la proporción de la comanda', async () => {
    const f = acceptanceFixture()
    f.orders[1] = order('o-card', { subtotal: 200, tax: 36, tip: 20, total: 256, settlement: 'payment', paymentId: 'p-card', covers: 3, hh: 13 })
    f.payments[1] = charge('p-card', 'o-card', 'card', 256)
    f.payments.push(refund('rf-1', f.payments[1], 59))   // 59 = 50 neto + 9 de impuesto (18%)
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.byMethod.card.amount).toBe(177)     // 236 − 59
    expect(r.sales.tips).toBe(20)                // la propina no se toca
    expect(r.sales.tax).toBe(27)                 // 36 − 9
    expect(r.sales.subtotal).toBe(400)           // 100 + 200 + 150 − 50
    expect(r.sales.total).toBe(427)
    expect(r.refunded).toEqual({ orders: 1, amount: 59 })
  })

  it('un refund de recepción (sin metadata.source restaurant) no toca el cierre del restaurante', async () => {
    const f = acceptanceFixture()
    f.payments.push(refund('rf-x', f.payments[2], 999))
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.refunded).toEqual({ orders: 0, amount: 0 })
    expect(r.sales.total).toBe(450)
  })
})

describe('dailyReport — vacío, rango, IDOR, degradación', () => {
  it('día sin ventas → empty:true con estructura completa en cero (no ceros sueltos: la UI decide)', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-10' }, userH1, NOW)
    expect(r.empty).toBe(true)
    expect(r.sales).toEqual({ total: 0, subtotal: 0, tax: 0, tips: 0, collected: 0, orders: 0, averageTicket: 0, covers: 0, averagePerCover: 0 })
    expect(r.byHour).toEqual([])
    expect(r.byDay).toEqual([{ date: '2026-09-10', orders: 0, amount: 0, tips: 0 }])
    expect(r.topItemsByAmount).toEqual([])
    expect(r.voided.rows).toEqual([])
  })

  it('sin fecha → hoy en la zona del hotel', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), undefined, userH1, NOW)
    expect(r.from).toBe('2026-09-11')
    expect(r.to).toBe('2026-09-11')
    expect(r.sales.orders).toBe(3)
  })

  it('rango from/to: una consulta de comandas y una de pagos POR DÍA; byDay trae todos los días, incluso los vacíos', async () => {
    const f = acceptanceFixture()
    f.orders.push(order('o-prev', { subtotal: 30, total: 30, settlement: 'payment', paymentId: 'p-cash2', date: '2026-09-09', hh: 20 }))
    f.payments.push(charge('p-cash2', 'o-prev', 'cash', 30, { businessDate: '2026-09-09' }))
    const deps = makeDeps(f)
    const r = await dailyReport(deps, { from: '2026-09-09', to: '2026-09-11' }, userH1, NOW)
    expect(r.sales.total).toBe(480)
    expect(r.sales.orders).toBe(4)
    expect(r.byDay.map((d) => [d.date, d.amount])).toEqual([['2026-09-09', 30], ['2026-09-10', 0], ['2026-09-11', 450]])
    expect(deps.calls.days).toEqual(['h1:2026-09-09', 'h1:2026-09-10', 'h1:2026-09-11'])
  })

  it('token de otro hotel no ve nada de este (IDOR): mismo store, hotel h2 → vacío', async () => {
    const deps = makeDeps(acceptanceFixture())
    const r = await dailyReport(deps, { date: '2026-09-11' }, userH2, NOW)
    expect(r.empty).toBe(true)
    expect(r.sales.orders).toBe(0)
    expect(r.currency).toBe('USD')
    expect(deps.calls.days).toEqual(['h2:2026-09-11'])
  })

  it('usuario sin hotel → 400', async () => {
    await expect(dailyReport(makeDeps(acceptanceFixture()), {}, { id: 'sa', role: 'super_admin' }, NOW)).rejects.toThrow('Sin hotel')
  })

  it('sin puerto de payments no hay plata de cobros directos (0, nunca la comanda); las comandas cuentan y el folio sigue', async () => {
    const r = await dailyReport(makeDeps({ ...acceptanceFixture(), withPaymentsPort: false }), { date: '2026-09-11' }, userH1, NOW)
    expect(r.sales.orders).toBe(3)
    expect(r.sales.total).toBe(150)
    expect(r.byMethod.other).toEqual({ amount: 0, orders: 2 })
    expect(r.byMethod.folio).toEqual({ amount: 150, orders: 1 })
  })

  it('sin puerto de folios el cargo a habitación vale 0 (nunca la comanda)', async () => {
    const r = await dailyReport(makeDeps({ ...acceptanceFixture(), withFolioPort: false }), { date: '2026-09-11' }, userH1, NOW)
    expect(r.byMethod.folio).toEqual({ amount: 0, orders: 1 })
    expect(r.sales.total).toBe(300)
  })

  it('comandas abiertas/en curso del día no cuentan (no tienen businessDate: el cierre se lo pone)', async () => {
    const f = acceptanceFixture()
    f.orders.push({ ...order('o-open', { status: 'served', subtotal: 999, total: 999, hh: 12 }), closedAt: undefined, businessDate: undefined } as OrderDTO)
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.sales.total).toBe(450)
    expect(r.sales.orders).toBe(3)
  })
})

describe('resolveRange / localDateHour', () => {
  it('date manda sobre from/to; from solo → to=from; formato inválido → 400; from>to → 400; >366 días → 400', () => {
    expect(resolveRange({ date: '2026-01-05', from: '2026-01-01', to: '2026-01-31' }, TZ, NOW)).toEqual({ from: '2026-01-05', to: '2026-01-05' })
    expect(resolveRange({ from: '2026-01-05' }, TZ, NOW)).toEqual({ from: '2026-01-05', to: '2026-01-05' })
    expect(() => resolveRange({ date: '05/01/2026' }, TZ, NOW)).toThrow('YYYY-MM-DD')
    expect(() => resolveRange({ from: '2026-02-01', to: '2026-01-01' }, TZ, NOW)).toThrow('posterior')
    expect(() => resolveRange({ from: '2025-01-01', to: '2026-01-05' }, TZ, NOW)).toThrow(String(MAX_RANGE_DAYS))
  })

  it('hoy se calcula en la zona del hotel: 02:00Z del 12 todavía es el 11 en Santo Domingo', () => {
    expect(resolveRange(undefined, TZ, new Date('2026-09-12T02:00:00.000Z'))).toEqual({ from: '2026-09-11', to: '2026-09-11' })
    expect(localDateHour('2026-09-12T02:00:00.000Z', TZ)).toEqual({ date: '2026-09-11', hour: 22 })
    expect(localDateHour('no-date', TZ)).toBeNull()
  })
})
