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

  it('roomId de OTRO hotel (o sin hotelId) → error, no crea', async () => {
    const { r, created } = repos({ rooms: [
      { id: 'ajena', hotelId: 'hotel-b', type: 'double', capacity: 2, basePrice: 100 },
      { id: 'huerfana', type: 'double', capacity: 2, basePrice: 100 },
    ] })
    for (const roomId of ['ajena', 'huerfana']) {
      const result: any = await executeTool('create_reservation', { roomId, ...STAY }, HOTEL, r)
      expect(result.error).toBeDefined()
    }
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

  // Revisión #260 (3ª pasada) — la composición entra si ALGUNA unidad LIBRE la admite con sus tres
  // límites a la vez (`someUnitFits`), no si entra en el perfil agregado del tipo. La tool no
  // recibe `children` (siempre 0), así que el repro es por adultos y por unidad ocupada.
  const mixedLimits = [
    // "familiar": 2 adultos + 4 niños. Sola, aporta capacity 6 al agregado; con 3 adultos no sirve.
    { id: 'room-fam', hotelId: HOTEL, type: 'double', capacity: 6, maxAdults: 2, maxChildren: 4, basePrice: 100 },
    // "triple": sin maxAdults (sin límite configurado) — admite 3 adultos por `capacity`.
    { id: 'room-3', hotelId: HOTEL, type: 'double', capacity: 3, basePrice: 100 },
  ]

  it('adults:3 entra en la "triple" (maxAdults null) aunque la "familiar" limite a 2 — el agregado {6, maxAdults 2} lo rechazaba', async () => {
    const { r, created } = repos({ rooms: mixedLimits })
    const ok: any = await executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 3 }, HOTEL, r)
    expect(ok.error).toBeUndefined()
    expect(created).toHaveLength(1)
    expect(created[0].roomId).toBeNull()
  })

  it('adults:4: ninguna unidad lo admite (familiar por maxAdults, triple por capacity) → 409 con mensaje por composición', async () => {
    const { r, created } = repos({ rooms: mixedLimits })
    await expect(executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 4 }, HOTEL, r)).rejects.toThrow(/Ninguna habitación de tipo "double"/)
    expect(created).toHaveLength(0)
  })

  it('capacidad sólo sobre unidades LIBRES: la grande ocupada por una reserva ASIGNADA que solapa → adults:5 → 409; libre → crea', async () => {
    const rooms = [
      { id: 'room-2', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
      { id: 'room-6', hotelId: HOTEL, type: 'double', capacity: 6, basePrice: 100 },
    ]
    const busy = { id: 'res-1', hotelId: HOTEL, roomId: 'room-6', roomType: 'double', status: 'confirmed', checkIn: '2026-07-20', checkOut: '2026-07-22' }
    const { r, created } = repos({ rooms, reservations: [busy] })
    let err: any = null
    try { await executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 5 }, HOTEL, r) } catch (e) { err = e }
    expect(err?.httpStatus).toBe(409)
    expect(err?.message).toMatch(/admite hasta 2/)
    expect(created).toHaveLength(0)
    // Bloqueada una noche: ídem.
    const blocked = repos({ rooms, blocks: [{ roomId: 'room-6', startDate: '2026-07-21', endDate: '2026-07-21' }] })
    await expect(executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 5 }, HOTEL, blocked.r)).rejects.toThrow(/admite hasta 2/)
    // Ocupada en fechas que NO solapan → la grande está libre → crea.
    const free = repos({ rooms, reservations: [{ ...busy, checkIn: '2026-07-22', checkOut: '2026-07-24' }] })
    const ok: any = await executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 5 }, HOTEL, free.r)
    expect(ok.error).toBeUndefined()
    expect(free.created).toHaveLength(1)
  })

  it('available ≥ 1 noche a noche pero NINGUNA unidad libre toda la ventana → error claro, no crea', async () => {
    const rooms = [
      { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
      { id: 'room-2', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 },
    ]
    const { r, created } = repos({
      rooms,
      reservations: [{ id: 'res-1', hotelId: HOTEL, roomId: 'room-1', roomType: 'double', status: 'confirmed', checkIn: '2026-07-20', checkOut: '2026-07-21' }],
      blocks: [{ roomId: 'room-2', startDate: '2026-07-21', endDate: '2026-07-21' }],
    })
    const result: any = await executeTool('create_reservation', { roomType: 'double', ...STAY, adults: 1 }, HOTEL, r)
    expect(result.error).toMatch(/ninguna unidad del tipo queda libre/)
    expect(created).toHaveLength(0)
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
