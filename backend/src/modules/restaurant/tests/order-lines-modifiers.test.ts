// restaurant/tests/order-lines-modifiers.test.ts — addLine con modificadores (F1).
// Cubre los scenarios de specs/menu-modifiers/spec.md: precio final ajustado, descuento negativo,
// grupo required sin selección rechaza, y snapshot inmutable tras editar/borrar el modificador.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { addLine, updateLine, type OrderLinesDeps } from '../usecases/order-lines'
import type { OrderDTO, OrderItemDTO, MenuItemDTO, CategoryDTO, StationDTO, ModifierGroupDTO, ModifierDTO, CurrentUser } from '../types'

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

// Setup: comanda abierta o1, ítem "Hamburguesa" ($250), grupo "Tamaño" (single) con opciones
// Chico(+0)/Grande(+50), grupo "Extras" (multiple, opcional) con +tocino(+80).
function setup(opts: { requiredSize?: boolean } = {}) {
  const ordersStore: any[] = [{ id: 'o1', hotelId: 'h1', status: 'open', tip: 0, subtotal: 0, tax: 0, total: 0 }]
  const linesStore: any[] = []
  const groupsStore: any[] = [
    { id: 'gSize', hotelId: 'h1', menuItemId: 'm1', name: 'Tamaño', selectionType: 'single', required: opts.requiredSize ? 1 : 0, minSelect: 1 },
    { id: 'gExtras', hotelId: 'h1', menuItemId: 'm1', name: 'Extras', selectionType: 'multiple', required: 0, minSelect: 1 },
  ]
  const modifiersStore: any[] = [
    { id: 'oChico', hotelId: 'h1', groupId: 'gSize', name: 'Chico', priceDelta: 0 },
    { id: 'oGrande', hotelId: 'h1', groupId: 'gSize', name: 'Grande', priceDelta: 50 },
    { id: 'oTocino', hotelId: 'h1', groupId: 'gExtras', name: '+tocino', priceDelta: 80 },
    { id: 'oSinPapas', hotelId: 'h1', groupId: 'gExtras', name: 'Sin papas', priceDelta: -30 },
  ]
  const items = makeRepo<MenuItemDTO>({ findOne: async () => ({ id: 'm1', hotelId: 'h1', name: 'Hamburguesa', price: 250, categoryId: 'c1', available: 1 } as MenuItemDTO) })
  const stations = makeRepo<StationDTO>({ findMany: async () => [], findOne: async () => null })
  const categories = makeRepo<CategoryDTO>({ findOne: async () => ({ id: 'c1', hotelId: 'h1', name: 'Platos' } as CategoryDTO) })
  const config = makeRepo<any>({ findOne: async () => null })
  const hotels = makeRepo<any>({ findById: async () => ({ id: 'h1', taxRate: 0 }) })

  const deps: OrderLinesDeps = {
    orders: backed<OrderDTO>(ordersStore),
    lines: backed<OrderItemDTO>(linesStore),
    items, categories, stations, config, hotels,
    userRepo: makeUserRepo(), auth: strictAuth,
    modifierGroups: backed<ModifierGroupDTO>(groupsStore),
    modifiers: backed<ModifierDTO>(modifiersStore),
  }
  return { deps, ordersStore, linesStore, groupsStore, modifiersStore }
}

