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
const discountCalls: unknown[] = []
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
      // #215
      discountPolicy: vi.fn(async () => ({ maxDiscountPercent: 100, reasons: ['Cortesía de la casa', 'Huésped del hotel', 'Otro'], isDefault: true })),
      applyOrderDiscount: vi.fn(async (id: string, data: unknown) => { discountCalls.push({ scope: 'order', id, data }); return orderData }),
      applyLineDiscount: vi.fn(async (id: string, lineId: string, data: unknown) => { discountCalls.push({ scope: 'line', id, lineId, data }); return orderData.lines[0] }),
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
  beforeEach(() => { chargeCalls.length = 0; byIdCalls.length = 0; discountCalls.length = 0; toastWarning.mockClear(); inHouseData = [perez]; byId = async (id) => inHouseData.find((r) => r.id === id) ?? null; orderData = baseOrder() })
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

// ─── #215 (REST-13): descuentos y cortesías en Cobrar ───
describe('cobrar.vue — #215 descuentos', () => {
  beforeEach(() => { discountCalls.length = 0; orderData = baseOrder() })
  afterEach(() => { document.body.innerHTML = '' })

  it('el ticket muestra "Descuento 10 % (motivo) −X" de la comanda y la cortesía de la línea con su motivo; la anulada no va en la cuenta', async () => {
    orderData = baseOrder({
      subtotal: 90, tax: 16.2, total: 106.2, discountType: 'percent', discountValue: 10, discountAmount: 10, discountReason: 'Huésped del hotel', discountTotal: 110,
      lines: [
        { id: 'l1', orderId: 'o1', name: 'Pizza', quantity: 1, unitPrice: 100, lineTotal: 100, status: 'new' } as OrderWithLines['lines'][number],
        { id: 'l2', orderId: 'o1', name: 'Postre', quantity: 1, unitPrice: 100, lineTotal: 100, status: 'new', discountType: 'percent', discountValue: 100, discountAmount: 100, discountReason: 'Cortesía de la casa' } as OrderWithLines['lines'][number],
        { id: 'l3', orderId: 'o1', name: 'Anulada', quantity: 1, unitPrice: 50, lineTotal: 50, status: 'voided' } as OrderWithLines['lines'][number],
      ],
    })
    const w = await mountCobrar()
    const row = w.find('[data-testid="order-discount-row"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('Descuento 10 % (Huésped del hotel)')
    expect(row.text()).toContain('−RD$10.00')
    const courtesy = w.find('[data-testid="line-discount-l2"]')
    expect(courtesy.text()).toContain('Cortesía · Cortesía de la casa')
    expect(courtesy.text()).toContain('−RD$100.00')
    expect(w.find('[data-testid="line-discount-l1"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Anulada')
    // Subtotal/impuesto son los del server (ya descontados): no se recalculan acá.
    expect(w.text()).toContain('RD$90.00')
    expect(w.text()).toContain('RD$16.20')
    w.unmount()
  })

  it('"Descuento" abre el modal y confirmar manda applyOrderDiscount con tipo/valor/motivo; luego recarga la comanda', async () => {
    const w = await mountCobrar()
    await w.find('[data-testid="order-discount"]').trigger('click')
    await flushPromises()
    const value = document.body.querySelector<HTMLInputElement>('[data-testid="discount-value"]')
    expect(value, 'el modal de descuento no se abrió').not.toBeNull()
    value!.value = '10'
    value!.dispatchEvent(new Event('input'))
    document.body.querySelector<HTMLButtonElement>('[data-testid="discount-reasons"] button:nth-child(2)')!.click()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="discount-confirm"]')!.click()
    await flushPromises()
    expect(discountCalls).toEqual([{ scope: 'order', id: 'o1', data: { type: 'percent', value: 10, reason: 'Huésped del hotel' } }])
    expect(document.body.querySelector('[data-testid="discount-confirm"]')).toBeNull()   // se cerró
    w.unmount()
  })

  it('el botón de la línea abre el modal sobre esa línea y confirma con applyLineDiscount', async () => {
    const w = await mountCobrar()
    await w.find('[data-testid="line-discount-btn-l1"]').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="discount-courtesy"]')!.click()
    document.body.querySelector<HTMLButtonElement>('[data-testid="discount-reasons"] button:nth-child(1)')!.click()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="discount-confirm"]')!.click()
    await flushPromises()
    expect(discountCalls).toEqual([{ scope: 'line', id: 'o1', lineId: 'l1', data: { type: 'percent', value: 100, reason: 'Cortesía de la casa' } }])
    w.unmount()
  })

  it('comanda liquidada: no hay botón de descuento', async () => {
    orderData = baseOrder({ status: 'paid', settlement: 'payment' })
    const w = await mountCobrar()
    expect(w.find('[data-testid="order-discount"]').exists()).toBe(false)
    w.unmount()
  })
})
