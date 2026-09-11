// cobrar.test.ts — #209 (REST-07): cobrar sin tipear ids.
//   - No hay input de "ID de reserva": el cargo a habitación se elige con ReservationPicker.
//   - Comanda de room service: la reserva se pide POR ID (no la lista de alojados), viene preseleccionada y
//     "Cargar" está habilitado en un toque; al confirmar se manda ESE reservationId. Si el lookup falla, se
//     avisa (no se traga) y la comanda igual se puede cargar a su reserva.
//   - Reserva de la comanda sin check-in (llega hoy): nota "todavía no hizo check-in", se carga igual.
//   - Comanda de salón sin reserva: "Cargar" deshabilitado hasta elegir un alojado.
//   - Propina -5 → queda en 0 y el botón muestra el total sin propina.
//   - Cobrada al folio: nota "Cobrado a la habitación: se devuelve desde el folio".
//   - Métodos de pago: los de Caja.service (POS_PAYMENT_METHODS), no una lista propia.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { OrderWithLines, InHouseReservation } from '@/services/Restaurant.service'
import { POS_PAYMENT_METHODS } from '@/services/Caja.service'

let orderData: OrderWithLines
let inHouseData: InHouseReservation[] = []
let byId: (id: string) => Promise<InHouseReservation | null> = async (id) => inHouseData.find((r) => r.id === id) ?? null
const byIdCalls: string[] = []
const chargeCalls: unknown[] = []
const toastWarning = vi.fn()
const routerPush = vi.fn()

vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ can: () => true, canRoute: () => true, permissions: { value: [] } }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: toastWarning }),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useRoute: () => ({ params: { id: 'o1' }, query: {} }),
}))
// #216 — la pestaña de impresión se abre en imprimir.ts; acá solo importa que se pida el doc correcto.
const printCalls: unknown[] = []
vi.mock('./imprimir', () => ({ openPrintTab: vi.fn(async (...args: unknown[]) => { printCalls.push(args); return { ok: true } }) }))
vi.mock('@/services/Settings.service', () => ({
  SettingsService: { get: vi.fn(async () => ({ hotel: { currency: 'DOP' } })) },
}))
vi.mock('@/services/Restaurant.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/Restaurant.service')>()
  return {
    ...mod,
    RestaurantService: {
      ...mod.RestaurantService,
      getOrder: vi.fn(async () => orderData),
      searchInHouse: vi.fn(async () => ({ data: inHouseData, total: inHouseData.length })),
      getInHouseById: vi.fn(async (id: string) => { byIdCalls.push(id); return byId(id) }),
      chargeToRoom: vi.fn(async (id: string, data: unknown) => { chargeCalls.push({ id, data }); return { ...orderData, status: 'charged' } }),
      billOrder: vi.fn(async () => ({ ...orderData, status: 'billed' })),
      payOrder: vi.fn(async () => { orderData = { ...orderData, status: 'paid', settlement: 'payment', paymentId: 'pay-1' }; return orderData }),
    },
  }
})

const perez: InHouseReservation = { id: 'r-204', hotelId: 'h1', roomId: 'room-204', roomNumber: '204', guestId: 'g1', guestName: 'Juan Pérez', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, status: 'checked_in' }
const baseOrder = (extra: Partial<OrderWithLines> = {}): OrderWithLines => ({
  id: 'o1', hotelId: 'h1', number: 'CMD-1', type: 'dine_in', status: 'sent', subtotal: 100, tax: 18, tip: 0, total: 118,
  lines: [{ id: 'l1', orderId: 'o1', name: 'Pizza', quantity: 1, unitPrice: 100, lineTotal: 100, status: 'new' } as OrderWithLines['lines'][number]],
  ...extra,
})

async function mountCobrar() {
  const { default: Cobrar } = await import('./cobrar.vue')
  const w = mount(Cobrar, { attachTo: document.body })
  await flushPromises()
  return w
}
const chargeBtn = (w: Awaited<ReturnType<typeof mountCobrar>>) => w.find('[data-testid="charge-room"]')