describe('addLine — modificadores (F1)', () => {
  it('precio final refleja el modificador: (250+50)×2 = 600', async () => {
    const { deps } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 2, modifiers: [{ modifierId: 'oGrande' }] }, user)
    expect(line.unitPrice).toBe(250)
    expect(line.lineTotal).toBe(600)
    expect(line.modifiers).toEqual([{ groupId: 'gSize', groupName: 'Tamaño', modifierId: 'oGrande', name: 'Grande', priceDelta: 50, inventoryItemId: undefined, inventoryQuantity: undefined }])
  })

  it('modificador con priceDelta negativo resta del total', async () => {
    const { deps } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'oSinPapas' }] }, user)
    expect(line.lineTotal).toBe(220)   // 250 - 30
  })

  it('grupo opcional (multiple, required=false): sin elegir, la línea se crea sin ajuste de ese grupo', async () => {
    const { deps } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1 }, user)
    expect(line.lineTotal).toBe(250)
    expect(line.modifiers).toBeNull()
  })

  it('grupo required sin selección se rechaza (400), la línea NO se crea', async () => {
    const { deps, linesStore } = setup({ requiredSize: true })
    await expect(addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1 }, user)).rejects.toThrow('Tamaño')
    expect(linesStore.length).toBe(0)
  })

  it('grupo single con más de una opción elegida se rechaza', async () => {
    const { deps } = setup()
    await expect(addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'oChico' }, { modifierId: 'oGrande' }] }, user)).rejects.toThrow('una sola opción')
  })

  it('modificador de otro hotel o inexistente se rechaza', async () => {
    const { deps } = setup()
    await expect(addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'no-existe' }] }, user)).rejects.toThrow()
  })

  it('editar el modificador después de vendido no cambia la línea ya creada (snapshot inmutable)', async () => {
    const { deps, modifiersStore } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'oGrande' }] }, user)
    expect(line.lineTotal).toBe(300)

    // El admin cambia el priceDelta de "Grande" de 50 a 70 en la carta.
    const grande = modifiersStore.find((m) => m.id === 'oGrande')
    grande.priceDelta = 70

    expect(line.lineTotal).toBe(300)   // no cambia retroactivamente
    expect((line.modifiers as any)[0].priceDelta).toBe(50)
  })

  it('borrar el modificador después de vendido no rompe la comanda (snapshot conserva nombre y ajuste)', async () => {
    const { deps, modifiersStore } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'oGrande' }] }, user)

    const idx = modifiersStore.findIndex((m) => m.id === 'oGrande')
    modifiersStore.splice(idx, 1)   // borra la opción de la carta

    expect((line.modifiers as any)[0].name).toBe('Grande')
    expect((line.modifiers as any)[0].priceDelta).toBe(50)
    expect(line.lineTotal).toBe(300)
  })
})

// #206 (REST-04) — bug de dinero: al cambiar la cantidad, `updateLine` recalculaba
// `unitPrice * quantity` SIN el recargo de los modificadores snapshoteados en la línea.
describe('updateLine — conserva el recargo de los modificadores (#206)', () => {
  it('cantidad 1→2 con Grande(+50): lineTotal pasa de 300 a 600 y el total de la comanda coincide', async () => {
    const { deps, ordersStore } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'oGrande' }] }, user)
    expect(line.lineTotal).toBe(300)
    expect(ordersStore[0].total).toBe(300)

    const updated = await updateLine(deps, 'o1', line.id, { quantity: 2 }, user)
    expect(updated.quantity).toBe(2)
    expect(updated.unitPrice).toBe(250)        // el snapshot neto no cambia
    expect(updated.lineTotal).toBe(600)        // (250 + 50) × 2, NO 250 × 2
    expect(ordersStore[0].subtotal).toBe(600)
    expect(ordersStore[0].total).toBe(600)     // taxRate 0 en este setup
  })

  it('varios modificadores (Grande +50, +tocino +80, Sin papas -30): 1→3 = (250+100)×3', async () => {
    const { deps, ordersStore } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1, modifiers: [{ modifierId: 'oGrande' }, { modifierId: 'oTocino' }, { modifierId: 'oSinPapas' }] }, user)
    expect(line.lineTotal).toBe(350)
    const updated = await updateLine(deps, 'o1', line.id, { quantity: 3 }, user)
    expect(updated.lineTotal).toBe(1050)
    expect(ordersStore[0].total).toBe(1050)
  })

  it('cambiar solo notes no altera lineTotal ni el total de la comanda', async () => {
    const { deps, ordersStore } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 2, modifiers: [{ modifierId: 'oGrande' }] }, user)
    expect(line.lineTotal).toBe(600)
    const updated = await updateLine(deps, 'o1', line.id, { notes: 'sin sal' }, user)
    expect(updated.notes).toBe('sin sal')
    expect(updated.quantity).toBe(2)
    expect(updated.lineTotal).toBe(600)
    expect(ordersStore[0].total).toBe(600)
  })

  it('línea sin modificadores: 1→2 sigue siendo unitPrice × quantity', async () => {
    const { deps } = setup()
    const line = await addLine(deps, 'o1', { menuItemId: 'm1', quantity: 1 }, user)
    const updated = await updateLine(deps, 'o1', line.id, { quantity: 2 }, user)
    expect(updated.lineTotal).toBe(500)
  })
})
