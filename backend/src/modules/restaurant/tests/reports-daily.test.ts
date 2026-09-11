// restaurant/tests/reports-daily.test.ts — #213: cierre del día del restaurante.
// Criterios del issue: 3 comandas (efectivo 100, tarjeta 200 + propina 20, folio 150) → total 450,
// propinas 20, por método 100/200/0/150, 3 comandas, ticket promedio 150; una comanda `cancelled` y una
// línea `voided` salen en "Anuladas" con monto y motivo y NO suman; día sin ventas → `empty`; token de
// otro hotel no ve nada; bordes: comensales, combos, rango, zona horaria, sin puerto de payments.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { dailyReport, resolveRange, localDateHour, MAX_RANGE_DAYS, type ReportsDeps } from '../usecases/reports'
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

interface Fixture { orders: any[]; lines: any[]; payments: Record<string, string>; hotels?: any[]; withPort?: boolean }

function makeDeps(f: Fixture): ReportsDeps & { calls: { paymentIds: string[] } } {
  const calls = { paymentIds: [] as string[] }
  const hotels = f.hotels ?? [{ id: 'h1', currency: 'DOP', timezone: TZ }, { id: 'h2', currency: 'USD', timezone: TZ }]
  return {
    orders: backed<OrderDTO>(f.orders), lines: backed<OrderItemDTO>(f.lines), hotels: backed<any>(hotels),
    ports: f.withPort === false ? {} : {
      paymentMethod: async (id) => { calls.paymentIds.push(id); if (!f.payments[id]) throw new Error('Payment not found'); return f.payments[id] },
    },
    calls,
  }
}

// Comanda cerrada el 2026-09-11 a la hora local `hh` (UTC-4).
function order(id: string, patch: Partial<OrderDTO> & { hh?: number; date?: string }): OrderDTO {
  const { hh = 13, date = '2026-09-11', ...rest } = patch
  const closedAt = new Date(`${date}T${String(hh).padStart(2, '0')}:30:00.000-04:00`).toISOString()
  return { id, hotelId: 'h1', number: `CMD-${id}`, type: 'dine_in', status: 'paid', subtotal: 0, tax: 0, tip: 0, total: 0, closedAt, openedAt: closedAt, createdAt: closedAt, updatedAt: closedAt, ...rest } as OrderDTO
}
function line(id: string, orderId: string, name: string, unitPrice: number, quantity: number, patch: Partial<OrderItemDTO> = {}): OrderItemDTO {
  return { id, hotelId: 'h1', orderId, menuItemId: `mi-${name}`, name, unitPrice, quantity, taxRate: 0, lineTotal: unitPrice * quantity, status: 'served', stationId: 'st-cocina', stationName: 'Cocina', kind: 'item', createdAt: '', updatedAt: '', ...patch } as OrderItemDTO
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
    payments: { 'p-cash': 'cash', 'p-card': 'card' },
  }
}

describe('dailyReport — criterio de aceptación (3 comandas del día)', () => {
  it('total 450, propinas 20, por método 100/200/0/150, 3 comandas, ticket promedio 150', async () => {
    const deps = makeDeps(acceptanceFixture())
    const r = await dailyReport(deps, { date: '2026-09-11' }, userH1, NOW)
    expect(r.empty).toBe(false)
    expect(r.currency).toBe('DOP')
    expect(r.sales.total).toBe(450)
    expect(r.sales.tips).toBe(20)
    expect(r.sales.collected).toBe(470)
    expect(r.sales.orders).toBe(3)
    expect(r.sales.averageTicket).toBe(150)
    expect(r.byMethod.cash).toEqual({ amount: 100, orders: 1 })
    expect(r.byMethod.card).toEqual({ amount: 200, orders: 1 })
    expect(r.byMethod.transfer).toEqual({ amount: 0, orders: 0 })
    expect(r.byMethod.folio).toEqual({ amount: 150, orders: 1 })
    expect(r.byMethod.other).toEqual({ amount: 0, orders: 0 })
    // El puerto de payments se consulta solo por los cobros directos (el folio no tiene payment).
    expect(deps.calls.paymentIds).toEqual(['p-cash', 'p-card'])
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
    // Comanda reembolsada (fue cobrada con tarjeta, se devolvió el dinero).
    f.orders.push(order('o-refund', { status: 'refunded', subtotal: 60, tax: 0, tip: 0, total: 60, settlement: 'payment', paymentId: 'p-ref', hh: 15 }))
    f.payments['p-ref'] = 'card'
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

  it('reembolsos: aparte de ventas, con su monto, y también en la tabla', async () => {
    const r = await dailyReport(makeDeps(voidFixture()), { date: '2026-09-11' }, userH1, NOW)
    expect(r.refunded).toEqual({ orders: 1, amount: 60 })
    expect(r.voided.rows.find((x) => x.kind === 'refund')).toMatchObject({ orderNumber: 'CMD-o-refund', amount: 60 })
    expect(r.byMethod.card.amount).toBe(200)   // el reembolsado no está en tarjeta
    expect(r.empty).toBe(false)
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

  it('rango from/to acumula varios días y byDay trae todos los días, incluso los vacíos', async () => {
    const f = acceptanceFixture()
    f.orders.push(order('o-prev', { subtotal: 30, total: 30, settlement: 'payment', paymentId: 'p-cash2', date: '2026-09-09', hh: 20 }))
    f.payments['p-cash2'] = 'cash'
    const r = await dailyReport(makeDeps(f), { from: '2026-09-09', to: '2026-09-11' }, userH1, NOW)
    expect(r.sales.total).toBe(480)
    expect(r.sales.orders).toBe(4)
    expect(r.byDay.map((d) => [d.date, d.amount])).toEqual([['2026-09-09', 30], ['2026-09-10', 0], ['2026-09-11', 450]])
  })

  it('token de otro hotel no ve nada de este (IDOR): mismo store, hotel h2 → vacío', async () => {
    const r = await dailyReport(makeDeps(acceptanceFixture()), { date: '2026-09-11' }, userH2, NOW)
    expect(r.empty).toBe(true)
    expect(r.sales.orders).toBe(0)
    expect(r.currency).toBe('USD')
  })

  it('usuario sin hotel → 400', async () => {
    await expect(dailyReport(makeDeps(acceptanceFixture()), {}, { id: 'sa', role: 'super_admin' }, NOW)).rejects.toThrow('Sin hotel')
  })

  it('sin puerto de payments el reporte sale igual: los cobros directos caen en `other`', async () => {
    const r = await dailyReport(makeDeps({ ...acceptanceFixture(), withPort: false }), { date: '2026-09-11' }, userH1, NOW)
    expect(r.sales.total).toBe(450)
    expect(r.byMethod.other).toEqual({ amount: 300, orders: 2 })
    expect(r.byMethod.folio).toEqual({ amount: 150, orders: 1 })
  })

  it('comandas abiertas/en curso del día no cuentan (no tienen closedAt ni estado terminal)', async () => {
    const f = acceptanceFixture()
    f.orders.push({ ...order('o-open', { status: 'served', subtotal: 999, total: 999, hh: 12 }), closedAt: undefined } as OrderDTO)
    const r = await dailyReport(makeDeps(f), { date: '2026-09-11' }, userH1, NOW)
    expect(r.sales.total).toBe(450)
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
