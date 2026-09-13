// reservation-capacity.test.ts — Auditoría de integridad (cierre, 2026-09-04).
//
// `assertReservationFitsCapacity` es el ÚNICO punto que valida capacidad para Administración
// (`reservas/usecases/crud.ts`, creación y edición) y los agentes de IA (`ai-gerente`,
// `ai-recepcionista`) — reutiliza `fitsRoomCapacity`/`effectiveRoomCapacity`/`resolveChildPolicy`,
// las MISMAS funciones que ya usa el motor público y el reagendado. REQ-03 (#235) suma el tope de
// niños sin plaza (`freeChildrenLimitError`), también compartido con el motor público.

import { describe, it, expect } from 'bun:test'
import { ConflictError } from 'arckode-framework'
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

describe('assertReservationFitsCapacity — REQ-03 (#235) máximo de niños que no consumen plaza', () => {
  const room = { type: 'family', capacity: 4 }
  const policy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 5, maxFreeChildrenPerRoom: 2 }

  it('rechaza con ConflictError cuando hay más niños libres que el máximo (3 libres, max 2)', async () => {
    const call = assertReservationFitsCapacity(configRepo({ childPolicy: policy }), room, {
      hotelId: HOTEL, adults: 2, children: 3, childrenAges: [1, 2, 3],
    })
    await expect(call).rejects.toBeInstanceOf(ConflictError)
    await expect(call).rejects.toThrow('no consumen plaza')
    await expect(call).rejects.toThrow('Esta habitación admite hasta 2 niño(s) que no consumen plaza; la reserva tiene 3')
  })

  it('acepta cuando los niños libres no superan el máximo (2 libres, max 2)', async () => {
    await expect(assertReservationFitsCapacity(configRepo({ childPolicy: policy }), room, {
      hotelId: HOTEL, adults: 2, children: 2, childrenAges: [1, 2],
    })).resolves.toBeUndefined()
  })

  it('sin childrenAges no aplica: la composición conservadora no tiene niños libres que contar', async () => {
    await expect(assertReservationFitsCapacity(configRepo({ childPolicy: policy }), { type: 'family', capacity: 5 }, {
      hotelId: HOTEL, adults: 2, children: 3,
    })).resolves.toBeUndefined()
  })

  it('policy sin maxFreeChildrenPerRoom (null = sin límite): 3 libres pasan', async () => {
    const { maxFreeChildrenPerRoom: _omit, ...unlimited } = policy
    await expect(assertReservationFitsCapacity(configRepo({ childPolicy: unlimited }), room, {
      hotelId: HOTEL, adults: 2, children: 3, childrenAges: [1, 2, 3],
    })).resolves.toBeUndefined()
  })
})

describe('assertReservationFitsCapacity — revisión #260 (3ª pasada): `units` decide por unidad, `room` sólo es el mensaje', () => {
  const units = [
    { id: 'a', type: 'familiar', capacity: 6, maxAdults: 6, maxChildren: 0 },
    { id: 'b', type: 'familiar', capacity: 2, maxAdults: 1, maxChildren: 1 },
  ]
  const profile = { type: 'familiar', capacity: 6, maxAdults: 6, maxChildren: 1 }

  it('5 adultos + 1 niño: el perfil agregado lo admite pero ninguna unidad → 409 con mensaje por composición', async () => {
    // Sin `units` (unidad concreta con esos límites) pasa; con `units` rebota.
    await expect(assertReservationFitsCapacity(configRepo(), profile, { hotelId: HOTEL, adults: 5, children: 1 })).resolves.toBeUndefined()
    let err: any = null
    try { await assertReservationFitsCapacity(configRepo(), profile, { hotelId: HOTEL, adults: 5, children: 1, units }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toContain('Ninguna habitación de tipo "familiar"')
    expect(err.message).toContain('5 adulto(s) y 1 niño(s)')
  })

  it('1 adulto + 1 niño entra (familiar chica); 7 adultos supera el total → mensaje clásico "admite hasta 6"', async () => {
    await expect(assertReservationFitsCapacity(configRepo(), profile, { hotelId: HOTEL, adults: 1, children: 1, units })).resolves.toBeUndefined()
    await expect(assertReservationFitsCapacity(configRepo(), profile, { hotelId: HOTEL, adults: 7, children: 0, units })).rejects.toThrow(/admite hasta 6/)
  })

  it('con política room_type_capacity para el tipo, decide la política (uniforme para todas las unidades)', async () => {
    const repo = configRepo({ roomTypeCapacity: { familiar: { capacity: 4, maxAdults: 3, maxChildren: 2 } } })
    await expect(assertReservationFitsCapacity(repo, profile, { hotelId: HOTEL, adults: 2, children: 2, units })).resolves.toBeUndefined()
    await expect(assertReservationFitsCapacity(repo, profile, { hotelId: HOTEL, adults: 4, children: 0, units })).rejects.toThrow(ConflictError)
  })
})
