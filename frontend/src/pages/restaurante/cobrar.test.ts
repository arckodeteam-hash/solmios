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
// #214 (REST-12): dividir cuenta.
//   - Sin partes: pestañas "Cobrar todo" y "Dividir cuenta"; con una parte cobrada, "Cobrar todo" desaparece.
//   - Las partes vienen del server (recargar a mitad las muestra): dos pagos listados, saldo restante.
//   - "Agregar pago" manda {method, amount, tip} y, al saldar, vuelve al salón; sobrepago deshabilita el botón.
//   - Partes iguales: muestra los montos del server (33.33/33.33/33.34); por líneas: manda lineIds, no monto suelto.
//   - Cobrada por partes: cada parte listada, "Reembolsar" en cada parte directa (efectivo/transfer/tarjeta), y llama al refund de ESA parte.
//   - Parte con TARJETA: manda successUrl/cancelUrl y navega al Checkout; al volver (`?part=pending`) espera
//     el webhook de esa parte (poll) y va al salón cuando la comanda queda paid.
//   - Parte a HABITACIÓN: manda reservationId (la de la comanda, preseleccionada) y sin propina.
//   - Si las partes no se pueden leer (403): la página sigue; "Cobrar todo" y el cargo a habitación funcionan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { OrderWithLines, InHouseReservation, OrderPaymentsList, OrderPayment } from '@/services/Restaurant.service'
import { POS_PAYMENT_METHODS } from '@/services/Caja.service'

let orderData: OrderWithLines
let paymentsData: OrderPaymentsList = { data: [], total: 0, balance: { due: 118, paid: 0, pending: 0, outstanding: 118, tips: 0 } }
const addPartCalls: unknown[] = []
const refundPartCalls: unknown[] = []
const refundCalls: unknown[] = []
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
// La query de la ruta cambia por test (vuelta del Checkout de una parte: `?paid=pending&part=pending`).
const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useRoute: () => ({ params: { id: 'o1' }, get query() { return routeState.query } }),
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
      // #214
      listOrderPayments: vi.fn(async () => paymentsData),
      splitPreview: vi.fn(async (_id: string, parts: number) => ({ due: 118, outstanding: 118, parts: parts === 3 ? [39.33, 39.33, 39.34] : [59, 59] })),
      addOrderPayment: vi.fn(async (id: string, data: unknown) => {
        addPartCalls.push({ id, data })
        const req = data as { method: string; amount: number }
        // Tarjeta: la parte queda pending y el server devuelve el Checkout de Stripe.
        if (req.method === 'card') {
          const pending = { id: 'p-card', hotelId: 'h1', orderId: id, seq: paymentsData.data.length + 1, method: 'card', amount: req.amount, tip: 0, status: 'pending' } as OrderPayment
          return { part: pending, order: orderData, balance: { ...paymentsData.balance, pending: req.amount }, checkoutUrl: 'https://checkout.stripe.test/cs_part' }
        }
        const part = { id: 'p-new', hotelId: 'h1', orderId: id, seq: paymentsData.data.length + 1, method: req.method, amount: req.amount, tip: 0, status: 'completed' } as OrderPayment
        const paid = paymentsData.balance.paid + part.amount
        const outstanding = Math.round((paymentsData.balance.due - paid) * 100) / 100
        return { part, order: { ...orderData, status: outstanding <= 0 ? 'paid' : orderData.status, amountPaid: paid }, balance: { ...paymentsData.balance, paid, outstanding } }
      }),
      refundOrderPayment: vi.fn(async (id: string, partId: string, reason: string) => { refundPartCalls.push({ id, partId, reason }); return { id: partId, status: 'refunded' } as OrderPayment }),
      refundOrder: vi.fn(async (id: string, reason: string) => { refundCalls.push({ id, reason }); return { ...orderData, status: 'refunded' } }),
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
  beforeEach(() => {
    chargeCalls.length = 0; byIdCalls.length = 0; addPartCalls.length = 0; refundPartCalls.length = 0; discountCalls.length = 0; routerPush.mockClear(); toastWarning.mockClear()
    inHouseData = [perez]; byId = async (id) => inHouseData.find((r) => r.id === id) ?? null; orderData = baseOrder()
    paymentsData = { data: [], total: 0, balance: { due: 118, paid: 0, pending: 0, outstanding: 118, tips: 0 } }
  })
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

