// restaurante/ReservationPicker.test.ts — #209 (REST-07): buscador de huésped alojado por habitación/apellido.
//   - búsqueda: al montar lista a todos; tipear "204" pide `searchInHouse('204')` (con debounce) y
//     pinta "Hab. 204 · Juan Pérez · 2 noches". Nunca muestra saldo (el mozo no lo ve).
//   - "Sin check-in": una reserva confirmada que llega hoy aparece marcada (REG-1); una alojada, sin badge.
//   - recorte: si el server dice total > filas, avisa "Mostrando N de M".
//   - vacío: sin resultados para "204" dice "No hay huésped alojado en 204."; para texto, «…».
//   - selección: tocar una fila emite update:modelValue con la reserva; con una elegida muestra la
//     ficha y "Cambiar" (que emite null y vuelve al buscador).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { InHouseReservation } from '@/services/Restaurant.service'

let results: InHouseReservation[] = []
let total: number | null = null
const searchCalls: string[] = []
vi.mock('@/services/Restaurant.service', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/Restaurant.service')>()
  return {
    ...mod,
    RestaurantService: {
      ...mod.RestaurantService,
      searchInHouse: vi.fn(async (q: string) => { searchCalls.push(q); return { data: results, total: total ?? results.length } }),
    },
  }
})

const perez: InHouseReservation = { id: 'r-204', hotelId: 'h1', roomId: 'room-204', roomNumber: '204', guestId: 'g1', guestName: 'Juan Pérez', checkIn: '2026-09-10', checkOut: '2026-09-12', nights: 2, status: 'checked_in' }
const garcia: InHouseReservation = { id: 'r-201', hotelId: 'h1', roomId: 'room-201', roomNumber: '201', guestId: 'g2', guestName: 'Ana García', checkIn: '2026-09-11', checkOut: '2026-09-12', nights: 1, status: 'checked_in' }
const lopez: InHouseReservation = { id: 'r-203', hotelId: 'h1', roomId: 'room-203', roomNumber: '203', guestId: 'g3', guestName: 'Luis López', checkIn: '2026-09-11', checkOut: '2026-09-13', nights: 2, status: 'confirmed' }

async function mountPicker(modelValue: InHouseReservation | null = null) {
  const { default: Picker } = await import('./ReservationPicker.vue')
  const w = mount(Picker, { props: { modelValue }, attachTo: document.body })
  await flushPromises()
  return w
}

describe('ReservationPicker', () => {
  beforeEach(() => { vi.useFakeTimers(); searchCalls.length = 0; results = [perez, garcia]; total = null })
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  it('búsqueda: al montar lista a todos los alojados; "204" busca con debounce y muestra la ficha sin saldo', async () => {
    const w = await mountPicker()
    expect(searchCalls).toEqual([''])
    expect(w.findAll('[role="option"]')).toHaveLength(2)
    expect(w.text()).toContain('Hab. 201 · Ana García · 1 noche')
    results = [perez]
    await w.find('input[type="search"]').setValue('204')
    expect(searchCalls).toEqual([''])   // todavía no: debounce
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(searchCalls).toEqual(['', '204'])
    const rows = w.findAll('[role="option"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Hab. 204 · Juan Pérez · 2 noches')
    expect(w.text()).not.toContain('saldo')
    expect(w.text()).not.toContain('150')
    w.unmount()
  })

  it('REG-1: la confirmada que llega hoy se lista con badge "Sin check-in"; la alojada sin badge; la ficha elegida también lo muestra', async () => {
    results = [garcia, lopez]
    const w = await mountPicker()
    const rows = w.findAll('[role="option"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('[data-testid="reservation-status"]').exists()).toBe(false)
    expect(rows[1].find('[data-testid="reservation-status"]').text()).toBe('Sin check-in')
    await w.setProps({ modelValue: lopez })
    expect(w.find('[data-testid="reservation-picker-selected"] [data-testid="reservation-status"]').text()).toBe('Sin check-in')
    w.unmount()
  })

  it('recorte: total mayor que las filas → "Mostrando 2 de 73"; sin recorte no hay aviso', async () => {
    total = 73
    const w = await mountPicker()
    expect(w.find('[data-testid="reservation-picker-truncated"]').text()).toContain('Mostrando 2 de 73')
    total = 2
    await w.find('input[type="search"]').setValue('20')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(w.find('[data-testid="reservation-picker-truncated"]').exists()).toBe(false)
    w.unmount()
  })

  it('vacío: habitación sin huésped alojado → "No hay huésped alojado en 204."; texto → «…»', async () => {
    const w = await mountPicker()
    results = []
    await w.find('input[type="search"]').setValue('204')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(w.find('[data-testid="reservation-picker-empty"]').text()).toBe('No hay huésped alojado en 204.')
    expect(w.findAll('[role="option"]')).toHaveLength(0)
    await w.find('input[type="search"]').setValue('lopez')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(w.find('[data-testid="reservation-picker-empty"]').text()).toBe('No hay huésped alojado que coincida con «lopez».')
    w.unmount()
  })

  it('selección: tocar una fila emite la reserva; con una elegida muestra la ficha y "Cambiar" vuelve al buscador', async () => {
    const w = await mountPicker()
    await w.find('button[data-reservation="r-204"]').trigger('click')
    expect(w.emitted('update:modelValue')).toEqual([[perez]])
    await w.setProps({ modelValue: perez })
    const chip = w.find('[data-testid="reservation-picker-selected"]')
    expect(chip.exists()).toBe(true)
    expect(chip.text()).toContain('Hab. 204 · Juan Pérez · 2 noches')
    expect(w.find('input[type="search"]').exists()).toBe(false)
    await chip.find('button').trigger('click')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual([null])
    await w.setProps({ modelValue: null })
    await flushPromises()
    expect(w.find('input[type="search"]').exists()).toBe(true)
    w.unmount()
  })

  it('error del servicio: aviso y sin filas (no se confunde con "no hay alojados")', async () => {
    const { RestaurantService } = await import('@/services/Restaurant.service')
    ;(RestaurantService.searchInHouse as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { throw new Error('Sin permiso') })
    const w = await mountPicker()
    expect(w.find('[role="alert"]').text()).toBe('Sin permiso')
    expect(w.find('[data-testid="reservation-picker-empty"]').exists()).toBe(false)
    w.unmount()
  })
})
