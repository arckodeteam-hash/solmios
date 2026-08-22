// rooms.test.ts — Regresiones de la auditoría qa-ui/habitaciones-2026-08-21 (A1/A4/A10)
// + mejoras de facilidad del modal pedidas por el dueño.
//
// Lo que se protege acá:
//   1. Validación inline real: número vacío/duplicado y precio inválido muestran error bajo el
//      campo ANTES del submit, y Guardar queda deshabilitado (no sale ningún request).
//   2. Superficie arranca VACÍA en "Nueva" (antes default 0) y en edición carga el valor real.
//   3. Editar conserva y persiste TODOS los campos: superficie, baños, venta online, amenities.
//   4. Eliminar confirma con el NÚMERO y el toast de éxito dice qué habitación se borró.
//   5. Exportar CSV baja un archivo con todas las columnas del listado (respeta filtros).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

let roomsData: Record<string, unknown>[] = []
const created: Record<string, unknown>[] = []

vi.mock('@/services/Room.service', () => ({
  RoomService: {
    list: vi.fn(async () => ({ rooms: roomsData, total: roomsData.length })),
    create: vi.fn(async (input: Record<string, unknown>) => {
      const room = { id: 'nueva-1', amenities: [], ...input }
      created.push(room)
      return room
    }),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
    batchCreate: vi.fn(async () => ({ data: [] })),
  },
}))
const amenitiesByRoom: Record<string, string[]> = {}
vi.mock('@/services/Amenities.service', () => ({
  AmenitiesService: {
    listRoom: vi.fn(async (roomId: string) => ({ data: (amenitiesByRoom[roomId] || []).map(amenityKey => ({ amenityKey })) })),
    saveRoom: vi.fn(async () => ({ success: true, count: 0 })),
  },
}))
vi.mock('@/services/Reservation.service', () => ({
  ReservationService: { list: vi.fn(async () => ({ reservations: [] })) },
}))
vi.mock('@/services/Guest.service', () => ({
  GuestService: { list: vi.fn(async () => ({ guests: [] })) },
}))
// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() para poder asertar.
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { hotelId: 'h1', id: 'u1' } }),
}))

import Rooms from './index.vue'
import { RoomService } from '@/services/Room.service'
import { AmenitiesService } from '@/services/Amenities.service'
import { useToast } from '@/composables/useToast'

const toast = useToast()

function room(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', number: '101', type: 'double', floor: 1, status: 'available',
    maxGuests: 2, basePrice: 80, surfaceArea: 25, bathrooms: 2,
    onlineBookingEnabled: false, amenities: [],
    ...over,
  }
}

// Los modales van por <Teleport to="body">: sin cleanup, el body acumula los de tests
// anteriores y los querySelector pescan inputs viejos.
let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

async function render() {
  wrapper = mount(Rooms)
  await flushPromises()
  await flushPromises()
  return wrapper
}

/** Abre el modal de edición de una habitación: click en la card → detalle → Editar. */
async function openEdit(w: Awaited<ReturnType<typeof render>>, roomId: string) {
  const card = w.findAll('.cursor-pointer').find(c => c.text().includes(roomId === 'r1' ? '101' : '102'))
  await card!.trigger('click')
  await flushPromises()
  const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Editar')
  editBtn!.click()
  await flushPromises()
}

const bodyText = () => document.body.textContent || ''
const bodyInput = (id: string) => document.getElementById(id) as HTMLInputElement

