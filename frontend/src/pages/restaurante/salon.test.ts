// salon.test.ts — #204: el salón en pestañas por zona, con refresco automático que no vacía la lista,
// mesa ocupada con hora/tiempo/total/mozo, y acciones de mesa accesibles sin hover.
//
// Dos capas: los helpers puros (salon-helpers.ts) y la página montada con los servicios mockeados
// (mismo patrón que empty-state-cta-permissions.test.ts). El canal en vivo (#211, useRestaurantEvents)
// se reemplaza por un doble que expone `onPoll`/`onEvent`: el refresco se dispara a mano.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import {
  zoneTabs, groupByZone, zoneSlug, tableState, elapsedLabel, updatedAgoLabel, initials, resolveWaiter, isLiveOrder,
} from './salon-helpers'
import type { Order, RestaurantTable } from '@/services/Restaurant.service'

// ── Datos que cada test ajusta antes de montar ──────────────────────────────
let tablesData: RestaurantTable[] = []
let ordersData: Order[] = []
let teamData: { id: string; name: string }[] = []
let listTablesCalls = 0
let listOrdersCalls = 0
const routerPush = vi.fn()
// Doble del canal en vivo: captura los callbacks para disparar el refresco desde el test.
const liveHooks: { onPoll?: () => unknown; onEvent?: (e: unknown) => unknown } = {}
const liveState = ref<'idle' | 'connecting' | 'live' | 'reconnecting'>('idle')

vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canRoute: () => true, permissions: { value: [] } }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}))
vi.mock('@/composables/useConfirm', () => ({
  useConfirm: () => ({ confirmModal: ref(null), confirmBusy: ref(false), askConfirm: vi.fn(), runConfirm: vi.fn() }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('@/composables/useRestaurantEvents', () => ({
  useRestaurantEvents: (opts: { onPoll?: () => unknown; onEvent?: (e: unknown) => unknown }) => {
    liveHooks.onPoll = opts.onPoll
    liveHooks.onEvent = opts.onEvent
    return { state: liveState, start: vi.fn(), stop: vi.fn() }
  },
}))
vi.mock('@/services/Restaurant.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/Restaurant.service')>()
  return {
    ...mod,
    RestaurantService: {
      ...mod.RestaurantService,
      listTables: vi.fn(async () => { listTablesCalls++; return tablesData }),
      listOrders: vi.fn(async () => { listOrdersCalls++; return ordersData }),
      kdsQueue: vi.fn(async () => []),
    },
  }
})
vi.mock('@/services/Team.service', () => ({
  TeamService: { list: vi.fn(async () => ({ data: teamData, total: teamData.length })) },
}))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: { get: vi.fn(async () => ({ hotel: { currency: 'DOP' } })) },
}))

const table = (id: string, name: string, zone?: string, status: RestaurantTable['status'] = 'free'): RestaurantTable =>
  ({ id, hotelId: 'h1', name, zone, status })
const order = (id: string, tableId: string | undefined, extra: Partial<Order> = {}): Order =>
  ({ id, hotelId: 'h1', number: `CMD-${id}`, type: tableId ? 'dine_in' : 'takeaway', tableId, status: 'sent', subtotal: 0, tax: 0, tip: 0, total: 0, ...extra })

describe('salon-helpers — pestañas por zona', () => {
  it('Todas · <zona>… · Sin mesa, con contadores; "Sin mesa" siempre está', () => {
    const tabs = zoneTabs([table('1', 'M1', 'Terraza'), table('2', 'M2', 'Terraza'), table('3', 'M3', 'Salón principal')], 1)
    expect(tabs).toEqual([
      { value: 'all', label: 'Todas', count: 3 },
      { value: 'terraza', label: 'Terraza', count: 2 },
      { value: 'salon-principal', label: 'Salón principal', count: 1 },
      { value: 'loose', label: 'Sin mesa', count: 1 },
    ])
  })

  it('con una sola zona no se lista (sería igual a Todas); sin zona cae en "General"', () => {
    expect(zoneTabs([table('1', 'M1'), table('2', 'M2', '  ')], 0).map((t) => t.value)).toEqual(['all', 'loose'])
    expect(groupByZone([table('1', 'M1')])[0].zone).toBe('General')
  })

  it('zoneSlug: estable para ?tab=', () => {
    expect(zoneSlug('Terraza')).toBe('terraza')
    expect(zoneSlug('Salón principal')).toBe('salon-principal')
    expect(zoneSlug('  ¡Bar! ')).toBe('bar')
    expect(zoneSlug('???')).toBe('zona')
  })
})

