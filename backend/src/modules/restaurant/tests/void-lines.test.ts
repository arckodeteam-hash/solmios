// restaurant/tests/void-lines.test.ts — #207: anular línea/comanda con motivo y auditoría.
// Cubre los criterios de aceptación del issue: void sin motivo → 400; con motivo → `voided`, sale del
// KDS y baja el total; DELETE de una línea enviada → 409; cancelar sin motivo → 400; con motivo →
// mesa libre + fila `restaurant.order.cancelled` en el audit log; cocina NO cancela de un toque;
// totales excluyen `voided`; reembolso audita.
import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import { RestaurantService } from '../service'
import type { OrderDTO, OrderItemDTO, TableDTO, CurrentUser, StationDTO, CategoryDTO, MenuItemDTO } from '../types'
import type { AuditEntry } from '../../../shared/usecases/audit'
import { DEFAULT_VOID_REASONS, normalizeReasons } from '../usecases/void-reasons'

const strictAuth: Auth = {
  assertOwnership: (resourceHotel: string, userHotel: string, role?: string, sa?: string) => {
    if (role === sa) return
    if (resourceHotel !== userHotel) throw new Error('IDOR: recurso de otro hotel')
  },
  authenticate: (() => []) as any,
} as unknown as Auth
const user: CurrentUser = { id: 'u-mozo', hotelId: 'h1', role: 'hotel_admin' }
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

// Comanda o1 en mesa t1, ya enviada a cocina, con dos líneas: Pizza (2×10) y Agua (1×5), IVA 18%.
function setup(orderStatus: OrderDTO['status'] = 'preparing') {
  const ordersStore: any[] = [{ id: 'o1', hotelId: 'h1', number: 'CMD-1', tableId: 't1', status: orderStatus, tip: 0, subtotal: 25, tax: 4.5, total: 29.5 }]
  const linesStore: any[] = [
    { id: 'l1', hotelId: 'h1', orderId: 'o1', menuItemId: 'm1', name: 'Pizza', unitPrice: 10, quantity: 2, taxRate: 18, lineTotal: 20, status: 'preparing', stationId: 'st1' },
    { id: 'l2', hotelId: 'h1', orderId: 'o1', menuItemId: 'm2', name: 'Agua', unitPrice: 5, quantity: 1, taxRate: 18, lineTotal: 5, status: 'new', stationId: 'st1' },
  ]
  const tablesStore: any[] = [{ id: 't1', hotelId: 'h1', name: 'M1', status: 'occupied' }]
  const audit: AuditEntry[] = []
  const configStore: any[] = []
  const svc = new RestaurantService(
    makeRepo<StationDTO>(), makeRepo<CategoryDTO>(), makeRepo<MenuItemDTO>(), backed<TableDTO>(tablesStore),
    { ...makeRepo<any>(), findById: async () => ({ id: user.id, hotelId: 'h1' }) }, log, strictAuth,
    backed<OrderDTO>(ordersStore), backed<OrderItemDTO>(linesStore), backed<any>(configStore), makeRepo<any>(),
  )
  svc.setAuditDeps({ record: async (e) => { audit.push(e) } })
  return { svc, ordersStore, linesStore, tablesStore, audit, configStore }
}

