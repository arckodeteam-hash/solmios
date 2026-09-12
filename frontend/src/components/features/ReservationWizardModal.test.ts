// ReservationWizardModal.test.ts — REQ-HAC-05 (#260): el panel vende un TIPO, la unidad se asigna
// después.
//
// Qué se protege acá:
//   1. El selector de tipo se alimenta de GET /reservas/type-availability para las fechas: cada tipo
//      muestra "N libres" (mínimo por noche), un tipo agotado queda deshabilitado, y debajo se ve la
//      disponibilidad noche a noche del tipo elegido.
//   2. Sin unidad, la cotización viaja por `roomType` (no por `roomId`).
//   3. Sin unidad, el alta viaja SIN `roomId` y CON `roomType` ("Asignar después"); con unidad, con
//      los dos. Elegir una unidad fija el tipo; cambiar el tipo suelta una unidad de otro tipo.
//   4. El resumen muestra el tipo y "Habitación: asignar después" cuando no hay unidad.
//   5. En edición, una reserva con unidad precarga tipo + unidad.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('@/services/Reservation.service', () => ({
  ReservationService: {
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
    stayQuote: vi.fn(),
    typeAvailability: vi.fn(),
  },
}))
vi.mock('@/services/Billing.service', () => ({ BillingService: { taxRate: vi.fn().mockResolvedValue(0) } }))
vi.mock('@/services/Companions.service', () => ({
  CompanionsService: { listByReservation: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('@/services/Payments.service', () => ({ PaymentsService: { create: vi.fn() } }))
vi.mock('@/services/TTLock.service', () => ({ TTLockService: { generateCode: vi.fn() } }))
vi.mock('@/services/PromoCode.service', () => ({ PromoCodeService: { preview: vi.fn() } }))
vi.mock('@/services/Room.service', () => ({ RoomService: { list: vi.fn() } }))
vi.mock('@/services/Guest.service', () => ({
  GuestService: { list: vi.fn(), get: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'g-new' }), update: vi.fn() },
}))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { id: 'u1', hotelId: 'h1', role: 'admin' } }) }))
vi.mock('@/composables/useOnline', () => ({ useOnline: () => ({ isOnline: { value: true } }) }))
vi.mock('@/composables/useModalStack', () => ({ pushModal: vi.fn(), popModal: vi.fn() }))
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}))

import ReservationWizardModal from './ReservationWizardModal.vue'
import { ReservationService } from '@/services/Reservation.service'
import { RoomService } from '@/services/Room.service'
import type { StayQuote, TypeAvailability } from '@/types'

const ROOMS = [
  { id: 'r-101', number: '101', type: 'suite', basePrice: 120, hotelId: 'h1' },
  { id: 'r-102', number: '102', type: 'double', basePrice: 85, hotelId: 'h1' },
  { id: 'r-202', number: '202', type: 'double', basePrice: 110, hotelId: 'h1' },
  { id: 'r-103', number: '103', type: 'single', basePrice: 65, hotelId: 'h1' },
]
const CHECK_IN = '2030-03-10'
const CHECK_OUT = '2030-03-12'

function availFixture(): TypeAvailability[] {
  return [
    { roomType: 'double', rooms: 2, booked: 1, available: 1, minBasePrice: 85, capacity: 2,
      perNight: [{ date: '2030-03-10', booked: 0, available: 2 }, { date: '2030-03-11', booked: 1, available: 1 }] },
    { roomType: 'single', rooms: 1, booked: 1, available: 0, minBasePrice: 65, capacity: 1,
      perNight: [{ date: '2030-03-10', booked: 1, available: 0 }, { date: '2030-03-11', booked: 1, available: 0 }] },
    { roomType: 'suite', rooms: 1, booked: 0, available: 1, minBasePrice: 120, capacity: 2,
      perNight: [{ date: '2030-03-10', booked: 0, available: 1 }, { date: '2030-03-11', booked: 0, available: 1 }] },
  ]
}
function quoteFixture(over: Partial<StayQuote> = {}): StayQuote {
  return {
    roomId: null, roomType: 'double', basePrice: 85, nightsCount: 2, subtotal: 170, pricePerNight: 85,
    fromRates: false, closedNights: 0,
    nights: [
      { date: '2030-03-10', season: null, seasonLabel: null, seasonColor: null, price: 85, fromRate: false },
      { date: '2030-03-11', season: null, seasonLabel: null, seasonColor: null, price: 85, fromRate: false },
    ],
    ...over,
  }
}

