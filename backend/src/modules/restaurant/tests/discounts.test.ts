// restaurant/tests/discounts.test.ts — #215 (REST-13): descuentos y cortesías con motivo, permiso y tope.
//
// Sobre el ORM REAL (SQLite in-memory, mismo harness que integrity-delete-item): los campos nuevos de
// `restaurant_orders`/`restaurant_order_items` tienen que existir en el modelo (el ORM descarta en
// silencio lo que no declara, mem 1805) y los totales que se afirman son los que quedan en la base.
// La tasa de impuesto NO está hardcodeada: sale de configuration('taxes') vía addLine.
//
// Criterios del issue: 100 + 18 % → 10 % → 90 / 16.20 / 106.20 · sin motivo → 400 · recepción 25 % con
// tope 20 → 403 "supera el máximo permitido (20 %)" · cortesía baja el importe de la línea y la línea
// sigue en la venta · comanda `paid` → 409 · audit_log con monto, motivo y usuario.
import { describe, it, expect } from 'bun:test'
import { ORM, OrmRepository, ValidationError, ForbiddenError, ConflictError } from 'arckode-framework'
import type { Auth, Logger } from 'arckode-framework'
import { SqliteAdapter } from 'arckode-framework/adapters/sqlite'
import { registerSharedModels } from '../../../shared/models'
import { registerRestaurantModels } from '../model'
import { RestaurantService } from '../service'
import type { OrderDTO, OrderItemDTO, CurrentUser, StationDTO, CategoryDTO, MenuItemDTO, TableDTO } from '../types'
import type { AuditEntry } from '../../../shared/usecases/audit'
import { computeOrderTotals, computeDiscountAmount } from '../usecases/order-totals'
import { DEFAULT_DISCOUNT_REASONS, parseDiscountInput } from '../usecases/discounts'

const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return log } } as unknown as Logger
const admin: CurrentUser = { id: 'u-admin', hotelId: 'h1', role: 'hotel_admin' }
const recep: CurrentUser = { id: 'u-recep', hotelId: 'h1', role: 'receptionist' }

interface H {
  svc: RestaurantService
  orders: OrmRepository<OrderDTO>
  lines: OrmRepository<OrderItemDTO>
  config: OrmRepository<any>
  audit: AuditEntry[]
  orderId: string
  lineId: string
  close: () => Promise<void>
}

/**
 * Hotel h1 con ITBIS 18 % en configuration('taxes'), un plato "Plato" a 100 y una comanda ya enviada
 * (`sent`) con UNA línea de ese plato agregada por `addLine` (así la tasa viene de la config, no de un
 * literal). Totales de partida: 100 / 18 / 118.
 */
async function harness(opts: { orderStatus?: OrderDTO['status']; price?: number } = {}): Promise<H> {
  const db = new SqliteAdapter({ path: ':memory:', wal: false, foreignKeys: false })
  await db.connect()
  const orm = new ORM(db)
  registerSharedModels(orm)
  registerRestaurantModels(orm)
  orm.define('Users', { table: 'users', fields: { id: { type: 'string', required: true }, hotelId: { type: 'string' }, role: { type: 'string' } } })
  orm.define('Hotels', { table: 'hotels', fields: { id: { type: 'string', required: true }, taxRate: { type: 'number' } } })
  await orm.migrate()

  const stations = new OrmRepository<StationDTO>(orm, 'RestaurantStations')
  const categories = new OrmRepository<CategoryDTO>(orm, 'MenuCategories')
  const items = new OrmRepository<MenuItemDTO>(orm, 'MenuItems')
  const tables = new OrmRepository<TableDTO>(orm, 'RestaurantTables')
  const users = new OrmRepository<any>(orm, 'Users')
  const orders = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
  const lines = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
  const config = new OrmRepository<any>(orm, 'Configuration')
  const hotels = new OrmRepository<any>(orm, 'Hotels')

  await users.create({ id: admin.id, hotelId: 'h1', role: 'hotel_admin' } as any)
  await users.create({ id: recep.id, hotelId: 'h1', role: 'receptionist' } as any)
  await hotels.create({ id: 'h1', taxRate: 0 } as any)
  await config.create({ hotelId: 'h1', key: 'taxes', value: [{ nombre: 'ITBIS', tasa: 18, activo: true }] } as any)
  const cat = await categories.create({ hotelId: 'h1', name: 'Platos' } as any)
  const item = await items.create({ hotelId: 'h1', categoryId: cat.id, name: 'Plato', price: opts.price ?? 100 } as any)

  const svc = new RestaurantService(stations, categories, items, tables, users, log, strictAuth, orders, lines, config, hotels)
  const audit: AuditEntry[] = []
  svc.setAuditDeps({ record: async (e) => { audit.push(e) } })

  const order = await orders.create({ hotelId: 'h1', number: 'CMD-1', type: 'takeaway', status: 'open', tip: 0, subtotal: 0, tax: 0, total: 0 } as any)
  const line = await svc.addLine(order.id, { menuItemId: item.id, quantity: 1 }, admin)
  await orders.update(order.id, { status: opts.orderStatus ?? 'sent' } as any)

  return { svc, orders, lines, config, audit, orderId: order.id, lineId: line.id, close: async () => { await db.close?.() } }
}