// ─── #214 — dividir cuenta ────────────────────────────────────────────────────
const part = (extra: Partial<OrderPayment>): OrderPayment => ({ id: 'p1', hotelId: 'h1', orderId: 'o1', seq: 1, method: 'cash', amount: 40, tip: 0, status: 'completed', ...extra })
const twoParts = (): OrderPaymentsList => ({
  data: [part({ id: 'p1', seq: 1, method: 'cash', amount: 40, paymentId: 'pay-1' }), part({ id: 'p2', seq: 2, method: 'card', amount: 60, tip: 5, paymentId: 'pay-2' })],
  total: 2,
  balance: { due: 118, paid: 100, pending: 0, outstanding: 18, tips: 5 },
})
const tabButtons = (w: Awaited<ReturnType<typeof mountCobrar>>) => w.findAll('[role="tab"]').map((b) => b.text())
// Los modales (AppModal) se teleportan al body: se consultan por DOM, no por el wrapper.
const q = <T extends HTMLElement = HTMLElement>(sel: string): T => { const el = document.body.querySelector<T>(sel); if (!el) throw new Error(`No existe ${sel}`); return el }
const has = (sel: string): boolean => !!document.body.querySelector(sel)
const bodyHas = (text: string): boolean => (document.body.textContent || '').includes(text)
async function typeInto(sel: string, value: string) { const el = q<HTMLInputElement>(sel); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises() }
async function click(sel: string) { q<HTMLButtonElement>(sel).click(); await flushPromises() }

