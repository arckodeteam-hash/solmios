// restaurant/tests/permissions-routes.test.ts — Permisos coherentes del POS (#205, epic #202).
//
// A nivel de RUTA REAL (router.resolve sobre el módulo montado con un ORM fake con datos), igual que
// tickets/tests/messages-route.test.ts: prueba que el guard (auth.authenticate + loadPermissions +
// requirePermission) corta o deja pasar según el rol REAL de shared/permissions.ts.
//
// Lo que estaba mal antes (#205):
//   - `kitchen` tiene `restaurant:edit` para mover líneas en el KDS, y /bill, /pay y /charge-to-room se
//     gateaban con ese mismo `edit` → cocina podía COBRAR por URL. Ahora esas tres rutas exigen
//     `restaurant:pay`, que kitchen no tiene.
//   - `waiter` no podía quitar una línea mal cargada (DELETE exigía `restaurant:delete`, que solo tiene
//     hotel_admin). Ahora con la comanda `open` alcanza `restaurant:create` (el mismo permiso que
//     agregarla; cocina NO lo tiene, con `edit` en la ruta borraba líneas por API); después de enviada
//     el DELETE devuelve 409: la línea se ANULA con motivo (`POST .../void`, `restaurant:delete`, #207).
//   - Los permisos efectivos salen de la FILA de `roles` (loadPermissions), no del mapa estático: el
//     bloque final monta la fila que prod tenía antes del deploy (sin `pay`) y prueba que sin backfill
//     cobrar da 403 y con la fila backfilleada da 200.
//   - `PaySchema.method` aceptaba cualquier string: "xyz" llegaba a payments como `completed`.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { RestaurantModule } from '../index'

type Row = Record<string, any>

/**
 * ORM fake con tablas mutables por id: el POS necesita encontrar la comanda (findById), sus líneas
 * (findMany por orderId), el hotel (moneda) y al usuario (ownership). `update` muta la fila para que
 * el 200 de cobro refleje el estado final (paid/charged).
 */
function mount(roleRows: Row[] = []) {
  const rows: Record<string, Row[]> = {
    Roles: roleRows,
    Users: [
      { id: 'user-waiter', hotelId: 'h1', role: 'waiter', active: 1 },
      { id: 'user-kitchen', hotelId: 'h1', role: 'kitchen', active: 1 },
      { id: 'user-hotel_admin', hotelId: 'h1', role: 'hotel_admin', active: 1 },
      { id: 'user-receptionist', hotelId: 'h1', role: 'receptionist', active: 1 },
    ],
    Hotels: [{ id: 'h1', name: 'Hotel Sol', currency: 'DOP' }],
    // #208: reserva del hotel (room service / cargo a habitación la validan por puerto).
    Reservations: [{ id: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'room-1' }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RestaurantTables: [{ id: 't1', hotelId: 'h1', status: 'occupied' }, { id: 't-free', hotelId: 'h1', status: 'free' }],
    // #208: ítem componente de un combo (no se borra) y otro suelto (se borra).
    MenuItems: [{ id: 'mi-combo', hotelId: 'h1', categoryId: 'c1', name: 'Papas', price: 50 }, { id: 'mi-solo', hotelId: 'h1', categoryId: 'c1', name: 'Agua', price: 20 }],
    MenuCombos: [{ id: 'cb1', hotelId: 'h1', name: 'Combo Familiar', price: 300 }],
    MenuComboItems: [{ id: 'cbi1', hotelId: 'h1', comboId: 'cb1', menuItemId: 'mi-combo', quantity: 1 }],
    RestaurantOrders: [
      { id: 'o-open', hotelId: 'h1', status: 'open', tableId: 't1', tip: 0, subtotal: 100, tax: 0, total: 100, number: 1 },
      { id: 'o-sent', hotelId: 'h1', status: 'sent', tableId: 't1', tip: 0, subtotal: 100, tax: 0, total: 100, number: 2 },
      { id: 'o-room', hotelId: 'h1', status: 'sent', reservationId: 'r1', tip: 0, subtotal: 100, tax: 0, total: 100, number: 3 },
    ],
    RestaurantOrderItems: [
      { id: 'l-open', hotelId: 'h1', orderId: 'o-open', kind: 'item', status: 'new', unitPrice: 100, quantity: 1, lineTotal: 100, taxRate: 0 },
      { id: 'l-sent', hotelId: 'h1', orderId: 'o-sent', kind: 'item', status: 'new', unitPrice: 100, quantity: 1, lineTotal: 100, taxRate: 0 },
      { id: 'l-room', hotelId: 'h1', orderId: 'o-room', kind: 'item', status: 'new', unitPrice: 100, quantity: 1, lineTotal: 100, taxRate: 0 },
    ],
  }
  const table = (t: string) => (rows[t] ??= [])
  const matches = (r: Row, f?: Row) => Object.entries(f ?? {}).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    findMany: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)),
    findById: async (t: string, id: string) => table(t).find((r) => r.id === id) ?? null,
    findOne: async (t: string, f?: Row) => table(t).find((r) => matches(r, f)) ?? null,
    create: async (t: string, d: Row) => { const row = { id: `gen-${table(t).length + 1}`, ...d }; table(t).push(row); return row },
    update: async (t: string, id: string, d: Row) => {
      const cur = table(t).find((r) => r.id === id)
      if (!cur) return null
      Object.assign(cur, d)
      return cur
    },
    delete: async (t: string, id: string) => {
      const i = table(t).findIndex((r) => r.id === id)
      if (i >= 0) table(t).splice(i, 1)
      return i >= 0
    },
    count: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)).length,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
  }

  const router = new Router()
  const auth = makeAuth()
  const service = (RestaurantModule() as any).create({ logger: fakeLogger(), orm, router, auth })

  // Puertos de dinero: se registra qué llegó a payments/folios para afirmar "sin fila" en el 400.
  const recorded: Row[] = []
  const charged: Row[] = []
  service.setSettlementDeps({
    recordPayment: async (input: Row) => { recorded.push(input); return { paymentId: `pay-${recorded.length}` } },
    chargeToFolio: async (input: Row) => { charged.push(input); return { folioId: 'folio-1' } },
  })
  service.setReservationPort({
    findById: async (id: string) => rows.Reservations.find((r) => r.id === id) ?? null,
  })
  return { router, auth, rows, recorded, charged }
}

