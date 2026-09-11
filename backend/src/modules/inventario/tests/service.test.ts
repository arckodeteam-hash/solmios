// inventario/tests/service.test.ts — Tests del servicio de inventario (INV-0/1/2).
// Usa RepositoryAdapter mock con estado — sin SQLite/Postgres.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { InventarioService } from '../service'
import { consumeForSale } from '../usecases/recipes'
import type { InventoryItemDTO, StockMovementDTO, CurrentUser } from '../types'

const log = silentLogger()
const passAuth: Auth = { assertOwnership: () => {}, authenticate: (() => []) as any } as unknown as Auth
const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const user: CurrentUser = { id: 'u1', hotelId: 'h1', role: 'hotel_admin' }

function makeRepo<T extends object>(overrides: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data: any) => ({ id: 'gen-id', ...data }),
    update: async (id: any, data: any) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
    ...overrides,
  } as RepositoryAdapter<T>
}
function makeUserRepo(hotelId = 'h1'): RepositoryAdapter<any> {
  return { ...makeRepo<any>(), findById: async () => ({ id: 'u1', hotelId }) }
}
function backed<T extends object>(store: any[], seed: any[] = []): RepositoryAdapter<T> {
  store.push(...seed)
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  let n = 0
  return {
    ...makeRepo<any>(),
    create: async (d: any) => { const row = { id: `gen${++n}`, ...d }; store.push(row); return row },
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    update: async (id: any, d: any) => { const r = store.find((x) => x.id === id); if (r) Object.assign(r, d); return r ?? null },
    delete: async (id: any) => { const i = store.findIndex((x) => x.id === id); if (i >= 0) { store.splice(i, 1); return true } return false },
  } as RepositoryAdapter<T>
}

function svc(itemsStore: any[], movStore: any[], auth: Auth = passAuth, userHotel = 'h1', recipesStore: any[] = []) {
  return new InventarioService(
    backed<InventoryItemDTO>(itemsStore), backed<StockMovementDTO>(movStore),
    makeUserRepo(userHotel), log, auth, backed<any>(recipesStore),
  )
}

describe('InventarioService — ítems (INV-1)', () => {
  it('crea un insumo forzando hotelId del JWT, stock 0, costo 0', async () => {
    const items: any[] = []
    const it = await svc(items, []).createItem({ name: 'Tomate', category: 'food', unit: 'kg', minStock: 5 }, user)
    expect(it.hotelId).toBe('h1')
    expect(it.currentStock).toBe(0)
    expect(it.avgCost).toBe(0)
    expect(it.category).toBe('food')
    expect(it.minStock).toBe(5)
  })

  it('rechaza insumo sin nombre', async () => {
    await expect(svc([], []).createItem({ name: '   ' }, user)).rejects.toThrow()
  })

  it('categoría inválida cae a supply', async () => {
    const it = await svc([], []).createItem({ name: 'Servilletas', category: 'zzz' }, user)
    expect(it.category).toBe('supply')
  })

  it('lista filtra por categoría y por bajo-mínimo', async () => {
    const items = [
      { id: 'a', hotelId: 'h1', name: 'Ron', category: 'beverage', currentStock: 2, minStock: 10 },
      { id: 'b', hotelId: 'h1', name: 'Pan', category: 'food', currentStock: 20, minStock: 5 },
    ]
    const s = svc(items, [])
    expect((await s.listItems({ category: 'beverage' }, user)).total).toBe(1)
    expect((await s.listItems({ belowMin: true }, user)).data.map((i) => i.id)).toEqual(['a'])
  })
})