describe('cobrar.vue — #214 dividir cuenta', () => {
  beforeEach(() => {
    chargeCalls.length = 0; addPartCalls.length = 0; refundPartCalls.length = 0; routerPush.mockClear(); toastWarning.mockClear()
    inHouseData = [perez]; byId = async (id) => inHouseData.find((r) => r.id === id) ?? null; orderData = baseOrder()
    paymentsData = { data: [], total: 0, balance: { due: 118, paid: 0, pending: 0, outstanding: 118, tips: 0 } }
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('sin partes: pestañas "Cobrar todo" (activa) y "Dividir cuenta"; el flujo de un solo pago sigue ahí', async () => {
    const w = await mountCobrar()
    expect(tabButtons(w)).toEqual(['Cobrar todo', 'Dividir cuenta'])
    expect(w.text()).toContain('Cobrar RD$118.00')
    expect(w.find('[data-testid="charge-room"]').exists()).toBe(true)
    w.unmount()
  })

  it('con dos pagos hechos (del server): "Cobrar todo" desaparece, se listan las dos partes y el saldo restante', async () => {
    paymentsData = twoParts()
    const w = await mountCobrar()
    expect(tabButtons(w)).toEqual(['Dividir cuenta(2)'])
    const list = w.find('[data-testid="parts-list"]')
    expect(list.exists()).toBe(true)
    const rows = list.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Parte 1')
    expect(rows[0].text()).toContain('Efectivo')
    expect(rows[0].text()).toContain('RD$40.00')
    expect(rows[1].text()).toContain('Tarjeta')
    expect(rows[1].text()).toContain('RD$60.00')
    expect(rows[1].text()).toContain('+ RD$5.00')
    expect(w.find('[data-testid="outstanding"]').text()).toBe('RD$18.00')
    expect(w.find('[data-testid="charge-room"]').exists()).toBe(false)   // el cobro entero ya no aplica
    w.unmount()
  })

  it('"Agregar pago" cobra el saldo por defecto: manda {method, amount, tip}; al saldar vuelve al salón', async () => {
    paymentsData = twoParts()
    const w = await mountCobrar()
    await w.find('[data-testid="add-part"]').trigger('click')
    await flushPromises()
    expect(q<HTMLInputElement>('#restaurante-cobrar-parte-monto').value).toBe('18')
    await click('[data-part-method="transfer"]')
    await typeInto('#restaurante-cobrar-parte-propina', '2')
    await click('[data-testid="confirm-part"]')
    expect(addPartCalls).toEqual([{ id: 'o1', data: { method: 'transfer', amount: 18, tip: 2 } }])
    expect(routerPush).toHaveBeenCalledWith('/panel/restaurante/salon')
    w.unmount()
  })

  it('sobrepago: un monto mayor al saldo deshabilita "Cobrar" y muestra el aviso; nada sale al server', async () => {
    paymentsData = twoParts()
    const w = await mountCobrar()
    await w.find('[data-testid="add-part"]').trigger('click')
    await flushPromises()
    await typeInto('#restaurante-cobrar-parte-monto', '70')
    expect(q('[role="alert"]').textContent).toContain('supera el saldo')
    expect(q<HTMLButtonElement>('[data-testid="confirm-part"]').disabled).toBe(true)
    await click('[data-testid="confirm-part"]')
    expect(addPartCalls).toHaveLength(0)
    w.unmount()
  })

  it('partes iguales: pide los montos al server (3 → 39.33 / 39.33 / 39.34) y cada uno abre el pago con ese monto', async () => {
    const w = await mountCobrar()
    await w.findAll('[role="tab"]')[1].trigger('click')
    await w.find('#restaurante-cobrar-partes').setValue('3')
    await w.find('[data-testid="split-equal"]').trigger('click')
    await flushPromises()
    const amounts = w.find('[data-testid="equal-amounts"]').findAll('button').map((b) => b.text())
    expect(amounts).toEqual(['1/3 · RD$39.33', '2/3 · RD$39.33', '3/3 · RD$39.34'])
    await w.find('[data-testid="equal-amounts"]').findAll('button')[2].trigger('click')
    await flushPromises()
    expect(q<HTMLInputElement>('#restaurante-cobrar-parte-monto').value).toBe('39.34')
    await click('[data-testid="confirm-part"]')
    expect(addPartCalls).toEqual([{ id: 'o1', data: { method: 'cash', amount: 39.34, tip: 0 } }])
    w.unmount()
  })

  it('por líneas: marcar una línea manda lineIds (el monto lo fija el server); una línea ya cobrada no se puede marcar', async () => {
    orderData = baseOrder({ lines: [
      { id: 'l1', orderId: 'o1', name: 'Pizza', quantity: 1, unitPrice: 50, lineTotal: 50, taxRate: 18, status: 'new' },
      { id: 'l2', orderId: 'o1', name: 'Pasta', quantity: 1, unitPrice: 50, lineTotal: 50, taxRate: 18, status: 'new' },
    ] as OrderWithLines['lines'] })
    paymentsData = { data: [part({ id: 'p1', seq: 1, amount: 59, lineIds: ['l1'] })], total: 1, balance: { due: 118, paid: 59, pending: 0, outstanding: 59, tips: 0 } }
    const w = await mountCobrar()
    expect((w.find('input[name="line-l1"]').element as HTMLInputElement).disabled).toBe(true)
    expect(w.text()).toContain('Ya cobrada')
    await w.find('input[name="line-l2"]').trigger('change')
    await flushPromises()
    const btn = w.find('[data-testid="pay-selection"]')
    expect(btn.text()).toContain('RD$59.00')   // última línea: vale el saldo exacto
    await btn.trigger('click')
    await flushPromises()
    expect(q<HTMLInputElement>('#restaurante-cobrar-parte-monto').disabled).toBe(true)
    await click('[data-testid="confirm-part"]')
    expect(addPartCalls).toEqual([{ id: 'o1', data: { method: 'cash', amount: 59, tip: 0, lineIds: ['l2'] } }])
    w.unmount()
  })

  // #214: efectivo/transferencia también se devuelven de verdad → el motivo es obligatorio (el backend da 400 sin él).
  it('cobrada ENTERA en efectivo: "Reembolsar" abre el modal, confirmar está deshabilitado sin motivo y llama a refundOrder con el motivo', async () => {
    refundCalls.length = 0
    orderData = baseOrder({ status: 'paid', settlement: 'payment', paymentId: 'pay-1' })
    const w = await mountCobrar()
    expect(w.find('[data-testid="refund-order"]').exists()).toBe(true)
    await w.find('[data-testid="refund-order"]').trigger('click')
    await flushPromises()
    expect(has('[data-testid="refund-reason"]')).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="confirm-refund"]').disabled).toBe(true)
    await click('[data-testid="confirm-refund"]')
    expect(refundCalls).toEqual([])
    await typeInto('[data-testid="refund-reason"]', 'el plato salió frío')
    await click('[data-testid="confirm-refund"]')
    expect(refundCalls).toEqual([{ id: 'o1', reason: 'el plato salió frío' }])
    w.unmount()
  })

  it('cobrada por partes: lista cada parte, "Reembolsar" en efectivo Y tarjeta (#214 COR-5), y reembolsa ESA parte', async () => {
    orderData = baseOrder({ status: 'paid', settlement: 'payment', amountPaid: 118 })
    paymentsData = { ...twoParts(), balance: { due: 118, paid: 118, pending: 0, outstanding: 0, tips: 5 } }
    const w = await mountCobrar()
    const rows = w.find('[data-testid="settled-parts"]').findAll('li')
    expect(rows).toHaveLength(2)
    expect(w.find('[data-testid="refund-part-1"]').exists()).toBe(true)    // efectivo: asiento refund en payments, sin Stripe
    expect(w.find('[data-testid="refund-part-2"]').exists()).toBe(true)
    expect(w.findAll('button').filter((b) => b.text() === 'Reembolsar')).toHaveLength(2)   // una por parte; no hay "reembolsar orden" entera
    await w.find('[data-testid="refund-part-2"]').trigger('click')
    await flushPromises()
    expect(has('[data-testid="confirm-part-refund"]')).toBe(true)
    // #214: sin motivo, "Reembolsar" está deshabilitado y no se llama al server.
    expect(q<HTMLButtonElement>('[data-testid="confirm-part-refund"]').disabled).toBe(true)
    await click('[data-testid="confirm-part-refund"]')
    expect(refundPartCalls).toEqual([])
    await typeInto('[data-testid="part-refund-reason"]', 'cobrado a la mesa equivocada')
    expect(q<HTMLButtonElement>('[data-testid="confirm-part-refund"]').disabled).toBe(false)
    await click('[data-testid="confirm-part-refund"]')
    expect(refundPartCalls).toEqual([{ id: 'o1', partId: 'p2', reason: 'cobrado a la mesa equivocada' }])
    w.unmount()
  })

  // COR-C: una parte cobrada por error con la comanda ABIERTA se devuelve desde la lista de partes; el
  // server la deja `reversed` (el saldo se reabre) y una parte `reversed` deja de listarse y de contar.
  it('comanda abierta con partes: "Devolver" en la parte de efectivo, confirma y llama al refund de ESA parte; una `reversed` no se lista', async () => {
    paymentsData = twoParts()
    const w = await mountCobrar()
    expect(w.find('[data-testid="undo-part-1"]').exists()).toBe(true)
    expect(w.find('[data-testid="undo-part-2"]').exists()).toBe(true)
    await w.find('[data-testid="undo-part-1"]').trigger('click')
    await flushPromises()
    expect(bodyHas('vuelve a quedar pendiente')).toBe(true)
    await typeInto('[data-testid="part-refund-reason"]', 'se equivocó de mesa')
    await click('[data-testid="confirm-part-refund"]')
    expect(refundPartCalls).toEqual([{ id: 'o1', partId: 'p1', reason: 'se equivocó de mesa' }])
    w.unmount()
    const tp = twoParts()
    tp.data[0] = { ...tp.data[0], status: 'reversed' }
    tp.balance = { due: 118, paid: 60, pending: 0, outstanding: 58, tips: 5 }
    paymentsData = tp
    const w2 = await mountCobrar()
    expect(w2.find('[data-testid="parts-list"]').findAll('li')).toHaveLength(1)
    expect(w2.find('[data-testid="outstanding"]').text()).toBe('RD$58.00')
    w2.unmount()
  })

  it('reembolsada en parte: se explica y la parte devuelta figura como reembolsada; la de efectivo sigue cobrada', async () => {
    orderData = baseOrder({ status: 'partially_refunded', settlement: 'payment', amountPaid: 118 })
    const tp = twoParts()
    tp.data[1] = { ...tp.data[1], status: 'refunded' }
    paymentsData = tp
    const w = await mountCobrar()
    expect(w.text()).toContain('Se devolvió una parte del cobro; el resto sigue cobrado.')
    const rows = w.find('[data-testid="settled-parts"]').findAll('li')
    expect(rows[0].text()).toContain('Cobrada')
    expect(rows[1].text()).toContain('Reembolsada')
    expect(w.find('[data-testid="refund-part-2"]').exists()).toBe(false)
    w.unmount()
  })
})

// ─── #214 — tarjeta, habitación y partes no disponibles ───────────────────────
/** `window.location` no es espiable directo en happy-dom: se reemplaza el objeto (mismo patrón que register-service-worker.test.ts). */
function stubLocation() {
  const original = window.location
  const assign = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, origin: 'http://app.test', assign } })
  return { assign, restore: () => Object.defineProperty(window, 'location', { configurable: true, value: original }) }
}