describe('salon-helpers — estado visual y tiempos', () => {
  it('occupied a mano sin comanda se distingue de libre y de una con comanda', () => {
    expect(tableState({ status: 'occupied' }, undefined)).toBe('occupied-no-order')
    expect(tableState({ status: 'free' }, undefined)).toBe('free')
    expect(tableState({ status: 'reserved' }, undefined)).toBe('reserved')
    expect(tableState({ status: 'free' }, order('o1', 't1'))).toBe('ordering')
    expect(tableState({ status: 'reserved' }, order('o1', 't1'))).toBe('ordering')   // la comanda manda
  })

  it('isLiveOrder: paid/cancelled/refunded ya no ocupan; processing_payment sí', () => {
    for (const s of ['open', 'sent', 'preparing', 'ready', 'served', 'billed', 'processing_payment']) expect(isLiveOrder({ status: s as Order['status'] })).toBe(true)
    for (const s of ['paid', 'charged', 'cancelled', 'refunded']) expect(isLiveOrder({ status: s as Order['status'] })).toBe(false)
  })

  it('elapsedLabel: "recién", "hace N min", "hace H h M min"; vacío si no hay fecha', () => {
    const now = Date.parse('2026-09-11T12:00:00Z')
    expect(elapsedLabel('2026-09-11T11:59:40Z', now)).toBe('recién')
    expect(elapsedLabel('2026-09-11T11:37:00Z', now)).toBe('hace 23 min')
    expect(elapsedLabel('2026-09-11T10:40:00Z', now)).toBe('hace 1 h 20 min')
    expect(elapsedLabel('2026-09-11T10:00:00Z', now)).toBe('hace 2 h')
    expect(elapsedLabel(undefined, now)).toBe('')
    expect(elapsedLabel('no-es-fecha', now)).toBe('')
  })

  it('updatedAgoLabel en segundos y luego minutos', () => {
    const now = 100_000
    expect(updatedAgoLabel(now - 7_000, now)).toBe('actualizado hace 7 s')
    expect(updatedAgoLabel(now - 125_000, now)).toBe('actualizado hace 2 min')
    expect(updatedAgoLabel(null, now)).toBe('')
  })
})

describe('salon-helpers — mozo por /usuarios', () => {
  it('resuelve nombre e iniciales por users.id; sin match no inventa nada', () => {
    const users = new Map([['u1', 'Rosa Pérez'], ['u2', 'carlos']])
    expect(resolveWaiter(users, 'u1')).toEqual({ name: 'Rosa Pérez', initials: 'RP' })
    expect(resolveWaiter(users, 'u2')).toEqual({ name: 'carlos', initials: 'C' })
    expect(resolveWaiter(users, 'emp-profile-9')).toBeNull()
    expect(resolveWaiter(users, undefined)).toBeNull()
    expect(initials('Juan Carlos de la Cruz')).toBe('JC')
  })
})

// ── Página montada ──────────────────────────────────────────────────────────
async function mountSalon() {
  const { default: Salon } = await import('./salon.vue')
  const w = mount(Salon, { attachTo: document.body })
  await flushPromises()
  return w
}
const tabButtons = (w: Awaited<ReturnType<typeof mountSalon>>) => w.findAll('[role="tab"]')
const tableButtons = (w: Awaited<ReturnType<typeof mountSalon>>) => w.findAll('button[data-table]')

