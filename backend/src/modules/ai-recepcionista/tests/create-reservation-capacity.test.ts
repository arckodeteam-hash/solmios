// ai-recepcionista/tests/create-reservation-capacity.test.ts — Auditoría de integridad
// (cierre, 2026-09-04).
//
// La tool `create_reservation` del bot de Recepción IA escribía directo con
// `reservationRepo.create`, sin ningún chequeo de capacidad — a diferencia del panel
// (`reservas/usecases/crud.ts`) y del motor público. Cambio mínimo: reutiliza
// `assertReservationFitsCapacity` (shared/usecases/reservation-capacity.ts, la MISMA función que
// ahora también valida `crud.ts` y la tool equivalente del Gerente IA), no copia ninguna regla.

import { describe, it, expect } from 'bun:test'
import { executeTool } from '../usecases/llm-pipeline'

const HOTEL = 'hotel-a'

function repos(over: Partial<{ rooms: Record<string, any>; configRow: any }> = {}) {
  const rooms = over.rooms ?? { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 2, basePrice: 100 } }
  return {
    roomRepo: {
      findById: async (id: string) => rooms[id] ?? null,
      findMany: async () => Object.values(rooms),
    },
    hotelRepo: { findById: async () => ({ id: HOTEL, name: 'Hotel Demo' }) },
    reservationRepo: {
      findMany: async () => [],
      create: async (data: any) => ({ ...data }),
    },
    guestRepo: {
      findMany: async () => [],
      create: async (data: any) => ({ ...data }),
    },
    configRepo: over.configRow !== undefined ? { findOne: async () => over.configRow } : undefined,
  } as any
}

describe('create_reservation (Recepción IA) — capacidad (auditoría de integridad, cierre)', () => {
  it('rechaza una reserva que excede la capacidad de la habitación', async () => {
    const call = executeTool(
      'create_reservation',
      { roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22', adults: 5, guestName: 'Ana' },
      HOTEL, repos(),
    )
    await expect(call).rejects.toThrow(/admite hasta 2/)
  })

  it('acepta una reserva dentro de la capacidad', async () => {
    const result: any = await executeTool(
      'create_reservation',
      { roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22', adults: 2, guestName: 'Ana' },
      HOTEL, repos(),
    )
    expect(result.reservationId).toBeTruthy()
    expect(result.status).toBe('confirmed')
  })

  it('respeta maxAdults del tipo aunque la capacidad total alcance', async () => {
    const rooms = { 'room-1': { id: 'room-1', hotelId: HOTEL, type: 'double', capacity: 4, maxAdults: 1, basePrice: 100 } }
    const call = executeTool(
      'create_reservation',
      { roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22', adults: 2, guestName: 'Ana' },
      HOTEL, repos({ rooms }),
    )
    await expect(call).rejects.toThrow(/admite hasta 4/)
  })

  it('sin configRepo cableado: sigue validando contra la capacidad de la habitación física (fallback)', async () => {
    const call = executeTool(
      'create_reservation',
      { roomId: 'room-1', checkIn: '2026-07-20', checkOut: '2026-07-22', adults: 10, guestName: 'Ana' },
      HOTEL, repos({ configRow: undefined }),
    )
    await expect(call).rejects.toThrow(/admite hasta 2/)
  })
})