const headers = (auth: ReturnType<typeof makeAuth>, role: string) => bearer(auth, role, 'h1')

describe('#208 — DELETE /menu-items/:id y /tables/:id por la ruta real: 409 de integridad', () => {
  it('ítem en un combo → 409 con el nombre del combo; el ítem sigue', async () => {
    const { router, auth, rows } = mount()
    const res = await router.resolve('DELETE', '/api/restaurant/menu-items/mi-combo', { headers: headers(auth, 'hotel_admin') })
    expect(res.status).toBe(409)
    expect(JSON.stringify(res.body)).toContain('Combo Familiar')
    expect(rows.MenuItems.find((m) => m.id === 'mi-combo')).toBeDefined()
  })

  it('ítem suelto → 200/204 y desaparece', async () => {
    const { router, auth, rows } = mount()
    const res = await router.resolve('DELETE', '/api/restaurant/menu-items/mi-solo', { headers: headers(auth, 'hotel_admin') })
    expect([200, 204]).toContain(res.status)
    expect(rows.MenuItems.find((m) => m.id === 'mi-solo')).toBeUndefined()
  })

  it('mesa con comanda abierta → 409; mesa libre → se borra', async () => {
    const { router, auth, rows } = mount()
    const busy = await router.resolve('DELETE', '/api/restaurant/tables/t1', { headers: headers(auth, 'hotel_admin') })
    expect(busy.status).toBe(409)
    expect(rows.RestaurantTables.find((t) => t.id === 't1')).toBeDefined()
    const free = await router.resolve('DELETE', '/api/restaurant/tables/t-free', { headers: headers(auth, 'hotel_admin') })
    expect([200, 204]).toContain(free.status)
    expect(rows.RestaurantTables.find((t) => t.id === 't-free')).toBeUndefined()
  })
})

