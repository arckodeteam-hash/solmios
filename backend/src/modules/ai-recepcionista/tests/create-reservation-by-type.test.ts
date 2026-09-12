// ai-recepcionista/tests/create-reservation-by-type.test.ts — REQ-HAC-05 (#260).
//
// La tool `create_reservation` del bot de Recepción IA elegía "la primera habitación libre del
// tipo" con un solape POR UNIDAD que no veía las reservas confirmadas sin asignar (HAC-01): con
// 1 doble y 1 confirmada sin unidad seguía vendiendo otra. Ahora vende el TIPO: disponibilidad
// por `availableOfType` (fuente única de HAC-02), capacidad y precio por el perfil del tipo
// (`roomTypeProfileOf`) y la fila nace con `roomId: null` + `roomType`; la unidad se asigna al
// check-in. Con `roomId` (compat: el LLM lo saca de `search_availability`) sólo se deduce el tipo.

import { describe, it, expect } from 'bun:test'
import { executeTool } from '../usecases/llm-pipeline'

const HOTEL = 'hotel-a'
const STAY = { checkIn: '2026-07-20', checkOut: '2026-07-22', adults: 2, guestName: 'Ana' }

function repos(over: Partial<{ rooms: any[]; reservations: any[]; blocks: any[] }> = {}) {
  const rooms = over.rooms ?? [{ id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 }]
  const reservations = over.reservations ?? []
  const created: any[] = []
  const pushes: [string, string][] = []
  const r = {
    roomRepo: {
      findById: async (id: string) => rooms.find((x) => x.id === id) ?? null,
      // Como el ORM: filtra por hotel y tipo cuando se los piden.
      findMany: async (q: any = {}) => rooms.filter((x) => (!q.type || x.type === q.type) && (!q.hotelId || x.hotelId === q.hotelId)),
    },
    hotelRepo: { findById: async () => ({ id: HOTEL, name: 'Hotel Demo' }) },
    reservationRepo: {
      findMany: async () => reservations,
      create: async (data: any) => { created.push(data); return { ...data } },
    },
    blockRepo: over.blocks ? { findMany: async () => over.blocks } : undefined,
    guestRepo: { findMany: async () => [], create: async (data: any) => ({ ...data }) },
    onReservationCreated: async (hotelId: string, roomType: string) => { pushes.push([hotelId, roomType]) },
  } as any
  return { r, created, pushes }
}

describe('create_reservation (Recepción IA) — por tipo sin unidad (REQ-HAC-05)', () => {
  it('con roomType y sin roomId: la fila nace con roomId null + roomType', async () => {
    const { r, created } = repos()
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(result.error).toBeUndefined()
    expect(created).toHaveLength(1)
    expect(created[0].roomId).toBeNull()
    expect(created[0].roomType).toBe('double')
    expect(created[0].status).toBe('confirmed')
    expect(result.roomType).toBe('double')
    expect(result.roomId).toBeNull()
  })

  it('el precio sale del perfil del tipo (mínimo basePrice vendible) × noches', async () => {
    const { r, created } = repos({ rooms: [
      { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 120 },
      { id: 'room-2', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 90 },
      { id: 'room-3', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 50, status: 'maintenance' },
    ] })
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(result.pricePerNight).toBe(90)
    expect(result.totalPrice).toBe(180)
    expect(created[0].totalAmount).toBe(180)
  })

  it('tipo agotado: 1 unidad + 1 confirmada del tipo SIN unidad → error claro y no crea', async () => {
    const { r, created } = repos({ reservations: [
      { id: 'res-1', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed', checkIn: '2026-07-19', checkOut: '2026-07-21' },
    ] })
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(result.error).toMatch(/No hay disponibilidad de double/)
    expect(created).toHaveLength(0)
  })

  it('una reserva cancelada del tipo no consume inventario', async () => {
    const { r, created } = repos({ reservations: [
      { id: 'res-1', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'cancelled', checkIn: '2026-07-19', checkOut: '2026-07-21' },
    ] })
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(result.error).toBeUndefined()
    expect(created).toHaveLength(1)
  })

  it('un bloqueo de la única unidad del tipo también agota el tipo', async () => {
    const { r, created } = repos({ blocks: [{ roomId: 'room-1', startDate: '2026-07-21', endDate: '2026-07-25' }] })
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(result.error).toMatch(/No hay disponibilidad/)
    expect(created).toHaveLength(0)
  })

  it('con roomId real (compat): deduce roomType de esa unidad y la fila IGUAL nace con roomId null', async () => {
    const { r, created } = repos({ rooms: [
      { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
      { id: 'suite-1', hotelId: HOTEL, type: 'suite', capacity: 4, basePrice: 300 },
    ] })
    const result: any = await executeTool('create_reservation', { roomId: 'suite-1', ...STAY }, HOTEL, r)
    expect(result.error).toBeUndefined()
    expect(created[0].roomId).toBeNull()
    expect(created[0].roomType).toBe('suite')
    expect(result.roomType).toBe('suite')
    expect(result.message).not.toMatch(/suite-1/)
  })

  it('roomId inexistente → error, no crea', async () => {
    const { r, created } = repos()
    const result: any = await executeTool('create_reservation', { roomId: 'nope', ...STAY }, HOTEL, r)
    expect(result.error).toBeDefined()
    expect(created).toHaveLength(0)
  })

  it('tipo que el hotel no tiene → error, no crea', async () => {
    const { r, created } = repos()
    const result: any = await executeTool('create_reservation', { roomType: 'penthouse', ...STAY }, HOTEL, r)
    expect(result.error).toMatch(/penthouse/)
    expect(created).toHaveLength(0)
  })

  it('sin roomId ni roomType → error', async () => {
    const { r, created } = repos()
    const result: any = await executeTool('create_reservation', { ...STAY }, HOTEL, r)
    expect(result.error).toMatch(/roomId o roomType/)
    expect(created).toHaveLength(0)
  })

  it('la capacidad se valida contra el perfil del tipo (máximo entre sus unidades)', async () => {
    const { r } = repos({ rooms: [
      { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
      { id: 'room-2', hotelId: HOTEL, type: 'double', capacity: 3, basePrice: 100 },
    ] })
    const ok: any = await executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 3 }, HOTEL, r)
    expect(ok.error).toBeUndefined()
    await expect(executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 4 }, HOTEL, r)).rejects.toThrow(/admite hasta 3/)
  })

  it('el push a Channex va por TIPO (onReservationCreated(hotelId, roomType))', async () => {
    const { r, pushes } = repos()
    await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(pushes).toEqual([[HOTEL, 'double']])
  })

  it('el mensaje al huésped habla del tipo, no de un número de habitación', async () => {
    const { r } = repos({ rooms: [{ id: 'room-1', hotelId: HOTEL, type: 'double', number: '101', name: 'Habitación 101', capacity: 2, basePrice: 100 }] })
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY }, HOTEL, r)
    expect(result.message).toContain('tipo double')
    expect(result.message).not.toContain('101')
  })
})

describe('search_availability (Recepción IA) — cuenta por tipo (REQ-HAC-05)', () => {
  it('una confirmada SIN unidad del tipo descuenta una del tipo', async () => {
    const { r } = repos({
      rooms: [
        { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
        { id: 'room-2', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
      ],
      reservations: [
        { id: 'res-1', hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed', checkIn: '2026-07-20', checkOut: '2026-07-22' },
      ],
    })
    const result: any = await executeTool('search_availability', { checkIn: '2026-07-20', checkOut: '2026-07-22' }, HOTEL, r)
    expect(result.available).toBe(1)
    expect(result.summary).toContain('1 double')
  })
})
