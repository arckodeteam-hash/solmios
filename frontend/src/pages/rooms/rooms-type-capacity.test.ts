// rooms-type-capacity.test.ts — Pestaña "Tipos y capacidad" de Habitaciones.
//
// Estos casos vivían en `settings/settings-children-room-types.test.ts` (Requerimiento 2,
// 2026-09-03), cuando la configuración era una pestaña de Configuración → Base. Se mudó acá junto
// con la funcionalidad: definir el inventario estaba partido entre dos entradas del menú.
//
// Qué se protege (idéntico a antes, solo cambia dónde se monta):
//   - Solo lista los tipos que el hotel YA usa, no los 9 del enum: configurar un tipo sin ninguna
//     habitación cargada no tiene con qué aplicarse.
//   - Carga los valores previos de configuration('room_type_capacity').
//   - Valida maxAdults/maxChildren ≤ capacidad.
//   - Al guardar omite los tipos sin capacidad configurada (un tipo que nadie tocó no debe empezar
//     a limitar reservas por accidente).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let roomsData: Record<string, unknown>[] = []
let configGetImpl: (key: string) => Promise<unknown>
const configSet = vi.fn(async (_key: string, _value: unknown) => ({}))

vi.mock('@/services/Room.service', () => ({
  RoomService: {
    list: vi.fn(async () => ({ rooms: roomsData, total: roomsData.length })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    batchCreate: vi.fn(async () => ({ data: [] })),
  },
}))
vi.mock('@/services/Platform.service', () => ({
  ConfigService: { get: (key: string) => configGetImpl(key), set: (key: string, value: unknown) => configSet(key, value) },
}))
vi.mock('@/services/Amenities.service', () => ({
  AmenitiesService: { listRoom: vi.fn(async () => ({ data: [] })), saveRoom: vi.fn(async () => ({ success: true, count: 0 })) },
}))
vi.mock('@/services/Reservation.service', () => ({ ReservationService: { list: vi.fn(async () => ({ reservations: [] })) } }))
vi.mock('@/services/Guest.service', () => ({ GuestService: { list: vi.fn(async () => ({ guests: [] })) } }))
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { hotelId: 'h1', id: 'u1' } }) }))

import Rooms from './index.vue'

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

beforeEach(() => {
  roomsData = []
  configGetImpl = async () => null
  configSet.mockClear()
})

/** Monta la vista y abre la pestaña de tipos (arranca en el listado). */
async function mountTiposTab() {
  wrapper = mount(Rooms, { global: { stubs: { RouterLink: true } } })
  await flushPromises()
  const tab = wrapper.findAll('button').find(b => b.text() === 'Tipos y capacidad')
  await tab?.trigger('click')
  await flushPromises()
  return wrapper
}

describe('Habitaciones → Tipos y capacidad', () => {
  it('sin habitaciones cargadas: estado vacío, no ofrece configurar nada', async () => {
    const w = await mountTiposTab()
    expect(w.text()).toContain('Todavía no cargaste habitaciones')
  })

  it('solo lista los tipos que el hotel YA usa, con su etiqueta en español', async () => {
    roomsData = [{ id: 'r1', type: 'double' }, { id: 'r2', type: 'double' }, { id: 'r3', type: 'family' }]
    const w = await mountTiposTab()
    expect(w.text()).toContain('Doble')
    expect(w.text()).toContain('Familiar')
    expect(w.text()).not.toContain('Presidencial') // tipo no usado por este hotel
  })

  it('carga la capacidad ya configurada por tipo', async () => {
    roomsData = [{ id: 'r1', type: 'double' }]
    configGetImpl = async (key) => (key === 'room_type_capacity' ? { double: { capacity: 2, maxAdults: 2, maxChildren: 1 } } : null)
    const w = await mountTiposTab()
    const inputs = w.findAll('input[type="number"]').map(i => (i.element as HTMLInputElement).value)
    expect(inputs).toEqual(['2', '2', '1'])
  })

  it('maxAdults > capacidad: error visible y botón guardar deshabilitado', async () => {
    roomsData = [{ id: 'r1', type: 'double' }]
    configGetImpl = async (key) => (key === 'room_type_capacity' ? { double: { capacity: 2, maxAdults: 5, maxChildren: 0 } } : null)
    const w = await mountTiposTab()
    expect(w.text()).toContain('Máx. adultos no puede superar la capacidad')
    const card = w.findAll('h3').find(h => h.text() === 'Tipos de habitación y capacidad')!.element.closest('div.rounded-\\[20px\\]')!
    const saveBtn = card.querySelector('button') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)
  })

  it('guarda solo los tipos con capacidad configurada — no persiste un tipo sin tocar', async () => {
    roomsData = [{ id: 'r1', type: 'double' }, { id: 'r2', type: 'suite' }]
    const w = await mountTiposTab()
    // Solo cargamos capacidad para "double" (primer input de capacidad de la lista).
    const capacityInput = w.findAll('input[type="number"]')[0]!
    await capacityInput.setValue(2)
    const card = w.findAll('h3').find(h => h.text() === 'Tipos de habitación y capacidad')!.element.closest('div.rounded-\\[20px\\]')!
    const saveBtn = card.querySelector('button') as HTMLButtonElement
    saveBtn.click()
    await flushPromises()
    expect(configSet).toHaveBeenCalledWith('room_type_capacity', { double: { capacity: 2, maxAdults: null, maxChildren: null } })
  })
})