describe('salon.vue — montada', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listTablesCalls = 0
    listOrdersCalls = 0
    tablesData = [table('t1', 'Mesa 1', 'Terraza'), table('t2', 'Mesa 2', 'Terraza'), table('t3', 'Mesa 3', 'Salón'), table('t4', 'Mesa 4', 'Salón', 'occupied')]
    ordersData = [order('o1', 't1', { openedAt: new Date(Date.now() - 23 * 60_000).toISOString(), total: 1250.5, waiterId: 'u1' }), order('o2', undefined)]
    teamData = [{ id: 'u1', name: 'Rosa Pérez' }]
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('pestañas por zona con contadores; una zona muestra solo sus mesas; Todas agrupa por zona', async () => {
    const w = await mountSalon()
    expect(tabButtons(w).map((b) => b.text())).toEqual(['Todas(4)', 'Terraza(2)', 'Salón(2)', 'Sin mesa(1)'])
    // Todas: dos SectionCard de zona + la de comandas sin mesa.
    expect(tableButtons(w).map((b) => b.attributes('data-table'))).toEqual(['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4'])
    expect(w.text()).toContain('Comandas sin mesa')
    await tabButtons(w)[2].trigger('click')
    expect(tableButtons(w).map((b) => b.attributes('data-table'))).toEqual(['Mesa 3', 'Mesa 4'])
    expect(w.text()).not.toContain('Comandas sin mesa')
    await tabButtons(w)[3].trigger('click')
    expect(tableButtons(w)).toHaveLength(0)
    expect(w.text()).toContain('CMD-o2')
    w.unmount()
  })

  it('mesa ocupada: hora, "hace 23 min", total con la moneda del hotel y las iniciales del mozo (users.name)', async () => {
    const w = await mountSalon()
    const mesa1 = tableButtons(w)[0]
    expect(mesa1.text()).toContain('Ocupada · CMD-o1')
    expect(mesa1.text()).toContain('hace 23 min')
    expect(mesa1.text()).toContain('RD$1250.50')
    expect(mesa1.text()).toContain('RP')
    expect(mesa1.find('[title="Rosa Pérez"]').exists()).toBe(true)
    // occupied a mano sin comanda: etiqueta propia y color ámbar, no el de libre.
    const mesa4 = tableButtons(w)[3]
    expect(mesa4.text()).toContain('Ocupada (sin comanda)')
    expect(mesa4.classes()).toContain('border-warning')
    expect(tableButtons(w)[1].classes()).toContain('border-teal')
    w.unmount()
  })

  it('refresco (polling del canal en vivo) sin vaciar la lista: la mesa cambia a ocupada y el KPI sube', async () => {
    const w = await mountSalon()
    expect(listOrdersCalls).toBe(1)
    expect(liveHooks.onPoll, 'el salón no registró onPoll en useRestaurantEvents').toBeTypeOf('function')
    expect(w.text()).toContain('Libre')
    // Otra tablet abre una comanda en Mesa 2.
    ordersData = [...ordersData, order('o3', 't2', { openedAt: new Date().toISOString(), total: 300 })]
    let resolveOrders!: (v: Order[]) => void
    const pending = new Promise<Order[]>((r) => { resolveOrders = r })
    const { RestaurantService } = await import('@/services/Restaurant.service')
    ;(RestaurantService.listOrders as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { listOrdersCalls++; return pending })
    liveHooks.onPoll!()
    await flushPromises()
    expect(listOrdersCalls).toBe(2)
    // Mientras la respuesta está en vuelo, la grilla sigue completa (no se vacía ni hay skeleton).
    expect(tableButtons(w)).toHaveLength(4)
    expect(w.find('[data-testid="salon-skeleton"]').exists()).toBe(false)
    resolveOrders(ordersData)
    await flushPromises()
    expect(tableButtons(w)[1].text()).toContain('Ocupada · CMD-o3')
    // El KPI "Ocupadas" sale del mismo computed que pinta las mesas (KpiHeroCard anima el número, por
    // eso se cuenta por estado visual y no por el texto animado): ahora hay 2 mesas con comanda.
    expect(tableButtons(w).filter((b) => b.classes().includes('border-gold'))).toHaveLength(2)
    w.unmount()
  })

  it('no refresca mientras hay un modal abierto (ni por polling ni por evento en vivo)', async () => {
    const { openModalCount } = await import('@/composables/useModalStack')
    const w = await mountSalon()
    openModalCount.value = 1
    liveHooks.onPoll!()
    await flushPromises()
    liveHooks.onEvent!({ type: 'order.sent' })
    await vi.advanceTimersByTimeAsync(200)
    expect(listOrdersCalls).toBe(1)
    openModalCount.value = 0
    liveHooks.onPoll!()
    await flushPromises()
    expect(listOrdersCalls).toBe(2)
    // Un evento del canal también refresca (con debounce de 150 ms).
    liveHooks.onEvent!({ type: 'order.sent' })
    await vi.advanceTimersByTimeAsync(200)
    expect(listOrdersCalls).toBe(3)
    w.unmount()
  })

  it('el menú "⋯" está siempre visible (sin hover) y ofrece Editar / Marcar reservada / Eliminar mesa', async () => {
    const w = await mountSalon()
    const more = w.find('button[aria-label="Opciones de Mesa 2"]')
    expect(more.exists()).toBe(true)
    expect(more.classes()).not.toContain('hidden')
    await more.trigger('click')
    const items = w.findAll('[role="menuitem"]').map((b) => b.text())
    expect(items).toEqual(['Editar', 'Marcar reservada', 'Eliminar mesa'])
    w.unmount()
  })
})