let wrapper: VueWrapper | null = null
const vm = () => wrapper!.vm as any
const bodyText = () => document.body.textContent ?? ''
// El modal se teleporta a <body>: se consulta el documento, no el wrapper.
const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const textOf = (sel: string) => q(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text)
}

/** Deja el wizard parado en el paso 4 con huésped y fechas cargados (timers de debounce ya vencidos). */
async function openAtStep4(props: Record<string, unknown> = {}) {
  wrapper = mount(ReservationWizardModal, { props: { rooms: ROOMS, editId: null, prefill: null, ...props } })
  await flushPromises()
  vm().form.name = 'Ana Pérez'
  vm().form.email = 'ana@example.com'
  vm().wizardStep = 4
  vm().form.checkIn = CHECK_IN
  vm().form.checkOut = CHECK_OUT
  await vi.advanceTimersByTimeAsync(400)
  await flushPromises()
}

describe('ReservationWizardModal — alta por tipo (REQ-HAC-05)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(ReservationService.typeAvailability).mockResolvedValue(availFixture())
    vi.mocked(ReservationService.stayQuote).mockImplementation(async (input) => quoteFixture({ roomId: input.roomId ?? null, roomType: input.roomType ?? 'double' }))
    vi.mocked(RoomService.list).mockResolvedValue({
      rooms: ROOMS.map((r) => ({ ...r, available: r.id !== 'r-103' })) as never,
      total: ROOMS.length,
    })
    vi.mocked(ReservationService.create).mockResolvedValue({ id: 'res-new' } as never)
    vi.mocked(ReservationService.update).mockResolvedValue({ id: 'res-1' } as never)
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('pide la disponibilidad por tipo para las fechas y arma el selector con "N libres" (agotado = deshabilitado)', async () => {
    await openAtStep4()
    expect(ReservationService.typeAvailability).toHaveBeenCalledWith({ checkIn: CHECK_IN, checkOut: CHECK_OUT, excludeReservationId: undefined })
    const opts = vm().typeOptions as { value: string; label: string; disabled?: boolean }[]
    expect(opts.map(o => o.value)).toEqual(['double', 'single', 'suite'])
    expect(opts[0]).toMatchObject({ label: 'Doble — 1 libre ($85/n)', disabled: false })
    expect(opts[1]).toMatchObject({ label: 'Individual — sin disponibilidad', disabled: true })
    expect(opts[2]).toMatchObject({ label: 'Suite — 1 libre ($120/n)', disabled: false })
    // Sin tipo elegido no hay panel de noches.
    expect(q('[data-testid="wiz-type-availability"]')).toBeNull()
  })

  it('muestra la disponibilidad noche a noche del tipo elegido y la unidad queda en "Asignar después"', async () => {
    await openAtStep4()
    vm().form.roomType = 'double'
    await nextTick()
    expect(q('[data-testid="wiz-type-availability"]')).not.toBeNull()
    expect(textOf('[data-testid="wiz-type-availability"]')).toContain('1 de 2 libres')
    expect(textOf('[data-testid="wiz-type-night-2030-03-10"]')).toContain('2 libres')
    expect(textOf('[data-testid="wiz-type-night-2030-03-11"]')).toContain('1 libre')
    // Selector de unidad: primera opción vacía "Asignar después" + sólo las unidades del tipo.
    const roomOpts = vm().roomOptions as { value: string; label: string }[]
    expect(roomOpts[0]).toEqual({ value: '', label: 'Asignar después' })
    expect(roomOpts.slice(1).map(o => o.value)).toEqual(['r-102', 'r-202'])
    expect(vm().form.roomId).toBe('')
    expect((q('[data-testid="wiz-room-select"] input') as HTMLInputElement).value).toBe('Asignar después')
    // Resumen: el tipo y "asignar después".
    expect(textOf('[data-testid="wiz-stay-summary-title"]')).toBe('Doble — Habitación: asignar después')
  })

  it('sin unidad cotiza por roomType; con unidad, por roomId', async () => {
    await openAtStep4()
    vm().form.roomType = 'double'
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(ReservationService.stayQuote).toHaveBeenLastCalledWith({ roomType: 'double', checkIn: CHECK_IN, checkOut: CHECK_OUT, guests: 2 })
    expect(bodyText()).toContain('$170')

    vm().form.roomId = 'r-202'
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(ReservationService.stayQuote).toHaveBeenLastCalledWith({ roomId: 'r-202', checkIn: CHECK_IN, checkOut: CHECK_OUT, guests: 2 })
    expect(textOf('[data-testid="wiz-stay-summary-title"]')).toBe('Habitación 202 — Doble')
  })

  it('elegir una unidad fija el tipo y cambiar el tipo suelta una unidad de otro tipo', async () => {
    await openAtStep4()
    vm().form.roomId = 'r-101'
    await nextTick()
    expect(vm().form.roomType).toBe('suite')
    vm().form.roomType = 'double'
    await nextTick()
    expect(vm().form.roomId).toBe('')
  })

  it('el tipo es obligatorio y la unidad no: sin tipo no avanza, con tipo y "Asignar después" sí', async () => {
    await openAtStep4()
    findButton('Siguiente')!.click()
    await nextTick()
    expect(vm().wizardStep).toBe(4)
    expect(bodyText()).toContain('Seleccioná un tipo de habitación')
    expect(toastError).toHaveBeenCalled()

    vm().form.roomType = 'double'
    await nextTick()
    findButton('Siguiente')!.click()
    await nextTick()
    expect(vm().wizardStep).toBe(5)
  })

  it('un tipo agotado no deja avanzar sin unidad', async () => {
    await openAtStep4()
    vm().form.roomType = 'single'
    await nextTick()
    findButton('Siguiente')!.click()
    await nextTick()
    expect(vm().wizardStep).toBe(4)
    expect(bodyText()).toContain('Ese tipo no tiene disponibilidad esas fechas')
  })

  it('crea SIN roomId y CON roomType cuando la unidad queda en "Asignar después"', async () => {
    await openAtStep4()
    vm().form.roomType = 'double'
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    vm().wizardStep = 5
    await nextTick()
    expect(textOf('[data-testid="wiz-pay-summary-title"]')).toBe('Doble — Habitación: asignar después')
    findButton('Crear Reserva')!.click()
    await flushPromises()
    await flushPromises()
    expect(ReservationService.create).toHaveBeenCalledTimes(1)
    const body = vi.mocked(ReservationService.create).mock.calls[0][0] as Record<string, unknown>
    expect(body).not.toHaveProperty('roomId')
    expect(body.roomType).toBe('double')
    expect(body.hotelId).toBe('h1')
    expect(body.checkIn).toBe(CHECK_IN)
    expect(toastSuccess).toHaveBeenCalledWith('Reserva creada')
  })

  it('crea con roomId + roomType cuando se eligió una unidad', async () => {
    await openAtStep4()
    vm().form.roomType = 'double'
    vm().form.roomId = 'r-202'
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    vm().wizardStep = 5
    await nextTick()
    findButton('Crear Reserva')!.click()
    await flushPromises()
    await flushPromises()
    const body = vi.mocked(ReservationService.create).mock.calls[0][0] as Record<string, unknown>
    expect(body).toMatchObject({ roomId: 'r-202', roomType: 'double' })
    expect(body).not.toHaveProperty('allowTypeChange')
  })

  it('en edición precarga tipo + unidad, excluye la propia reserva del conteo y no ofrece "Asignar después"', async () => {
    vi.mocked(ReservationService.getById).mockResolvedValue({
      id: 'res-1', hotelId: 'h1', roomId: 'r-202', roomType: 'double', checkIn: CHECK_IN, checkOut: CHECK_OUT,
      adults: 2, children: 0, status: 'confirmed', source: 'direct', totalAmount: 170, deposit: 0,
      guest: { id: 'g1', name: 'Ana Pérez', email: 'ana@example.com' },
    } as never)
    wrapper = mount(ReservationWizardModal, { props: { rooms: ROOMS, editId: 'res-1', prefill: null } })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(vm().form.roomType).toBe('double')
    expect(vm().form.roomId).toBe('r-202')
    expect(ReservationService.typeAvailability).toHaveBeenCalledWith({ checkIn: CHECK_IN, checkOut: CHECK_OUT, excludeReservationId: 'res-1' })
    const roomOpts = vm().roomOptions as { value: string }[]
    expect(roomOpts.map(o => o.value)).toEqual(['r-102', 'r-202'])
    vm().wizardStep = 5
    await nextTick()
    findButton('Actualizar Reserva')!.click()
    await flushPromises()
    await flushPromises()
    expect(ReservationService.update).toHaveBeenCalledTimes(1)
    const [id, body] = vi.mocked(ReservationService.update).mock.calls[0] as [string, Record<string, unknown>]
    expect(id).toBe('res-1')
    expect(body).toMatchObject({ roomId: 'r-202', roomType: 'double' })
  })
})