const fresh = (h: H) => h.orders.findById(h.orderId) as Promise<OrderDTO>

describe('#215 — cálculo puro (computeOrderTotals / computeDiscountAmount)', () => {
  it('comanda 100 + 18 % con 10 % → subtotal 90, impuesto 16.20, total 106.20', () => {
    const t = computeOrderTotals([{ id: 'l1', lineTotal: 100, taxRate: 18 }], { tip: 0, discountType: 'percent', discountValue: 10 })
    expect(t).toMatchObject({ subtotal: 90, tax: 16.2, total: 106.2, discountAmount: 10, discountTotal: 10 })
  })

  it('el impuesto se prorratea por línea con su propia tasa (0 % y 18 %) sobre el neto descontado', () => {
    // 100 @18 + 50 @0 = 150; 20 % → 120. Impuesto solo sobre la parte gravada descontada: 80 × 18 % = 14.40.
    const t = computeOrderTotals(
      [{ id: 'a', lineTotal: 100, taxRate: 18 }, { id: 'b', lineTotal: 50, taxRate: 0 }],
      { tip: 0, discountType: 'percent', discountValue: 20 },
    )
    expect(t.subtotal).toBe(120)
    expect(t.tax).toBe(14.4)
    expect(t.total).toBe(134.4)
  })

  it('línea con monto mayor que su total se recorta a la línea; descuento de comanda sobre lo ya descontado', () => {
    const t = computeOrderTotals(
      [{ id: 'a', lineTotal: 40, taxRate: 18, discountType: 'amount', discountValue: 99 }, { id: 'b', lineTotal: 60, taxRate: 18 }],
      { tip: 5, discountType: 'amount', discountValue: 10 },
    )
    expect(t.lineDiscounts.get('a')).toBe(40)
    expect(t.subtotal).toBe(50)          // (0 + 60) − 10
    expect(t.tax).toBe(9)                // 50 × 18 %
    expect(t.total).toBe(64)             // 50 + 9 + 5 propina
    expect(t.discountTotal).toBe(50)     // 40 de línea + 10 de comanda
    expect(computeDiscountAmount(0, 'percent', 50)).toBe(0)
    expect(computeDiscountAmount(100, null, 50)).toBe(0)
  })

  it('parseDiscountInput: tipo inválido, valor ≤ 0, % > 100 o sin motivo → ValidationError', () => {
    expect(() => parseDiscountInput({ type: 'xyz', value: 10, reason: 'x' })).toThrow(ValidationError)
    expect(() => parseDiscountInput({ type: 'percent', value: 0, reason: 'x' })).toThrow('mayor que 0')
    expect(() => parseDiscountInput({ type: 'percent', value: 101, reason: 'x' })).toThrow('100')
    expect(() => parseDiscountInput({ type: 'amount', value: 10, reason: '   ' })).toThrow('motivo')
    expect(parseDiscountInput({ type: 'amount', value: 12.345, reason: ' Promo ' })).toEqual({ type: 'amount', value: 12.35, reason: 'Promo' })
  })
})