describe('POST /api/restaurant/orders/:id/pay — solo restaurant:pay cobra', () => {
  it('kitchen (restaurant:view/edit, sin pay) → 403 y NO llega a payments', async () => {
    const { router, auth, recorded } = mount()
    const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, 'kitchen'), body: { method: 'cash' } })
    expect(res.status).toBe(403)
    expect(recorded).toHaveLength(0)
  })

  it('waiter cobra en efectivo → 200, comanda paid, un payment', async () => {
    const { router, auth, rows, recorded } = mount()
    const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, 'waiter'), body: { method: 'cash' } })
    expect(res.status).toBe(200)
    expect(rows.RestaurantOrders.find((o) => o.id === 'o-sent')?.status).toBe('paid')
    expect(recorded).toHaveLength(1)
    expect(recorded[0].method).toBe('cash')
  })

  it('receptionist y hotel_admin también cobran (200)', async () => {
    for (const role of ['receptionist', 'hotel_admin']) {
      const { router, auth } = mount()
      const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, role), body: { method: 'cash' } })
      expect(res.status).toBe(200)
    }
  })

  it('method "xyz" → 400 de validación, sin fila en payments y la comanda intacta', async () => {
    const { router, auth, rows, recorded } = mount()
    const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, 'waiter'), body: { method: 'xyz' } })
    expect(res.status).toBe(400)
    expect(recorded).toHaveLength(0)
    expect(rows.RestaurantOrders.find((o) => o.id === 'o-sent')?.status).toBe('sent')
  })
})

describe('POST /api/restaurant/orders/:id/charge-to-room y /bill — mismo permiso restaurant:pay', () => {
  it('kitchen → 403 en charge-to-room y en bill', async () => {
    const { router, auth, charged } = mount()
    const room = await router.resolve('POST', '/api/restaurant/orders/o-room/charge-to-room', { headers: headers(auth, 'kitchen'), body: {} })
    expect(room.status).toBe(403)
    expect(charged).toHaveLength(0)
    const bill = await router.resolve('POST', '/api/restaurant/orders/o-sent/bill', { headers: headers(auth, 'kitchen'), body: { tip: 10 } })
    expect(bill.status).toBe(403)
  })

  it('waiter carga a la habitación → 200, comanda charged, un cargo al folio', async () => {
    const { router, auth, rows, charged } = mount()
    const res = await router.resolve('POST', '/api/restaurant/orders/o-room/charge-to-room', { headers: headers(auth, 'waiter'), body: {} })
    expect(res.status).toBe(200)
    expect(rows.RestaurantOrders.find((o) => o.id === 'o-room')?.status).toBe('charged')
    expect(charged).toHaveLength(1)
    expect(charged[0].reservationId).toBe('r1')
  })
})

describe('DELETE /api/restaurant/orders/:id/items/:lineId — quitar antes de enviar es tomar el pedido', () => {
  it('waiter quita una línea de una comanda open → 204 y la línea desaparece', async () => {
    const { router, auth, rows } = mount()
    const res = await router.resolve('DELETE', '/api/restaurant/orders/o-open/items/l-open', { headers: headers(auth, 'waiter') })
    expect(res.status).toBe(204)
    expect(rows.RestaurantOrderItems.find((l) => l.id === 'l-open')).toBeUndefined()
  })

  it('waiter NO quita una línea de una comanda sent → 409 (se anula con motivo, #207) y la línea sigue', async () => {
    const { router, auth, rows } = mount()
    const res = await router.resolve('DELETE', '/api/restaurant/orders/o-sent/items/l-sent', { headers: headers(auth, 'waiter') })
    expect(res.status).toBe(409)
    expect(rows.RestaurantOrderItems.find((l) => l.id === 'l-sent')).toBeDefined()
  })

  it('hotel_admin tampoco BORRA de una comanda sent → 409: el camino es POST .../void con motivo (#207)', async () => {
    const { router, auth, rows } = mount()
    const res = await router.resolve('DELETE', '/api/restaurant/orders/o-sent/items/l-sent', { headers: headers(auth, 'hotel_admin') })
    expect(res.status).toBe(409)
    expect(rows.RestaurantOrderItems.find((l) => l.id === 'l-sent')).toBeDefined()
  })

  it('waiter (sin restaurant:delete) NO anula con motivo → 403; hotel_admin sí → 200 y la línea queda voided', async () => {
    const { router, auth, rows } = mount()
    const denied = await router.resolve('POST', '/api/restaurant/orders/o-sent/items/l-sent/void', { headers: headers(auth, 'waiter'), body: { reason: 'Sin stock' } })
    expect(denied.status).toBe(403)
    expect(rows.RestaurantOrderItems.find((l) => l.id === 'l-sent')?.status).toBe('new')
    const ok = await router.resolve('POST', '/api/restaurant/orders/o-sent/items/l-sent/void', { headers: headers(auth, 'hotel_admin'), body: { reason: 'Sin stock' } })
    expect(ok.status).toBe(200)
    const line = rows.RestaurantOrderItems.find((l) => l.id === 'l-sent')
    expect(line?.status).toBe('voided')
    expect(line?.voidReason).toBe('Sin stock')
  })

  it('kitchen (restaurant:edit, sin create) NO quita una línea ni de una comanda open → 403', async () => {
    const { router, auth, rows } = mount()
    const res = await router.resolve('DELETE', '/api/restaurant/orders/o-open/items/l-open', { headers: headers(auth, 'kitchen') })
    expect(res.status).toBe(403)
    expect(rows.RestaurantOrderItems.find((l) => l.id === 'l-open')).toBeDefined()
  })
})

