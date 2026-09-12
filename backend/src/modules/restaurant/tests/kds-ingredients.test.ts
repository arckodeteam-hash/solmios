// restaurant/tests/kds-ingredients.test.ts — Tablero de cocina con receta: la cola trae los
// ingredientes de cada plato (una llamada al puerto para toda la cola) y cocina puede quitar/agregar
// ingredientes sobre una línea viva sin tocar precio ni estado. Un plato servido/anulado o una
// comanda fuera de cocina rechazan el cambio; otro hotel no puede tocar la línea.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { RestaurantService } from '../service'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser, StationDTO, CategoryDTO, MenuItemDTO } from '../types'
import { normalizeIngredientChanges } from '../usecases/kds'

const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const cook: CurrentUser = { id: 'u-cocina', hotelId: 'h1', role: 'kitchen' }
const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return log } } as unknown as Logger

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
function backed<T extends object>(store: any[]): RepositoryAdapter<T> {
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    ...makeRepo<any>(),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
    update: async (id: any, d: any) => { const r = store.find((x) => x.id === id); if (r) Object.assign(r, d); return r ?? null },
  } as RepositoryAdapter<T>
}

function setup(orderStatus: OrderDTO['status'] = 'preparing', userHotel = 'h1') {
  const ordersStore: any[] = [{ id: 'o1', hotelId: 'h1', number: 'CMD-1', tableId: 't1', type: 'dine_in', status: orderStatus, openedAt: '2026-09-12T12:00:00.000Z' }]
  const linesStore: any[] = [
    { id: 'l1', hotelId: 'h1', orderId: 'o1', menuItemId: 'm1', name: 'Pizza', unitPrice: 10, quantity: 1, lineTotal: 10, status: 'preparing', stationId: 'st1', sentAt: '2026-09-12T12:01:00.000Z' },
    { id: 'l2', hotelId: 'h1', orderId: 'o1', menuItemId: 'm2', name: 'Agua', unitPrice: 5, quantity: 1, lineTotal: 5, status: 'served', stationId: 'st1', sentAt: '2026-09-12T12:01:00.000Z' },
  ]
  const portCalls: string[][] = []
  const events: OrderItemDTO[] = []
  const svc = new RestaurantService(
    makeRepo<StationDTO>(), makeRepo<CategoryDTO>(), makeRepo<MenuItemDTO>(), backed<TableDTO>([{ id: 't1', hotelId: 'h1', name: 'M1', zone: 'Terraza' }]),
    { ...makeRepo<any>(), findById: async () => ({ id: cook.id, hotelId: userHotel }) }, log, strictAuth,
    backed<OrderDTO>(ordersStore), backed<OrderItemDTO>(linesStore), makeRepo<any>(), makeRepo<any>(),
  )
  svc.setRecipePorts({
    getRecipeIngredients: async (ids) => { portCalls.push(ids); return { m1: [{ name: 'Harina', quantity: 0.2, unit: 'kg' }, { name: 'Queso', quantity: 0.1, unit: 'kg' }] } },
  })
  svc.setSockets({ onLineStatusChanged: async (l) => { events.push(l) } })
  return { svc, ordersStore, linesStore, portCalls, events }
}

describe('KDS con receta — la cola trae los ingredientes de cada plato', () => {
  it('una sola llamada al puerto con los ítems de la cola; el plato con receta la trae, el resto no', async () => {
    const { svc, portCalls, linesStore } = setup()
    linesStore[1].status = 'new'   // las dos en cola
    const { data } = await svc.kdsQueue(undefined, cook)
    expect(portCalls).toEqual([['m1', 'm2']])
    const pizza = data[0].lines.find((l) => l.id === 'l1')!
    const agua = data[0].lines.find((l) => l.id === 'l2')!
    expect(pizza.ingredients?.map((i) => i.name)).toEqual(['Harina', 'Queso'])
    expect(agua.ingredients).toBeUndefined()
  })

  it('sin puerto (inventario apagado) la cola sale igual, sin ingredientes', async () => {
    const { svc } = setup()
    svc.setRecipePorts({ getRecipeIngredients: undefined })
    const { data } = await svc.kdsQueue(undefined, cook)
    expect(data[0].lines[0].ingredients).toBeUndefined()
  })
})

describe('KDS con receta — cocina quita/agrega ingredientes', () => {
  it('normaliza: recorta, saca vacíos y repetidos (sin distinguir mayúsculas), ignora lo que no es string', () => {
    expect(normalizeIngredientChanges({ removed: [' Cebolla ', 'cebolla', '', 7, 'Ajo'], added: ['Queso extra'] }))
      .toEqual({ removed: ['Cebolla', 'Ajo'], added: ['Queso extra'] })
    expect(normalizeIngredientChanges(undefined)).toEqual({ removed: [], added: [] })
  })

  it('persiste el cambio en la línea viva, no toca precio ni estado y avisa por el canal en vivo', async () => {
    const { svc, linesStore, events } = setup()
    const updated = await svc.setLineIngredients('l1', { removed: ['Queso'], added: ['Aceitunas'] }, cook)
    expect(updated.ingredientChanges).toEqual({ removed: ['Queso'], added: ['Aceitunas'] })
    expect(linesStore[0].ingredientChanges).toEqual({ removed: ['Queso'], added: ['Aceitunas'] })
    expect(linesStore[0].status).toBe('preparing')
    expect(linesStore[0].lineTotal).toBe(10)
    expect(events.map((e) => e.id)).toEqual(['l1'])
  })

  it('listas vacías = volver a la receta tal cual (null en la fila)', async () => {
    const { svc, linesStore } = setup()
    linesStore[0].ingredientChanges = { removed: ['Queso'], added: [] }
    await svc.setLineIngredients('l1', { removed: [], added: [] }, cook)
    expect(linesStore[0].ingredientChanges).toBeNull()
  })

  it('un plato ya servido → rechaza; una comanda fuera de cocina → rechaza; línea inexistente → 404', async () => {
    const { svc } = setup()
    await expect(svc.setLineIngredients('l2', { removed: ['x'] }, cook)).rejects.toThrow('ya no está en cocina')
    const paid = setup('paid')
    await expect(paid.svc.setLineIngredients('l1', { removed: ['x'] }, cook)).rejects.toThrow('ya no está en cocina')
    await expect(svc.setLineIngredients('nope', { removed: ['x'] }, cook)).rejects.toThrow('no encontrada')
  })

  it('un usuario de otro hotel no toca la línea (IDOR)', async () => {
    const { svc, linesStore } = setup('preparing', 'h2')
    await expect(svc.setLineIngredients('l1', { removed: ['Queso'] }, { ...cook, hotelId: 'h2' })).rejects.toThrow('IDOR')
    expect(linesStore[0].ingredientChanges).toBeUndefined()
  })
})