describe('InventarioService — ledger de stock (INV-2)', () => {
  it('entrada suma stock y calcula costo promedio ponderado', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 0, avgCost: 0 }]
    const movStore: any[] = []
    const s = svc(items, movStore)
    // 10 @ $2  → stock 10, avg 2
    let it = await s.moveStock('i1', { type: 'in', quantity: 10, unitCost: 2 }, user)
    expect(it.currentStock).toBe(10)
    expect(it.avgCost).toBe(2)
    // + 10 @ $4 → stock 20, avg (10*2 + 10*4)/20 = 3
    it = await s.moveStock('i1', { type: 'in', quantity: 10, unitCost: 4 }, user)
    expect(it.currentStock).toBe(20)
    expect(it.avgCost).toBe(3)
    // el ledger dejó 2 movimientos con balanceAfter
    expect(movStore.length).toBe(2)
    expect(movStore[1].balanceAfter).toBe(20)
  })

  it('salida resta (permite negativo, no bloquea la venta)', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 3, avgCost: 5 }]
    const s = svc(items, [])
    const it = await s.moveStock('i1', { type: 'out', quantity: 5 }, user)
    expect(it.currentStock).toBe(-2)
    expect(it.avgCost).toBe(5)   // salida no toca el costo
  })

  it('ajuste fija el stock absoluto (conteo físico) sin tocar el costo', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 20, avgCost: 3 }]
    const s = svc(items, [])
    const it = await s.moveStock('i1', { type: 'adjust', quantity: 18 }, user)
    expect(it.currentStock).toBe(18)
    expect(it.avgCost).toBe(3)
  })

  it('idempotente: mismo (source,sourceId) NO reaplica', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 0, avgCost: 0 }]
    const movStore: any[] = []
    const s = svc(items, movStore)
    await s.applyExternalMovement({ itemId: 'i1', type: 'in', quantity: 10, unitCost: 2, source: 'purchase_receipt', sourceId: 'r1' }, user)
    // reintento con la misma clave → no suma de nuevo
    const it = await s.applyExternalMovement({ itemId: 'i1', type: 'in', quantity: 10, unitCost: 2, source: 'purchase_receipt', sourceId: 'r1' }, user)
    expect(it.currentStock).toBe(10)   // sigue en 10, no 20
    expect(movStore.length).toBe(1)
  })

  it('IDOR: mover stock de un insumo de otro hotel es inaccesible', async () => {
    const items = [{ id: 'i1', hotelId: 'OTRO', name: 'Ron', currentStock: 0, avgCost: 0 }]
    const s = svc(items, [], strictAuth)
    await expect(s.moveStock('i1', { type: 'in', quantity: 1, unitCost: 1 }, user)).rejects.toThrow('IDOR')
  })

  it('valuación = Σ stock × costo promedio', async () => {
    const items = [
      { id: 'a', hotelId: 'h1', name: 'Ron', currentStock: 10, avgCost: 3 },
      { id: 'b', hotelId: 'h1', name: 'Pan', currentStock: 5, avgCost: 2 },
    ]
    const v = await svc(items, []).valuation(user)
    expect(v.total).toBe(40)   // 10*3 + 5*2
    expect(v.items).toBe(2)
  })

  it('QA-A1: entrada tras stock NEGATIVO no corrompe el costo (base = max(cur,0))', async () => {
    // oversold: stock -5, avg 10. Entra 10 @ $2. El tramo negativo NO aporta costo → avg = 2 (no -6).
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: -5, avgCost: 10 }]
    const s = svc(items, [])
    const it = await s.moveStock('i1', { type: 'in', quantity: 10, unitCost: 2 }, user)
    expect(it.currentStock).toBe(5)
    expect(it.avgCost).toBe(2)   // antes del fix daba -6 (costo negativo)
  })

  it('QA-A1b: entrada tras negativo con avg 0 no sobrevalúa (avg = unitCost)', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: -5, avgCost: 0 }]
    const s = svc(items, [])
    const it = await s.moveStock('i1', { type: 'in', quantity: 10, unitCost: 2 }, user)
    expect(it.avgCost).toBe(2)   // antes del fix daba 4 (2× sobrevaluado)
  })

  it('QA-M1: unitCost no finito o negativo se rechaza', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 0, avgCost: 0 }]
    const s = svc(items, [])
    await expect(s.moveStock('i1', { type: 'in', quantity: 1, unitCost: Infinity }, user)).rejects.toThrow()
    await expect(s.moveStock('i1', { type: 'in', quantity: 1, unitCost: -3 }, user)).rejects.toThrow()
  })

  it('QA-M2: costo 0 explícito DILUYE el promedio; sin costo (undefined) NO lo toca', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 10, avgCost: 5 }]
    const s = svc(items, [])
    // sin unitCost → avg intacto
    let it = await s.moveStock('i1', { type: 'in', quantity: 10 }, user)
    expect(it.avgCost).toBe(5)
    expect(it.currentStock).toBe(20)
    // costo 0 explícito (cortesía/muestra) → diluye: (20*5 + 10*0)/30 = 3.3333
    it = await s.moveStock('i1', { type: 'in', quantity: 10, unitCost: 0 }, user)
    expect(it.currentStock).toBe(30)
    expect(it.avgCost).toBeCloseTo(3.3333, 3)
  })

  it('historial de movimientos ordenado (más reciente primero)', async () => {
    const items = [{ id: 'i1', hotelId: 'h1', name: 'Ron', currentStock: 0, avgCost: 0 }]
    const movStore: any[] = []
    const s = svc(items, movStore)
    await s.moveStock('i1', { type: 'in', quantity: 5, unitCost: 1 }, user)
    const h = await s.listMovements('i1', user)
    expect(h.total).toBe(1)
    expect(h.data[0].balanceAfter).toBe(5)
  })
})