describe('fila de roles real (lo que prod tenía antes del deploy) — sin backfill 403, con backfill 200', () => {
  const legacyWaiter = () => ({
    id: 'role-waiter', hotelId: 'h1', name: 'waiter', system: 0,
    // Lista explícita que signup.ts sembró antes de #205: view/create/edit, sin pay.
    permissions: ['restaurant:view', 'restaurant:create', 'restaurant:edit', 'attendance:view', 'attendance:create'],
  })

  it('waiter con la fila vieja: cobrar → 403 aunque el mapa estático ya traiga pay (la fila manda)', async () => {
    const { router, auth, recorded } = mount([legacyWaiter()])
    const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, 'waiter'), body: { method: 'cash' } })
    expect(res.status).toBe(403)
    expect(recorded).toHaveLength(0)
  })

  it('la misma fila pasada por payPermissionsFor (lo que escribe migrate-db.ts) → cobra 200', async () => {
    const { payPermissionsFor } = await import('../../../../scripts/backfill-restaurant-pay-permission')
    const row = legacyWaiter()
    const next = payPermissionsFor(row.name, JSON.stringify(row.permissions))
    expect(next).not.toBeNull()
    const { router, auth, recorded } = mount([{ ...row, permissions: next }])
    const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, 'waiter'), body: { method: 'cash' } })
    expect(res.status).toBe(200)
    expect(recorded).toHaveLength(1)
  })

  it('kitchen con su fila real (view/edit) sigue sin cobrar: el backfill no le agrega pay', async () => {
    const { payPermissionsFor } = await import('../../../../scripts/backfill-restaurant-pay-permission')
    const kitchenPerms = ['restaurant:view', 'restaurant:edit', 'attendance:view', 'attendance:create']
    expect(payPermissionsFor('kitchen', JSON.stringify(kitchenPerms))).toBeNull()
    const { router, auth } = mount([{ id: 'role-kitchen', hotelId: 'h1', name: 'kitchen', system: 0, permissions: kitchenPerms }])
    const res = await router.resolve('POST', '/api/restaurant/orders/o-sent/pay', { headers: headers(auth, 'kitchen'), body: { method: 'cash' } })
    expect(res.status).toBe(403)
  })
})

describe('mapa de permisos — restaurant:pay por rol', () => {
  it('hotel_admin, receptionist y waiter tienen restaurant:pay; kitchen no', async () => {
    const { DEFAULT_ROLE_PERMISSIONS, hasPermission, MODULE_ACTIONS } = await import('../../../shared/permissions')
    for (const role of ['hotel_admin', 'receptionist', 'waiter']) {
      expect(hasPermission(DEFAULT_ROLE_PERMISSIONS[role], 'restaurant', 'pay')).toBe(true)
    }
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS.kitchen, 'restaurant', 'pay')).toBe(false)
    // La matriz de roles del panel (GET /api/roles/catalog) ofrece la casilla: sin esto un rol
    // custom no podría cobrar nunca.
    expect(MODULE_ACTIONS.restaurant).toContain('pay')
  })
})