describe('#215 — descuento de COMANDA sobre el ORM real (tasa desde configuration)', () => {
  it('100 + ITBIS 18 % de configuration → 10 % → 90 / 16.20 / 106.20 persistidos, con motivo/quién/cuándo', async () => {
    const h = await harness()
    try {
      const before = await fresh(h)
      expect(before).toMatchObject({ subtotal: 100, tax: 18, total: 118 })   // la tasa vino de configuration('taxes')

      const res = await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10, reason: 'Huésped del hotel' }, admin)
      expect(res).toMatchObject({ subtotal: 90, tax: 16.2, total: 106.2, discountAmount: 10, discountTotal: 10 })
      const after = await fresh(h)
      expect(after).toMatchObject({ subtotal: 90, tax: 16.2, total: 106.2, discountType: 'percent', discountValue: 10, discountAmount: 10, discountReason: 'Huésped del hotel', discountBy: admin.id })
      expect(after.discountAt).toBeTruthy()
    } finally { await h.close() }
  })

  it('por monto: 25 sobre 100 → subtotal 75, impuesto 13.50; un monto mayor que la base se recorta', async () => {
    const h = await harness()
    try {
      await h.svc.applyOrderDiscount(h.orderId, { type: 'amount', value: 25, reason: 'Promoción' }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 75, tax: 13.5, total: 88.5, discountAmount: 25 })
      await h.svc.applyOrderDiscount(h.orderId, { type: 'amount', value: 500, reason: 'Cortesía de la casa' }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 0, tax: 0, total: 0, discountAmount: 100, discountValue: 500 })
    } finally { await h.close() }
  })

  it('sin motivo → ValidationError (400) y la comanda no cambia', async () => {
    const h = await harness()
    try {
      await expect(h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10, reason: '' }, admin)).rejects.toThrow(ValidationError)
      await expect(h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10 }, admin)).rejects.toThrow('motivo')
      expect(await fresh(h)).toMatchObject({ subtotal: 100, total: 118, discountType: null })
      expect(h.audit).toHaveLength(0)
    } finally { await h.close() }
  })

  it('recepción con 25 % y tope por defecto 20 → 403 "supera el máximo permitido (20 %)"; con 20 % pasa', async () => {
    const h = await harness()
    try {
      let err: unknown
      try { await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 25, reason: 'Promoción' }, recep) } catch (e) { err = e }
      expect(err).toBeInstanceOf(ForbiddenError)
      expect((err as ForbiddenError).httpStatus).toBe(403)
      expect((err as Error).message).toContain('supera el máximo permitido (20 %)')
      expect(await fresh(h)).toMatchObject({ subtotal: 100, discountType: null })
      // Un monto también se mide contra el tope: 30 sobre 100 = 30 % > 20.
      await expect(h.svc.applyOrderDiscount(h.orderId, { type: 'amount', value: 30, reason: 'Promoción' }, recep)).rejects.toThrow('supera el máximo permitido (20 %)')
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 20, reason: 'Promoción' }, recep)
      expect(await fresh(h)).toMatchObject({ subtotal: 80, tax: 14.4, total: 94.4 })
    } finally { await h.close() }
  })

  it('el tope se configura por hotel (configuration("restaurant").maxDiscountPercent) y no aplica al hotel_admin', async () => {
    const h = await harness()
    try {
      await h.config.create({ hotelId: 'h1', key: 'restaurant', value: { maxDiscountPercent: 30, otraClave: true } } as any)
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 30, reason: 'Promoción' }, recep)
      expect(await fresh(h)).toMatchObject({ subtotal: 70 })
      await expect(h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 31, reason: 'Promoción' }, recep)).rejects.toThrow('(30 %)')
      // hotel_admin: cortesía completa sin tope.
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 100, reason: 'Cortesía de la casa' }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 0, tax: 0, total: 0 })
      // La política que ve cada uno + PUT conserva las otras claves del objeto.
      expect((await h.svc.getDiscountPolicy(recep)).maxDiscountPercent).toBe(30)
      expect((await h.svc.getDiscountPolicy(admin)).maxDiscountPercent).toBe(100)
      const pol = await h.svc.setDiscountPolicy({ maxDiscountPercent: 15, reasons: ['VIP', 'Otro'] }, admin)
      expect(pol.reasons).toEqual(['VIP', 'Otro'])
      const row = await h.config.findOne({ hotelId: 'h1', key: 'restaurant' })
      expect(row.value).toEqual({ maxDiscountPercent: 15, otraClave: true })
      expect((await h.svc.getDiscountPolicy(recep))).toMatchObject({ maxDiscountPercent: 15, reasons: ['VIP', 'Otro'], isDefault: false })
      await expect(h.svc.setDiscountPolicy({ maxDiscountPercent: 101 }, admin)).rejects.toThrow(ValidationError)
    } finally { await h.close() }
  })

  it('política por defecto: tope 20 y motivos predefinidos', async () => {
    const h = await harness()
    try {
      expect(await h.svc.getDiscountPolicy(recep)).toEqual({ maxDiscountPercent: 20, reasons: [...DEFAULT_DISCOUNT_REASONS], isDefault: true })
    } finally { await h.close() }
  })

  it('comanda paid → ConflictError (409); charged/cancelled/processing_payment también', async () => {
    for (const status of ['paid', 'charged', 'cancelled', 'processing_payment'] as OrderDTO['status'][]) {
      const h = await harness({ orderStatus: status })
      try {
        let err: unknown
        try { await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10, reason: 'Promoción' }, admin) } catch (e) { err = e }
        expect(err).toBeInstanceOf(ConflictError)
        expect((err as ConflictError).httpStatus).toBe(409)
        await expect(h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 10, reason: 'Promoción' }, admin)).rejects.toThrow(ConflictError)
        expect(await fresh(h)).toMatchObject({ subtotal: 100, total: 118 })
      } finally { await h.close() }
    }
  })

  it('audita restaurant.discount.applied con alcance, monto, motivo y usuario; quitar audita .removed y restaura', async () => {
    const h = await harness()
    try {
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10, reason: 'Huésped del hotel' }, recep)
      expect(h.audit).toHaveLength(1)
      expect(h.audit[0]).toMatchObject({ action: 'restaurant.discount.applied', hotelId: 'h1', userId: recep.id, entity: 'restaurant_order', entityId: h.orderId })
      expect(JSON.parse(h.audit[0].detail!)).toMatchObject({ scope: 'order', orderNumber: 'CMD-1', type: 'percent', value: 10, amount: 10, base: 100, reason: 'Huésped del hotel', total: 106.2 })

      const res = await h.svc.removeOrderDiscount(h.orderId, admin)
      expect(res).toMatchObject({ subtotal: 100, tax: 18, total: 118, discountAmount: 0, discountTotal: 0 })
      expect(await fresh(h)).toMatchObject({ discountType: null, discountReason: null, subtotal: 100 })
      expect(h.audit[1]).toMatchObject({ action: 'restaurant.discount.removed', userId: admin.id })
      expect(JSON.parse(h.audit[1].detail!)).toMatchObject({ scope: 'order', type: 'percent', value: 10, amount: 10, reason: 'Huésped del hotel' })
      await expect(h.svc.removeOrderDiscount(h.orderId, admin)).rejects.toThrow(ConflictError)
    } finally { await h.close() }
  })

  it('IDOR: la comanda de otro hotel no se descuenta', async () => {
    const h = await harness()
    try {
      await h.orders.update(h.orderId, { hotelId: 'OTRO' } as any)
      await expect(h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10, reason: 'x' }, admin)).rejects.toThrow('IDOR')
    } finally { await h.close() }
  })
})