describe('InventarioService — recetas + consumo por venta (INT-1)', () => {
  it('setRecipe hace upsert; quantity 0 elimina', async () => {
    const items = [{ id: 'inv1', hotelId: 'h1', name: 'Ron' }]
    const recipes: any[] = []
    const s = svc(items, [], passAuth, 'h1', recipes)
    await s.setRecipe({ menuItemId: 'm1', inventoryItemId: 'inv1', quantity: 0.05 }, user)
    expect(recipes.length).toBe(1)
    await s.setRecipe({ menuItemId: 'm1', inventoryItemId: 'inv1', quantity: 0.06 }, user)
    expect(recipes.length).toBe(1)          // upsert, no duplica
    expect(recipes[0].quantity).toBe(0.06)
    await s.setRecipe({ menuItemId: 'm1', inventoryItemId: 'inv1', quantity: 0 }, user)
    expect(recipes.length).toBe(0)          // 0 elimina
  })

  it('#208 deleteRecipesOfMenuItem: borra TODAS las filas del ítem en ese hotel y solo esas', async () => {
    const recipes: any[] = [
      { id: 'r1', hotelId: 'h1', menuItemId: 'm1', inventoryItemId: 'inv1', quantity: 0.05 },
      { id: 'r2', hotelId: 'h1', menuItemId: 'm1', inventoryItemId: 'inv2', quantity: 0.2 },
      { id: 'r3', hotelId: 'h1', menuItemId: 'm2', inventoryItemId: 'inv1', quantity: 1 },
      { id: 'r4', hotelId: 'h2', menuItemId: 'm1', inventoryItemId: 'inv9', quantity: 1 },
    ]
    const s = svc([], [], passAuth, 'h1', recipes)
    expect(await s.deleteRecipesOfMenuItem({ hotelId: 'h1', menuItemId: 'm1' })).toBe(2)
    expect(recipes.map((r) => r.id)).toEqual(['r3', 'r4'])
    expect(await s.deleteRecipesOfMenuItem({ hotelId: 'h1', menuItemId: 'm1' })).toBe(0)   // idempotente
    await expect(s.deleteRecipesOfMenuItem({ hotelId: '', menuItemId: 'm1' })).rejects.toThrow('requeridos')
  })

  it('venta descuenta stock según la receta (idempotente por línea)', async () => {
    // 1 trago "Cuba Libre" (m1) consume 0.05 botella de Ron (inv1) + 0.2 de Coca (inv2).
    const items = [
      { id: 'inv1', hotelId: 'h1', name: 'Ron', currentStock: 10, avgCost: 5 },
      { id: 'inv2', hotelId: 'h1', name: 'Coca', currentStock: 20, avgCost: 1 },
    ]
    const recipes = [
      { id: 'r1', hotelId: 'h1', menuItemId: 'm1', inventoryItemId: 'inv1', quantity: 0.05 },
      { id: 'r2', hotelId: 'h1', menuItemId: 'm1', inventoryItemId: 'inv2', quantity: 0.2 },
    ]
    const s = svc(items, [], passAuth, 'h1', recipes)
    const sys = { id: 'system', hotelId: 'h1', role: 'super_admin' }
    // venden 3 Cuba Libre en la línea L1
    await s.consumeForSale({ hotelId: 'h1', menuItemId: 'm1', soldQty: 3, lineId: 'L1' }, sys)
    expect(items.find((i) => i.id === 'inv1')!.currentStock).toBe(9.85)   // 10 - 3*0.05
    expect(items.find((i) => i.id === 'inv2')!.currentStock).toBe(19.4)   // 20 - 3*0.2
    // reintento de la MISMA línea → no vuelve a descontar (dedup por lineId)
    await s.consumeForSale({ hotelId: 'h1', menuItemId: 'm1', soldQty: 3, lineId: 'L1' }, sys)
    expect(items.find((i) => i.id === 'inv1')!.currentStock).toBe(9.85)
  })

  it('ítem de menú sin receta no descuenta nada', async () => {
    const items = [{ id: 'inv1', hotelId: 'h1', name: 'Ron', currentStock: 10, avgCost: 5 }]
    const s = svc(items, [], passAuth, 'h1', [])
    const sys = { id: 'system', hotelId: 'h1', role: 'super_admin' }
    await s.consumeForSale({ hotelId: 'h1', menuItemId: 'sin-receta', soldQty: 5, lineId: 'L9' }, sys)
    expect(items[0].currentStock).toBe(10)   // intacto
  })

  it('ítem de menú sin receta AVISA con logger.warn (stock fantasma visible)', async () => {
    // FIX recetas-stock-warning: antes el descuento omitido era silencioso; ahora emite un warn con
    // hotelId/menuItemId/lineId/soldQty para que se sepa qué platos faltan recetar.
    const warnings: any[] = []
    const spyLogger = { warn: (m: string, ctx?: any) => warnings.push({ m, ctx }), info() {}, error() {}, debug() {} } as any
    const deps = {
      recipes: { findMany: async () => [] } as any,
      items: makeRepo<InventoryItemDTO>(),
      movements: makeRepo<StockMovementDTO>(),
      userRepo: makeUserRepo('h1'),
      auth: passAuth,
      logger: spyLogger,
    } as any
    const sys = { id: 'system', hotelId: 'h1', role: 'super_admin' } as CurrentUser
    await consumeForSale(deps, { hotelId: 'h1', menuItemId: 'sin-receta', soldQty: 5, lineId: 'L9' }, sys)
    expect(warnings.length).toBe(1)
    expect(warnings[0].ctx.menuItemId).toBe('sin-receta')
    expect(warnings[0].ctx.soldQty).toBe(5)
  })
})