describe('cobrar.vue — #209', () => {
  beforeEach(() => { chargeCalls.length = 0; byIdCalls.length = 0; toastWarning.mockClear(); inHouseData = [perez]; byId = async (id) => inHouseData.find((r) => r.id === id) ?? null; orderData = baseOrder() })
  afterEach(() => { document.body.innerHTML = '' })

  it('no existe ningún input para tipear un id; el cargo se elige con el buscador; sin alojado elegido "Cargar" está deshabilitado', async () => {
    const w = await mountCobrar()
    expect(w.find('input[name="reservationId"]').exists()).toBe(false)
    expect(w.find('[data-testid="reservation-picker"]').exists()).toBe(true)
    expect((chargeBtn(w).element as HTMLButtonElement).disabled).toBe(true)
    await w.find('button[data-reservation="r-204"]').trigger('click')
    expect((chargeBtn(w).element as HTMLButtonElement).disabled).toBe(false)
    await chargeBtn(w).trigger('click')
    await flushPromises()
    expect(chargeCalls).toEqual([{ id: 'o1', data: { reservationId: 'r-204' } }])
    w.unmount()
  })

  it('room service: la reserva de la comanda se pide POR ID, viene preseleccionada ("Hab. 204 · Juan Pérez") y se confirma en un toque', async () => {
    orderData = baseOrder({ type: 'room_service', reservationId: 'r-204', roomId: 'room-204', guestId: 'g1', roomNumber: '204', guestName: 'Juan Pérez' })
    const { RestaurantService } = await import('@/services/Restaurant.service')
    vi.mocked(RestaurantService.searchInHouse).mockClear()
    const w = await mountCobrar()
    expect(byIdCalls).toEqual(['r-204'])
    expect(RestaurantService.searchInHouse).not.toHaveBeenCalled()   // el picker con selección no lista a todos
    const chip = w.find('[data-testid="reservation-picker-selected"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('Hab. 204 · Juan Pérez')
    expect((chargeBtn(w).element as HTMLButtonElement).disabled).toBe(false)
    await chargeBtn(w).trigger('click')
    await flushPromises()
    expect(chargeCalls).toEqual([{ id: 'o1', data: { reservationId: 'r-204' } }])
    w.unmount()
  })

  it('si el lookup por id falla: aviso visible + toast, y la comanda igual se carga a su propia reserva', async () => {
    orderData = baseOrder({ type: 'room_service', reservationId: 'r-204', roomNumber: '204', guestName: 'Juan Pérez' })
    byId = async () => { throw new Error('Sin permiso') }
    const w = await mountCobrar()
    expect(w.find('[data-testid="reservation-picker-selected"]').exists()).toBe(false)
    expect(w.find('[data-testid="reservation-lookup-failed"]').text()).toContain('No se pudo cargar la reserva de la comanda (Hab. 204 · Juan Pérez)')
    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect((chargeBtn(w).element as HTMLButtonElement).disabled).toBe(false)
    await chargeBtn(w).trigger('click')
    await flushPromises()
    expect(chargeCalls).toEqual([{ id: 'o1', data: { reservationId: 'r-204' } }])
    w.unmount()
  })

  it('REG-1: la reserva de la comanda todavía sin check-in se preselecciona con la nota y se carga igual', async () => {
    orderData = baseOrder({ type: 'room_service', reservationId: 'r-203' })
    inHouseData = [{ ...perez, id: 'r-203', roomNumber: '203', guestName: 'Luis López', status: 'confirmed' }]
    const w = await mountCobrar()
    expect(w.find('[data-testid="reservation-picker-selected"]').text()).toContain('Sin check-in')
    expect(w.find('[data-testid="reservation-status-note"]').text()).toContain('todavía no hizo check-in')
    expect((chargeBtn(w).element as HTMLButtonElement).disabled).toBe(false)
    w.unmount()
  })

  it('propina -5 → el campo queda en 0 y el botón muestra el total sin propina', async () => {
    const w = await mountCobrar()
    const tip = w.find('#restaurante-cobrar-propina')
    expect(tip.attributes('min')).toBe('0')
    await tip.setValue('-5')
    await flushPromises()
    expect((tip.element as HTMLInputElement).value).toBe('0')
    expect(w.text()).toContain('Cobrar RD$118.00')
    w.unmount()
  })

  it('cobrada al folio: explica que se devuelve desde el folio (en vez de no mostrar nada)', async () => {
    orderData = baseOrder({ status: 'charged', settlement: 'folio', folioId: 'f1' })
    const w = await mountCobrar()
    expect(w.find('[data-testid="folio-note"]').text()).toContain('Cobrado a la habitación: se devuelve desde el folio')
    expect(w.text()).not.toContain('Reembolsar')
    w.unmount()
  })

  it('los métodos de pago son los de Caja.service', async () => {
    const w = await mountCobrar()
    for (const m of POS_PAYMENT_METHODS) expect(w.text()).toContain(m.label)
    w.unmount()
  })
})

describe('cobrar.vue — #216 imprimir precuenta y ticket', () => {
  beforeEach(() => { printCalls.length = 0; routerPush.mockClear(); orderData = baseOrder() })
  afterEach(() => { document.body.innerHTML = '' })

  it('antes de cobrar: "Imprimir precuenta" abre la precuenta de ESTA comanda; no hay ticket todavía', async () => {
    const w = await mountCobrar()
    expect(w.find('[data-testid="print-ticket"]').exists()).toBe(false)
    await w.find('[data-testid="print-precuenta"]').trigger('click')
    await flushPromises()
    expect(printCalls).toEqual([['o1', 'precuenta']])
    w.unmount()
  })

  it('cobrar en efectivo se queda en la pantalla liquidada (no salta al salón) y "Imprimir ticket" pide el ticket', async () => {
    const w = await mountCobrar()
    const payBtn = w.findAll('button').find((b) => b.text().startsWith('Cobrar '))!
    await payBtn.trigger('click')
    await flushPromises()
    expect(routerPush).not.toHaveBeenCalled()
    expect(w.text()).toContain('Cobrada directamente')
    await w.find('[data-testid="print-ticket"]').trigger('click')
    await flushPromises()
    expect(printCalls).toEqual([['o1', 'ticket']])
    w.unmount()
  })

  it('cargada a la habitación: también hay "Imprimir ticket"', async () => {
    orderData = baseOrder({ status: 'charged', settlement: 'folio', folioId: 'f1' })
    const w = await mountCobrar()
    expect(w.find('[data-testid="print-ticket"]').exists()).toBe(true)
    expect(w.find('[data-testid="print-precuenta"]').exists()).toBe(false)
    w.unmount()
  })
})