describe('#215 — descuento de LÍNEA y cortesía sobre el ORM real', () => {
  it('10 % sobre la línea → lineTotal sigue bruto, discountAmount 10; comanda 90 / 16.20 / 106.20', async () => {
    const h = await harness()
    try {
      const line = await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 10, reason: 'Plato con demora o error' }, admin)
      expect(line).toMatchObject({ lineTotal: 100, discountType: 'percent', discountValue: 10, discountAmount: 10, discountReason: 'Plato con demora o error', discountBy: admin.id })
      expect(await fresh(h)).toMatchObject({ subtotal: 90, tax: 16.2, total: 106.2, discountAmount: 0, discountTotal: 10 })
    } finally { await h.close() }
  })

  it('por monto: 30 sobre una línea de 100 → 70 / 12.60 / 82.60; recepción con 30 (=30 %) y tope 20 → 403', async () => {
    const h = await harness()
    try {
      await expect(h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'amount', value: 30, reason: 'Promoción' }, recep)).rejects.toThrow('supera el máximo permitido (20 %)')
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'amount', value: 30, reason: 'Promoción' }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 70, tax: 12.6, total: 82.6, discountTotal: 30 })
    } finally { await h.close() }
  })

  it('cortesía (100 %) de una línea: el total baja el importe de esa línea y la línea SIGUE en la venta (no voided)', async () => {
    const h = await harness()
    try {
      // Segunda línea (Plato ×2 = 200) para que la comanda no quede en cero.
      const item = await h.lines.findById(h.lineId)
      const other = await h.svc.addLine(h.orderId, { menuItemId: item!.menuItemId!, quantity: 2 }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 300, tax: 54, total: 354 })

      const line = await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 100, reason: 'Cortesía de la casa' }, admin)
      expect(line.status).toBe('new')                 // no es una anulación
      expect(line.discountAmount).toBe(100)
      expect(await fresh(h)).toMatchObject({ subtotal: 200, tax: 36, total: 236, discountTotal: 100 })
      // Recepción con tope 20 no puede regalar el plato.
      await expect(h.svc.applyLineDiscount(h.orderId, other.id, { type: 'percent', value: 100, reason: 'Cortesía de la casa' }, recep)).rejects.toThrow(ForbiddenError)
      const detail = JSON.parse(h.audit[0].detail!)
      expect(detail).toMatchObject({ scope: 'line', lineId: h.lineId, name: 'Plato', amount: 100, courtesy: true, reason: 'Cortesía de la casa' })
      expect(h.audit[0].entity).toBe('restaurant_order_item')
    } finally { await h.close() }
  })

  it('cambiar la cantidad recalcula: un % se mantiene, un monto se recorta al nuevo total de la línea', async () => {
    const h = await harness()
    try {
      await h.svc.updateLine(h.orderId, h.lineId, { quantity: 2 }, admin)          // 200
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'amount', value: 150, reason: 'Promoción' }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 50, discountTotal: 150 })
      await h.svc.updateLine(h.orderId, h.lineId, { quantity: 1 }, admin)          // 100 → el monto 150 se recorta a 100
      expect(await h.lines.findById(h.lineId)).toMatchObject({ lineTotal: 100, discountValue: 150, discountAmount: 100 })
      expect(await fresh(h)).toMatchObject({ subtotal: 0, tax: 0, discountTotal: 100 })

      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 50, reason: 'Promoción' }, admin)
      await h.svc.updateLine(h.orderId, h.lineId, { quantity: 3 }, admin)          // 300 → 50 % = 150
      expect(await h.lines.findById(h.lineId)).toMatchObject({ lineTotal: 300, discountAmount: 150 })
      expect(await fresh(h)).toMatchObject({ subtotal: 150, tax: 27, total: 177 })
    } finally { await h.close() }
  })

  it('una línea anulada no admite descuento (409) y quitar uno inexistente también', async () => {
    const h = await harness()
    try {
      await expect(h.svc.removeLineDiscount(h.orderId, h.lineId, admin)).rejects.toThrow(ConflictError)
      await h.svc.voidLine(h.orderId, h.lineId, 'Sin stock', admin)
      await expect(h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 10, reason: 'x' }, admin)).rejects.toThrow('anulada')
      await expect(h.svc.applyLineDiscount(h.orderId, 'no-existe', { type: 'percent', value: 10, reason: 'x' }, admin)).rejects.toThrow('no encontrada')
    } finally { await h.close() }
  })

  it('quitar el descuento de la línea restaura los totales y audita', async () => {
    const h = await harness()
    try {
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 10, reason: 'Promoción' }, admin)
      const line = await h.svc.removeLineDiscount(h.orderId, h.lineId, admin)
      expect(line).toMatchObject({ discountType: null, discountAmount: 0, discountReason: null })
      expect(await fresh(h)).toMatchObject({ subtotal: 100, tax: 18, total: 118, discountTotal: 0 })
      expect(h.audit.map((a) => a.action)).toEqual(['restaurant.discount.applied', 'restaurant.discount.removed'])
    } finally { await h.close() }
  })

  it('el tope se mide sobre el descuento efectivo TOTAL: línea 20 % + comanda 20 % (= 36 % del bruto) con tope 25 → 403; con tope 50 → pasa y cierra al centavo', async () => {
    const h = await harness()
    try {
      await h.config.create({ hotelId: 'h1', key: 'restaurant', value: { maxDiscountPercent: 25 } } as any)
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 20, reason: 'Promoción' }, recep)   // 20 de 100
      expect(await fresh(h)).toMatchObject({ subtotal: 80, discountTotal: 20 })
      // Cada operación por separado está bajo el tope (20 ≤ 25), pero 20 + 20 % de 80 = 36 % del bruto.
      let err: unknown
      try { await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 20, reason: 'Huésped del hotel' }, recep) } catch (e) { err = e }
      expect(err).toBeInstanceOf(ForbiddenError)
      expect((err as ForbiddenError).httpStatus).toBe(403)
      expect((err as Error).message).toContain('supera el máximo permitido (25 %)')
      expect((err as Error).message).toContain('36 %')
      expect(await fresh(h)).toMatchObject({ subtotal: 80, tax: 14.4, total: 94.4, discountType: null, discountTotal: 20 })
      expect(h.audit).toHaveLength(1)   // solo el de la línea
      // En el otro orden también: comanda 20 % primero y después la línea → misma suma, mismo 403.
      await h.svc.removeLineDiscount(h.orderId, h.lineId, admin)
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 20, reason: 'Huésped del hotel' }, recep)
      await expect(h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 20, reason: 'Promoción' }, recep)).rejects.toThrow('supera el máximo permitido (25 %)')
      expect(await h.lines.findById(h.lineId)).toMatchObject({ discountType: null, discountAmount: 0 })
      // Un monto en la línea también se suma: 6 sobre 100 (6 %) + 20 % de 94 = 24.8 % ≤ 25 pasa; 7 → 25.6 % no.
      await expect(h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'amount', value: 7, reason: 'Promoción' }, recep)).rejects.toThrow('(25 %)')
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'amount', value: 6, reason: 'Promoción' }, recep)
      expect(await fresh(h)).toMatchObject({ subtotal: 75.2, discountTotal: 24.8 })

      // Con tope 50 la misma combinación entra y los totales cierran al centavo.
      await h.svc.removeLineDiscount(h.orderId, h.lineId, admin)
      await h.svc.removeOrderDiscount(h.orderId, admin)
      await h.svc.setDiscountPolicy({ maxDiscountPercent: 50 }, admin)
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 20, reason: 'Promoción' }, recep)          // 100 → 80
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 20, reason: 'Huésped del hotel' }, recep)          // 80 → 64
      expect(await fresh(h)).toMatchObject({ subtotal: 64, tax: 11.52, total: 75.52, discountAmount: 16, discountTotal: 36 })
      // 36 % ≤ 50, pero subir la comanda a 40 % (20 + 32 = 52 %) vuelve a rebotar y la comanda queda como estaba.
      await expect(h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 40, reason: 'Huésped del hotel' }, recep)).rejects.toThrow('supera el máximo permitido (50 %)')
      expect(await fresh(h)).toMatchObject({ subtotal: 64, total: 75.52, discountValue: 20 })
      // hotel_admin sigue sin tope: cortesía total encima de lo que ya había.
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 100, reason: 'Cortesía de la casa' }, admin)
      expect(await fresh(h)).toMatchObject({ subtotal: 0, tax: 0, total: 0, discountTotal: 100 })
    } finally { await h.close() }
  })

  it('línea + comanda: el descuento de comanda se aplica sobre lo ya descontado y el impuesto sobre el neto final', async () => {
    const h = await harness()
    try {
      await h.svc.applyLineDiscount(h.orderId, h.lineId, { type: 'percent', value: 20, reason: 'Promoción' }, admin)   // 80
      await h.svc.applyOrderDiscount(h.orderId, { type: 'percent', value: 10, reason: 'Huésped del hotel' }, admin)   // 72
      expect(await fresh(h)).toMatchObject({ subtotal: 72, tax: 12.96, total: 84.96, discountAmount: 8, discountTotal: 28 })
      // billOrder (propina) conserva el descuento: recalcula con la misma comanda.
      const billed = await h.svc.billOrder(h.orderId, { tip: 5 }, admin)
      expect(billed).toMatchObject({ subtotal: 72, tax: 12.96, tip: 5, total: 89.96, status: 'billed' })
    } finally { await h.close() }
  })
})
