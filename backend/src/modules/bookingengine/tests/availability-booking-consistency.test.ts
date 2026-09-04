// bookingengine/tests/availability-booking-consistency.test.ts — Requerimiento 8 (Habitaciones
// compatibles, 2026-09-03): "¿disponibilidad y reserva pueden producir resultados distintos?".
//
// `AvailabilityUseCase` (disponibilidad/búsqueda, lo que ve el huésped en `/rates`) y
// `createPublicBookingDirect` (reserva, lo que el backend AUTORIZA) resuelven capacidad por tipo
// con la MISMA función (`effectiveRoomCapacity`/`fitsRoomCapacity`,
// `shared/usecases/room-type-capacity.ts` + `child-composition.ts`) — no hay una segunda
// implementación que pueda divergir. Este archivo lo prueba de punta a punta: con la MISMA
// configuración `room_type_capacity`, lo que `/rates` ANUNCIA (`capacity`/`maxAdults`/
// `maxChildren` del tipo) es exactamente lo que la reserva ACEPTA o RECHAZA — nunca un número
// para mostrar y otro para cobrar/aceptar.
import { describe, it, expect } from 'bun:test'
import { AvailabilityUseCase } from '../usecases/availability'
import { createPublicBookingDirect } from '../usecases/public-booking'
import type { RepositoryAdapter, CacheAdapter } from 'arckode-framework'

const HOTEL_ID = 'h1'
const noCache = { get: async () => null, set: async () => {} } as unknown as CacheAdapter

// Tipo con capacidad física generosa (6) pero una política de tipo más estricta: capacity=4,
// maxAdults=3, maxChildren=2 — la MISMA en ambos usecases, para probar que no divergen.
const ROOM_TYPE_CAPACITY_VALUE = { family: { capacity: 4, maxAdults: 3, maxChildren: 2 } }
const ROOMS = [
  { id: 'r1', hotelId: HOTEL_ID, type: 'family', capacity: 6, basePrice: 100, status: 'available' },
]

function roomTypeCapacityConfigRepo(): RepositoryAdapter<any> {
  return {
    findOne: async (f: any) => (f.key === 'room_type_capacity' ? { hotelId: HOTEL_ID, key: 'room_type_capacity', value: ROOM_TYPE_CAPACITY_VALUE } : null),
  } as any
}

function repo(rows: any[]): RepositoryAdapter<any> {
  return { findMany: async () => rows, findOne: async () => ({ id: HOTEL_ID, name: 'Hotel' }) } as any
}

describe('Requerimiento 8 — disponibilidad y reserva NO divergen (misma room_type_capacity)', () => {
  it('lo que /rates ANUNCIA (capacity/maxAdults/maxChildren del tipo) es EXACTO, no la capacidad física', async () => {
    const availability = new AvailabilityUseCase(
      noCache, repo(ROOMS), repo([]), repo([]), undefined, undefined, undefined, roomTypeCapacityConfigRepo(),
    )
    const result = await availability.check({ hotelId: HOTEL_ID, checkIn: '2026-10-01', checkOut: '2026-10-02', adults: 1 } as any)
    const family = result.roomTypes.find((t) => t.roomType === 'family')!

    expect(family.capacity).toBe(4) // NO 6 (la física) — la política del tipo manda
    expect(family.maxAdults).toBe(3)
    expect(family.maxChildren).toBe(2)
  })

  it('una composición DENTRO de lo anunciado: reserva aceptada (201)', async () => {
    const orm = {
      findMany: async (model: string, q: any) => {
        if (model === 'Rooms') return ROOMS.filter((r) => (q?.type ? r.type === q.type : true))
        if (model === 'Reservations') return []
        return []
      },
      findById: async (model: string, id: string) => (model === 'Rooms' ? ROOMS.find((r) => r.id === id) ?? null : null),
      create: async (_m: string, data: any) => ({ id: data.id || crypto.randomUUID(), ...data }),
      transaction: async (cb: any) => cb(orm),
      updateMany: async () => 0,
      update: async () => null,
      findOne: async () => null,
    }
    // 3 adultos: EXACTO el maxAdults=3 que /rates anunció arriba — tiene que entrar.
    const res = await createPublicBookingDirect(
      orm, {
        hotelId: HOTEL_ID, roomType: 'family', guestName: 'Ana', guestEmail: 'ana@example.com', guestPhone: '+18095550000',
        checkIn: '2026-10-01', checkOut: '2026-10-02', adults: 3, children: 0,
      },
      undefined, undefined, undefined, undefined, undefined, { config: roomTypeCapacityConfigRepo() },
    )
    expect(res.status).toBe(201)
  })

  it('una composición que EXCEDE lo anunciado (4 adultos > maxAdults=3): reserva rechazada (409) — no se puede reservar lo que /rates ya marca incompatible', async () => {
    const orm = {
      findMany: async (model: string, q: any) => {
        if (model === 'Rooms') return ROOMS.filter((r) => (q?.type ? r.type === q.type : true))
        if (model === 'Reservations') return []
        return []
      },
      findById: async (model: string, id: string) => (model === 'Rooms' ? ROOMS.find((r) => r.id === id) ?? null : null),
      create: async (_m: string, data: any) => ({ id: data.id || crypto.randomUUID(), ...data }),
      transaction: async (cb: any) => cb(orm),
      updateMany: async () => 0,
      update: async () => null,
      findOne: async () => null,
    }
    const res = await createPublicBookingDirect(
      orm, {
        hotelId: HOTEL_ID, roomType: 'family', guestName: 'Ana', guestEmail: 'ana@example.com', guestPhone: '+18095550000',
        checkIn: '2026-10-01', checkOut: '2026-10-02', adults: 4, children: 0,
      },
      undefined, undefined, undefined, undefined, undefined, { config: roomTypeCapacityConfigRepo() },
    )
    expect(res.status).toBe(409)
  })
})
