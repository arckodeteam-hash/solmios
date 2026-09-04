// shared/usecases/tests/room-type-capacity.test.ts — Requerimiento 2 (capacidad por tipo,
// 2026-09-03). Cubre el resolver puro (`effectiveRoomCapacity`) y la lectura de Configuration
// (`resolveRoomTypeCapacityMap`), incluyendo saneo de valores corruptos.
import { describe, it, expect } from 'bun:test'
import { resolveRoomTypeCapacityMap, effectiveRoomCapacity, type RoomTypeCapacity } from '../room-type-capacity'

function configRepo(value?: unknown) {
  return { findOne: async (filter: any) => (filter.key === 'room_type_capacity' ? { hotelId: filter.hotelId, key: 'room_type_capacity', value } : null) } as any
}

describe('resolveRoomTypeCapacityMap', () => {
  it('sin configRepo → Map vacío (fallback total a la habitación física)', async () => {
    const map = await resolveRoomTypeCapacityMap(undefined, 'h1')
    expect(map.size).toBe(0)
  })

  it('sin fila configurada → Map vacío', async () => {
    const map = await resolveRoomTypeCapacityMap(configRepo(undefined), 'h1')
    expect(map.size).toBe(0)
  })

  it('lee la política de cada tipo configurado', async () => {
    const map = await resolveRoomTypeCapacityMap(
      configRepo({ double: { capacity: 2, maxAdults: 2, maxChildren: 2 }, suite: { capacity: 4, maxAdults: 3, maxChildren: 2 } }),
      'h1',
    )
    expect(map.get('double')).toEqual({ capacity: 2, maxAdults: 2, maxChildren: 2 })
    expect(map.get('suite')).toEqual({ capacity: 4, maxAdults: 3, maxChildren: 2 })
    expect(map.get('twin')).toBeUndefined()
  })

  it('value como string JSON (mismo formato que otras keys de Configuration)', async () => {
    const map = await resolveRoomTypeCapacityMap(configRepo(JSON.stringify({ double: { capacity: 2 } })), 'h1')
    expect(map.get('double')?.capacity).toBe(2)
  })

  it('capacity ausente/≤0/no numérica: la entrada se descarta entera', async () => {
    const map = await resolveRoomTypeCapacityMap(
      configRepo({ a: { maxAdults: 2 }, b: { capacity: 0 }, c: { capacity: -1 }, d: { capacity: 'x' } }),
      'h1',
    )
    expect(map.size).toBe(0)
  })

  it('maxAdults/maxChildren inválidos caen a null (no tumban la capacity válida)', async () => {
    const map = await resolveRoomTypeCapacityMap(configRepo({ double: { capacity: 2, maxAdults: 'x', maxChildren: -1 } }), 'h1')
    expect(map.get('double')).toEqual({ capacity: 2, maxAdults: null, maxChildren: null })
  })

  it('maxChildren: 0 es un valor válido (habitación que no admite niños) — no debe caer a null', async () => {
    const map = await resolveRoomTypeCapacityMap(configRepo({ single: { capacity: 1, maxAdults: 1, maxChildren: 0 } }), 'h1')
    expect(map.get('single')?.maxChildren).toBe(0)
  })

  it('value corrupto (no es un objeto) → Map vacío, no revienta', async () => {
    const map = await resolveRoomTypeCapacityMap(configRepo('garbage'), 'h1')
    expect(map.size).toBe(0)
  })
})

describe('effectiveRoomCapacity', () => {
  it('usa la política del tipo cuando existe, IGNORANDO por completo los campos de la habitación física', () => {
    const map = new Map<string, RoomTypeCapacity>([['double', { capacity: 2, maxAdults: 2, maxChildren: 1 }]])
    const result = effectiveRoomCapacity(map, { type: 'double', capacity: 99, maxAdults: 99, maxChildren: 99 })
    expect(result).toEqual({ capacity: 2, maxAdults: 2, maxChildren: 1 })
  })

  it('sin política para ese tipo → cae a la habitación física (comportamiento actual intacto)', () => {
    const map = new Map<string, RoomTypeCapacity>([['double', { capacity: 2, maxAdults: 2, maxChildren: 1 }]])
    const result = effectiveRoomCapacity(map, { type: 'suite', capacity: 4, maxAdults: null, maxChildren: null })
    expect(result).toEqual({ capacity: 4, maxAdults: null, maxChildren: null })
  })

  it('sin Map (undefined) → cae a la habitación física', () => {
    const result = effectiveRoomCapacity(undefined, { type: 'double', capacity: 2, maxAdults: 2, maxChildren: undefined as any })
    expect(result).toEqual({ capacity: 2, maxAdults: 2, maxChildren: null })
  })

  it('habitación sin `type` → nunca matchea el Map, cae a sus propios campos', () => {
    const map = new Map<string, RoomTypeCapacity>([['double', { capacity: 2, maxAdults: 2, maxChildren: 1 }]])
    const result = effectiveRoomCapacity(map, { type: null, capacity: 3, maxAdults: null, maxChildren: null })
    expect(result).toEqual({ capacity: 3, maxAdults: null, maxChildren: null })
  })
})