describe('rooms — validación inline del modal (A4)', () => {
  beforeEach(() => {
    roomsData = [room()]
    amenitiesByRoom.r1 = ['wifi']
    created.length = 0
    vi.clearAllMocks()
  })

  it('número vacío: error bajo el campo al blur, Guardar deshabilitado y cero requests', async () => {
    const w = await render()
    const nueva = w.findAll('button').find(b => b.text().trim() === 'Nueva')
    await nueva!.trigger('click')
    await flushPromises()

    const numberInput = bodyInput('room-number')
    expect(numberInput.value).toBe('')
    numberInput.dispatchEvent(new Event('blur'))
    await flushPromises()

    expect(bodyText()).toContain('El número es obligatorio')
    const guardar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar'))
    expect(guardar).toBeTruthy()
    expect((guardar as HTMLButtonElement).disabled).toBe(true)

    guardar!.click()
    await flushPromises()
    expect(RoomService.create).not.toHaveBeenCalled()
  })

  it('número duplicado (case-insensitive): "Ya existe la habitación 101"', async () => {
    const w = await render()
    await w.findAll('button').find(b => b.text().trim() === 'Nueva')!.trigger('click')
    await flushPromises()

    const numberInput = bodyInput('room-number')
    numberInput.value = '101'
    numberInput.dispatchEvent(new Event('input'))
    numberInput.dispatchEvent(new Event('blur'))
    await flushPromises()

    expect(bodyText()).toContain('Ya existe la habitación 101')
    const guardar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar'))
    expect((guardar as HTMLButtonElement).disabled).toBe(true)
  })

  it('número propio al editar NO cuenta como duplicado', async () => {
    const w = await render()
    await openEdit(w, 'r1')

    expect(bodyText()).not.toContain('Ya existe la habitación 101')
    const guardar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar'))
    expect((guardar as HTMLButtonElement).disabled).toBe(false)
  })

  it('precio vacío: error inline y Guardar deshabilitado', async () => {
    const w = await render()
    await w.findAll('button').find(b => b.text().trim() === 'Nueva')!.trigger('click')
    await flushPromises()

    bodyInput('room-number').value = '202'
    bodyInput('room-number').dispatchEvent(new Event('input'))

    const price = bodyInput('room-base-price')
    price.value = ''
    price.dispatchEvent(new Event('input'))
    price.dispatchEvent(new Event('blur'))
    await flushPromises()

    expect(bodyText()).toContain('Ingresá un precio válido')
    const guardar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar'))
    expect((guardar as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('rooms — superficie vacía por default (A4, hallazgo 3)', () => {
  beforeEach(() => { roomsData = [room()]; amenitiesByRoom.r1 = []; vi.clearAllMocks() })

  it('Nueva: el campo Superficie arranca vacío, no en 0', async () => {
    const w = await render()
    await w.findAll('button').find(b => b.text().trim() === 'Nueva')!.trigger('click')
    await flushPromises()
    expect(bodyInput('room-surface-area').value).toBe('')
    expect(bodyInput('room-surface-area').placeholder).toBe('opcional')
  })

  it('editar una habitación SIN superficie (0) también muestra el campo vacío', async () => {
    roomsData = [room({ surfaceArea: 0 })]
    const w = await render()
    await openEdit(w, 'r1')
    expect(bodyInput('room-surface-area').value).toBe('')
  })

  it('crear con superficie vacía manda 0 a la API (el modelo no acepta null)', async () => {
    const w = await render()
    await w.findAll('button').find(b => b.text().trim() === 'Nueva')!.trigger('click')
    await flushPromises()
    bodyInput('room-number').value = '202'
    bodyInput('room-number').dispatchEvent(new Event('input'))
    await flushPromises() // nextTick: el :disabled se actualiza async aunque formValid ya sea true

    const guardar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar')) as HTMLButtonElement
    guardar.click()
    await flushPromises()

    expect(RoomService.create).toHaveBeenCalledWith(expect.objectContaining({ number: '202', surfaceArea: 0 }))
  })
})

describe('rooms — editar conserva todos los campos (facilidad del dueño)', () => {
  beforeEach(() => {
    roomsData = [room({ surfaceArea: 30, bathrooms: 2, onlineBookingEnabled: false })]
    amenitiesByRoom.r1 = ['wifi', 'kitchen']
    vi.clearAllMocks()
  })

  it('el form carga superficie, baños, venta online y amenities de la habitación', async () => {
    const w = await render()
    await openEdit(w, 'r1')

    expect(bodyInput('room-surface-area').value).toBe('30')
    expect(bodyInput('room-bathrooms').value).toBe('2')
    expect((document.getElementById('room-online-booking') as HTMLInputElement).checked).toBe(false)
    // amenities cargadas: chips activas (fondo navy) — cuentan 2 de las agrupadas
    expect(bodyText()).toContain('Confort')
    expect(bodyText()).toContain('Cocina')
    expect(bodyText()).toContain('2 seleccionadas')
  })

  it('Guardar persiste TODO el payload: superficie, baños, onlineBookingEnabled, amenities', async () => {
    const w = await render()
    await openEdit(w, 'r1')

    const guardar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Guardar')) as HTMLButtonElement
    guardar.click()
    await flushPromises()

    expect(RoomService.update).toHaveBeenCalledWith('r1', expect.objectContaining({
      surfaceArea: 30, bathrooms: 2, onlineBookingEnabled: false, number: '101',
    }))
    expect(AmenitiesService.saveRoom).toHaveBeenCalledWith('r1', ['wifi', 'kitchen'])
  })
})

describe('rooms — eliminar con confirmación y toast con nombre (A10)', () => {
  beforeEach(() => { roomsData = [room()]; amenitiesByRoom.r1 = []; vi.clearAllMocks() })

  it('confirma con el NÚMERO y el toast de éxito dice qué habitación se eliminó', async () => {
    const w = await render()
    const card = w.findAll('.cursor-pointer').find(c => c.text().includes('101'))
    await card!.trigger('click')
    await flushPromises()

    // "Eliminar" del footer del detalle
    const eliminar = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Eliminar')
    eliminar!.click()
    await flushPromises()

    expect(bodyText()).toContain('¿Eliminar habitación 101?')

    // El ConfirmModal se agrega DESPUÉS en el body: su "Eliminar" es el último de los dos.
    const footerBtn = Array.from(document.querySelectorAll('button')).reverse().find(b => b.textContent?.trim() === 'Eliminar')
    footerBtn!.click()
    await flushPromises()

    expect(RoomService.delete).toHaveBeenCalledWith('r1')
    expect(toast.success).toHaveBeenCalledWith('Habitación 101 eliminada')
  })
})

describe('rooms — export CSV del listado (A1, hallazgo 2)', () => {
  let blobs: Blob[] = []

  beforeEach(() => {
    roomsData = [room({ amenities: [] }), room({ id: 'r2', number: '102', type: 'suite', basePrice: 150, surfaceArea: 0 })]
    amenitiesByRoom.r1 = ['wifi', 'tv']
    amenitiesByRoom.r2 = []
    created.length = 0
    blobs = []
    vi.clearAllMocks()
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { blobs.push(b as Blob); return 'blob:mock' })
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('exporta columnas completas con las amenities como texto y toast de éxito', async () => {
    const w = await render()
    const btn = w.findAll('button').find(b => b.text().includes('Exportar CSV'))
    expect(btn).toBeTruthy()
    await btn!.trigger('click')

    expect(blobs.length).toBe(1)
    const csv = (await blobs[0].text()).replace(/^﻿/, '') // BOM para Excel
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Número,Tipo,Estado,Piso,Capacidad,Precio,Amenities')
    // amenities con ';' van entrecomilladas (escape CSV correcto)
    expect(csv).toContain('101,Doble,Disponible,1,2,80,"WiFi; TV"')
    expect(csv).toContain('102,')
    expect(toast.success).toHaveBeenCalledWith('CSV exportado (2 habitaciones)')
  })

  it('respeta el filtro de estado activo', async () => {
    roomsData = [room(), room({ id: 'r2', number: '102', status: 'occupied' })]
    amenitiesByRoom.r1 = []
    amenitiesByRoom.r2 = []
    const w = await render()
    await w.find('#rooms-filter').setValue('occupied')
    await w.findAll('button').find(b => b.text().includes('Exportar CSV'))!.trigger('click')

    const csv = await blobs[0].text()
    expect(csv).toContain('102')
    expect(csv).not.toContain('101,')
  })
})
