// reservation-capacity.test.ts — Auditoría de integridad (cierre, 2026-09-04).
//
// `assertReservationFitsCapacity` es el ÚNICO punto que valida capacidad para Administración
// (`reservas/usecases/crud.ts`, creación y edición) y los agentes de IA (`ai-gerente`,
// `ai-recepcionista`) — reutiliza `fitsRoomCapacity`/`effectiveRoomCapacity`/`resolveChildPolicy`,
// las MISMAS funciones que ya usa el motor público y el reagendado. Cero reglas nuevas.

import { describe, it, expect } from 'bun:test'
import { assertReservationFitsCapacity } from '../reservation-capacity'

const HOTEL = 'h1'

function configRepo(rows: { childPolicy?: any; roomTypeCapacity?: Record<string, any> } = {}) {
  return {
    findOne: async (f: { hotelId: string; key: string }) => {
      if (f.key === 'child_policy' && rows.childPolicy) return { hotelId: HOTEL, key: 'child_policy', value: rows.childPolicy }
      if (f.key === 'room_type_capacity' && rows.roomTypeCapacity) return { hotelId: HOTEL, key: 'room_type_capacity', value: rows.roomTypeCapacity }
      return null
    },
  } as any
}

describe('assertReservationFitsCapacity', () => {
  it('sin room (no encontrada/no resuelta por el caller): no-op, no revienta', async () => {
    await expect(assertReservationFitsCapacity(undefined, null, { hotelId: HOTEL, adults: 20, children: 0 })).resolves.toBeUndefined()
  })

  it('rechaza cuando la composición conservadora (sin childrenAges) excede la capacidad total', async () => {
    const room = { type: 'double', capacity: 2 }
    const call = assertReservationFitsCapacity(configRepo(), room, { hotelId: HOTEL, adults: 2, children: 1 })
    await expect(call).rejects.toThrow('Esta habitación admite hasta 2 huésped(es); la reserva tiene 3')
  })

  it('acepta cuando entra', async () => {
    const room = { type: 'double', capacity: 3 }
    await expect(assertReservationFitsCapacity(configRepo(), room, { hotelId: HOTEL, adults: 2, children: 1 })).resolves.toBeUndefined()
  })

  it('con childrenAges reales: un niño libre no bloquea aunque el conteo crudo sí lo haría', async () => {
    const room = { type: 'double', capacity: 2 }
    const policy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 5 }
    await expect(assertReservationFitsCapacity(configRepo({ childPolicy: policy }), room, {
      hotelId: HOTEL, adults: 2, children: 1, childrenAges: [3],
    })).resolves.toBeUndefined()
  })

  it('respeta room_type_capacity (por tipo) sobre la capacidad física de la habitación', async () => {
    const room = { type: 'double', capacity: 6 } // física: sobra
    const call = assertReservationFitsCapacity(
      configRepo({ roomTypeCapacity: { double: { capacity: 2, maxAdults: 2, maxChildren: 0 } } }),
      room, { hotelId: HOTEL, adults: 4, children: 0 },
    )
    await expect(call).rejects.toThrow('admite hasta 2')
  })

  it('rechaza por maxAdults aunque la capacidad total alcance', async () => {
    const room = { type: 'double', capacity: 4, maxAdults: 1 }
    const call = assertReservationFitsCapacity(configRepo(), room, { hotelId: HOTEL, adults: 2, children: 0 })
    await expect(call).rejects.toThrow('admite hasta 4')
  })

  it('sin configRepo: cae a la capacidad física de la habitación (retrocompatible)', async () => {
    const room = { type: 'double', capacity: 2 }
    const call = assertReservationFitsCapacity(undefined, room, { hotelId: HOTEL, adults: 4, children: 0 })
    await expect(call).rejects.toThrow('admite hasta 2')
  })
})