describe('#207 voidLine — anular una línea enviada con motivo', () => {
  it('sin motivo → ValidationError (400) y no toca nada', async () => {
    const { svc, linesStore, audit } = setup()
    await expect(svc.voidLine('o1', 'l1', '', user)).rejects.toThrow('motivo')
    await expect(svc.voidLine('o1', 'l1', '   ', user)).rejects.toThrow('motivo')
    expect(linesStore[0].status).toBe('preparing')
    expect(audit.length).toBe(0)
  })

  it('con motivo → voided con quién/cuándo, baja el total, sale del KDS y audita con el monto', async () => {
    const { svc, ordersStore, linesStore, audit } = setup()
    const line = await svc.voidLine('o1', 'l1', 'Sin stock', user)
    expect(line.status).toBe('voided')
    expect(line.voidReason).toBe('Sin stock')
    expect(line.voidedBy).toBe('u-mozo')
    expect(line.voidedAt).toBeTruthy()
    // Se conserva en la comanda (no se borró) pero no cuenta en los totales.
    expect(linesStore.find((l) => l.id === 'l1')).toBeDefined()
    expect(ordersStore[0].subtotal).toBe(5)
    expect(ordersStore[0].tax).toBe(0.9)
    expect(ordersStore[0].total).toBe(5.9)
    // Desaparece del KDS: solo queda el Agua.
    const kds = await svc.kdsQueue(undefined, user)
    expect(kds.total).toBe(1)
    expect(kds.data[0].lines.map((l) => l.id)).toEqual(['l2'])
    // Audit log con hotel, usuario, comanda, monto y motivo.
    expect(audit.length).toBe(1)
    expect(audit[0].action).toBe('restaurant.line.voided')
    expect(audit[0].hotelId).toBe('h1')
    expect(audit[0].userId).toBe('u-mozo')
    expect(audit[0].entityId).toBe('l1')
    const detail = JSON.parse(audit[0].detail!)
    expect(detail).toMatchObject({ orderId: 'o1', orderNumber: 'CMD-1', name: 'Pizza', amount: 20, reason: 'Sin stock', previousStatus: 'preparing' })
  })

  it('anular la única línea que frenaba la comanda re-deriva su estado (las demás ya listas)', async () => {
    const { svc, ordersStore, linesStore } = setup('preparing')
    linesStore[1].status = 'ready'          // Agua lista, Pizza en preparación
    await svc.voidLine('o1', 'l1', 'Cliente se arrepintió', user)
    expect(ordersStore[0].status).toBe('ready')
  })

  it('una línea ya anulada no se anula dos veces (409) y no audita de nuevo', async () => {
    const { svc, audit } = setup()
    await svc.voidLine('o1', 'l1', 'Sin stock', user)
    await expect(svc.voidLine('o1', 'l1', 'Otro', user)).rejects.toThrow('ya está anulada')
    expect(audit.length).toBe(1)
  })

  it('en una comanda open (no enviada) no se anula: se quita (409)', async () => {
    const { svc } = setup('open')
    await expect(svc.voidLine('o1', 'l1', 'Error de carga', user)).rejects.toThrow('quitala')
  })

  it('comanda liquidada → bloqueada (409), sin tocar stock ni líneas', async () => {
    const { svc, linesStore } = setup('paid')
    await expect(svc.voidLine('o1', 'l1', 'Sin stock', user)).rejects.toThrow('no admite cambios')
    expect(linesStore[0].status).toBe('preparing')
  })

  it('IDOR: una comanda de otro hotel no se anula', async () => {
    const { svc, ordersStore } = setup()
    ordersStore[0].hotelId = 'OTRO'
    await expect(svc.voidLine('o1', 'l1', 'Sin stock', user)).rejects.toThrow('IDOR')
  })

  it('un combo se anula completo: header + componentes', async () => {
    const { svc, linesStore, ordersStore } = setup()
    linesStore.push(
      { id: 'hdr', hotelId: 'h1', orderId: 'o1', kind: 'combo_header', comboId: 'cb1', name: 'Combo', unitPrice: 30, quantity: 1, taxRate: 18, lineTotal: 30, status: 'new' },
      { id: 'cmp', hotelId: 'h1', orderId: 'o1', kind: 'combo_component', parentLineId: 'hdr', menuItemId: 'm1', name: 'Pizza', unitPrice: 0, quantity: 1, taxRate: 0, lineTotal: 0, status: 'preparing', stationId: 'st1' },
    )
    await expect(svc.voidLine('o1', 'cmp', 'Sin stock', user)).rejects.toThrow('combo completo')
    await svc.voidLine('o1', 'hdr', 'Sin stock', user)
    expect(linesStore.find((l) => l.id === 'hdr')!.status).toBe('voided')
    expect(linesStore.find((l) => l.id === 'cmp')!.status).toBe('voided')
    expect(ordersStore[0].subtotal).toBe(25)   // el combo (30) ya no cuenta
  })
})

describe('#207 removeLine — borrar solo antes de enviar', () => {
  it('DELETE de una línea de una comanda enviada → 409 "anulala con motivo"', async () => {
    const { svc, linesStore } = setup('sent')
    await expect(svc.removeLine('o1', 'l2', user)).rejects.toThrow('ya fue enviada a cocina: anulala con motivo')
    expect(linesStore.length).toBe(2)
  })

  it('DELETE en una comanda open sigue borrando (error de toma)', async () => {
    const { svc, linesStore, ordersStore } = setup('open')
    await svc.removeLine('o1', 'l2', user)
    expect(linesStore.find((l) => l.id === 'l2')).toBeUndefined()
    expect(ordersStore[0].subtotal).toBe(20)
  })
})