describe('cobrar.vue — #214 parte con tarjeta / a habitación / partes no disponibles', () => {
  beforeEach(() => {
    chargeCalls.length = 0; addPartCalls.length = 0; refundPartCalls.length = 0; routerPush.mockClear(); toastWarning.mockClear()
    inHouseData = [perez]; byId = async (id) => inHouseData.find((r) => r.id === id) ?? null; orderData = baseOrder()
    paymentsData = { data: [], total: 0, balance: { due: 118, paid: 0, pending: 0, outstanding: 118, tips: 0 } }
    routeState.query = {}
  })
  afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })

  it('tarjeta: manda successUrl/cancelUrl con `part=pending` y navega al Checkout que devuelve el server', async () => {
    const loc = stubLocation()
    try {
      const w = await mountCobrar()
      await w.findAll('[role="tab"]')[1].trigger('click')
      await w.find('[data-testid="add-part"]').trigger('click')
      await flushPromises()
      await typeInto('#restaurante-cobrar-parte-monto', '50')
      await click('[data-part-method="card"]')
      expect(bodyHas('Se abre el Checkout de Stripe')).toBe(true)
      await click('[data-testid="confirm-part"]')
      expect(addPartCalls).toEqual([{ id: 'o1', data: {
        method: 'card', amount: 50, tip: 0,
        successUrl: 'http://app.test/panel/restaurante/cobrar/o1?paid=pending&part=pending',
        cancelUrl: 'http://app.test/panel/restaurante/cobrar/o1?paid=cancelled',
      } }])
      expect(loc.assign).toHaveBeenCalledWith('https://checkout.stripe.test/cs_part')
      expect(routerPush).not.toHaveBeenCalled()
      w.unmount()
    } finally { loc.restore() }
  })

  it('vuelta del Checkout (`?part=pending`): muestra la parte esperando a Stripe, hace poll y va al salón cuando la comanda queda paid', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    routeState.query = { paid: 'pending', part: 'pending' }
    paymentsData = { data: [part({ id: 'p1', seq: 1, method: 'card', amount: 118, status: 'pending' })], total: 1, balance: { due: 118, paid: 0, pending: 118, outstanding: 118, tips: 0 } }
    const w = await mountCobrar()
    // Mientras espera: la parte figura "Sin confirmar", el saldo sigue completo y no se puede agregar otra por ese saldo.
    expect(w.find('[data-testid="pending-note"]').text()).toContain('RD$118.00 esperando la confirmación de Stripe')
    expect(w.find('[data-testid="parts-list"]').text()).toContain('Sin confirmar')
    expect((w.find('[data-testid="add-part"]').element as HTMLButtonElement).disabled).toBe(true)
    expect(routerPush).not.toHaveBeenCalled()
    // El webhook confirmó: la siguiente vuelta del poll ve la parte cobrada y la comanda paid.
    paymentsData = { data: [part({ id: 'p1', seq: 1, method: 'card', amount: 118, status: 'completed', paymentId: 'pay-1' })], total: 1, balance: { due: 118, paid: 118, pending: 0, outstanding: 0, tips: 0 } }
    orderData = baseOrder({ status: 'paid', settlement: 'payment', amountPaid: 118 })
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(routerPush).toHaveBeenCalledWith('/panel/restaurante/salon')
    w.unmount()
  })

  it('habitación: manda reservationId (la reserva de la comanda, preseleccionada) y sin propina; con propina no deja cobrar', async () => {
    orderData = baseOrder({ reservationId: 'r-204' })
    const w = await mountCobrar()
    await w.findAll('[role="tab"]')[1].trigger('click')
    await w.find('[data-testid="add-part"]').trigger('click')
    await flushPromises()
    await typeInto('#restaurante-cobrar-parte-monto', '59')
    await click('[data-part-method="room"]')
    expect(bodyHas('Va al folio como consumo neto')).toBe(true)
    expect(q<HTMLInputElement>('#restaurante-cobrar-parte-propina').disabled).toBe(true)   // el folio no transfiere propina
    await click('[data-testid="confirm-part"]')
    expect(addPartCalls).toEqual([{ id: 'o1', data: { method: 'room', amount: 59, tip: 0, reservationId: 'r-204' } }])
    w.unmount()
  })

  it('sin reserva en la comanda ni alojado elegido: una parte a habitación no se puede confirmar', async () => {
    const w = await mountCobrar()
    await w.findAll('[role="tab"]')[1].trigger('click')
    await w.find('[data-testid="add-part"]').trigger('click')
    await flushPromises()
    await click('[data-part-method="room"]')
    expect(q<HTMLButtonElement>('[data-testid="confirm-part"]').disabled).toBe(true)
    await click('[data-testid="confirm-part"]')
    expect(addPartCalls).toHaveLength(0)
    w.unmount()
  })

  it('las partes no se pueden leer (403): la página igual carga, "Cobrar todo" y el cargo a habitación siguen; la pestaña Dividir lo dice', async () => {
    const { RestaurantService } = await import('@/services/Restaurant.service')
    vi.mocked(RestaurantService.listOrderPayments).mockRejectedValueOnce(new Error('Sin permiso restaurant:pay'))
    const w = await mountCobrar()
    expect(tabButtons(w)).toEqual(['Cobrar todo', 'Dividir cuenta'])
    expect(w.text()).toContain('Cobrar RD$118.00')
    expect(w.find('[data-testid="charge-room"]').exists()).toBe(true)
    expect(toastWarning).toHaveBeenCalledWith('No se pudieron cargar los pagos parciales', 'Sin permiso restaurant:pay')
    await w.findAll('[role="tab"]')[1].trigger('click')
    expect(w.find('[data-testid="parts-unavailable"]').exists()).toBe(true)
    expect(w.find('[data-testid="add-part"]').exists()).toBe(false)
    w.unmount()
  })
})