describe('#207 cancelOrder — exige motivo, anula lo enviado y audita', () => {
  it('sin motivo → ValidationError (400); la mesa sigue ocupada', async () => {
    const { svc, tablesStore, ordersStore } = setup()
    await expect(svc.cancelOrder('o1', undefined, user)).rejects.toThrow('motivo')
    await expect(svc.cancelOrder('o1', '  ', user)).rejects.toThrow('motivo')
    expect(tablesStore[0].status).toBe('occupied')
    expect(ordersStore[0].status).toBe('preparing')
  })

  it('con motivo → mesa libre, líneas enviadas quedan voided con ese motivo, audit restaurant.order.cancelled', async () => {
    const { svc, tablesStore, linesStore, ordersStore, audit } = setup()
    const o = await svc.cancelOrder('o1', 'Cliente se arrepintió', user)
    expect(o.status).toBe('cancelled')
    expect(tablesStore[0].status).toBe('free')
    for (const l of linesStore) {
      expect(l.status).toBe('voided')
      expect(l.voidReason).toBe('Cliente se arrepintió')
      expect(l.voidedBy).toBe('u-mozo')
    }
    expect(audit.length).toBe(1)
    expect(audit[0].action).toBe('restaurant.order.cancelled')
    expect(audit[0].userId).toBe('u-mozo')
    expect(audit[0].entityId).toBe('o1')
    const detail = JSON.parse(audit[0].detail!)
    expect(detail).toMatchObject({ orderId: 'o1', reason: 'Cliente se arrepintió', amount: 29.5, voidedLines: 2, previousStatus: 'preparing' })
    // Y la cocina no la ve más.
    expect((await svc.kdsQueue(undefined, user)).total).toBe(0)
    void ordersStore
  })

  it('una comanda open (nunca enviada) se cancela sin anular líneas — fue un error de toma', async () => {
    const { svc, linesStore, audit } = setup('open')
    await svc.cancelOrder('o1', 'Error de carga', user)
    expect(linesStore.every((l) => l.status !== 'voided')).toBe(true)
    expect(JSON.parse(audit[0].detail!).voidedLines).toBe(0)
  })

  it('el audit log caído NO tumba la cancelación', async () => {
    const { svc, tablesStore } = setup()
    svc.setAuditDeps({ record: async () => { throw new Error('auditlog caído') } })
    const o = await svc.cancelOrder('o1', 'Sin stock', user)
    expect(o.status).toBe('cancelled')
    expect(tablesStore[0].status).toBe('free')
  })
})

describe('#207 KDS — cocina no cancela de un toque', () => {
  it('setLineStatus(cancelled) y (voided) se rechazan como transición inválida', async () => {
    const { svc, linesStore } = setup()
    await expect(svc.setLineStatus('l2', 'cancelled', user)).rejects.toThrow('Transición inválida')
    await expect(svc.setLineStatus('l2', 'voided' as any, user)).rejects.toThrow('Transición inválida')
    expect(linesStore[1].status).toBe('new')
  })

  it('la cola no muestra líneas voided aunque su comanda siga en cocina', async () => {
    const { svc, linesStore } = setup()
    linesStore[0].status = 'voided'
    const kds = await svc.kdsQueue(undefined, user)
    expect(kds.data[0].lines.map((l) => l.id)).toEqual(['l2'])
  })
})

describe('#207 refundOrder — audita restaurant.order.refunded', () => {
  it('registra hotel, usuario, comanda, paymentId y monto', async () => {
    const { svc, ordersStore, audit } = setup('paid')
    Object.assign(ordersStore[0], { settlement: 'payment', paymentId: 'pay1' })
    const refunded: string[] = []
    svc.setSettlementDeps({ refundPayment: async ({ paymentId }: any) => { refunded.push(paymentId) } } as any)
    const o = await svc.refundOrder('o1', user)
    expect(o.status).toBe('refunded')
    expect(refunded).toEqual(['pay1'])
    expect(audit.length).toBe(1)
    expect(audit[0].action).toBe('restaurant.order.refunded')
    expect(JSON.parse(audit[0].detail!)).toMatchObject({ orderId: 'o1', paymentId: 'pay1', amount: 29.5 })
  })
})

describe('#207 motivos predefinidos — configuration(restaurant_void_reasons)', () => {
  it('sin configurar devuelve el default', async () => {
    const { svc } = setup()
    const r = await svc.getVoidReasons(user)
    expect(r.isDefault).toBe(true)
    expect(r.reasons).toEqual([...DEFAULT_VOID_REASONS])
  })

  it('setVoidReasons persiste por hotel y getVoidReasons los devuelve', async () => {
    const { svc, configStore } = setup()
    await svc.setVoidReasons(['Sin stock', ' Se quemó ', 'sin stock', ''], user)
    expect(configStore.length).toBe(1)
    expect(configStore[0]).toMatchObject({ hotelId: 'h1', key: 'restaurant_void_reasons', value: ['Sin stock', 'Se quemó'] })
    const r = await svc.getVoidReasons(user)
    expect(r.isDefault).toBe(false)
    expect(r.reasons).toEqual(['Sin stock', 'Se quemó'])
    // Segunda escritura actualiza la misma fila (UPSERT), no crea otra.
    await svc.setVoidReasons(['Otro'], user)
    expect(configStore.length).toBe(1)
    expect(configStore[0].value).toEqual(['Otro'])
  })

  it('normalizeReasons rechaza listas vacías o con no-strings', () => {
    expect(() => normalizeReasons([])).toThrow('al menos un motivo')
    expect(() => normalizeReasons(['', '  '])).toThrow('al menos un motivo')
    expect(() => normalizeReasons([1] as any)).toThrow('texto')
    expect(() => normalizeReasons('Sin stock' as any)).toThrow('lista')
  })
})
