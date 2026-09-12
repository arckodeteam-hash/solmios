// room-assign.test.ts — carriles de la banda "Sin asignar" del planning y traducción del 409 de
// assign-room (REQ-HAC-06, #261).
import { describe, it, expect } from 'vitest'
import { ApiError } from '@/services/http'
import { layoutUnassignedLanes, assignErrorMessage, isUnassigned } from './room-assign'

const stay = (id: string, checkIn: string, checkOut: string) => ({ id, checkIn, checkOut })

describe('layoutUnassignedLanes — carriles sin solape', () => {
  it('sin reservas → 0 carriles', () => {
    expect(layoutUnassignedLanes([])).toEqual([])
  })

  it('3 reservas solapadas → 3 carriles', () => {
    const lanes = layoutUnassignedLanes([
      stay('a', '2026-09-10', '2026-09-13'),
      stay('b', '2026-09-11', '2026-09-14'),
      stay('c', '2026-09-12', '2026-09-15'),
    ])
    expect(lanes).toHaveLength(3)
    expect(lanes.map(l => l.map(s => s.id))).toEqual([['a'], ['b'], ['c']])
  })

  it('2 consecutivas (checkOut == checkIn) → 1 carril', () => {
    const lanes = layoutUnassignedLanes([
      stay('b', '2026-09-13', '2026-09-15'),
      stay('a', '2026-09-10', '2026-09-13'),
    ])
    expect(lanes).toHaveLength(1)
    expect(lanes[0].map(s => s.id)).toEqual(['a', 'b'])
  })

  it('mezcla: la que cabe va al primer carril libre, la que solapa abre uno nuevo', () => {
    const lanes = layoutUnassignedLanes([
      stay('a', '2026-09-10', '2026-09-12'),
      stay('b', '2026-09-11', '2026-09-13'),   // solapa con a → carril 2
      stay('c', '2026-09-12', '2026-09-14'),   // entra detrás de a → carril 1
      stay('d', '2026-09-13', '2026-09-15'),   // entra detrás de b → carril 2
      stay('e', '2026-09-13', '2026-09-14'),   // solapa con c y d → carril 3
    ])
    expect(lanes.map(l => l.map(s => s.id))).toEqual([['a', 'c'], ['b', 'd'], ['e']])
  })

  it('compara por día: acepta ISO con hora y desempata por id', () => {
    const lanes = layoutUnassignedLanes([
      stay('z', '2026-09-10T15:00:00.000Z', '2026-09-12T10:00:00.000Z'),
      stay('y', '2026-09-10T00:00:00.000Z', '2026-09-11T00:00:00.000Z'),
    ])
    expect(lanes.map(l => l.map(s => s.id))).toEqual([['y'], ['z']])
  })

  it('no muta el array de entrada', () => {
    const input = [stay('b', '2026-09-12', '2026-09-13'), stay('a', '2026-09-10', '2026-09-11')]
    layoutUnassignedLanes(input)
    expect(input.map(s => s.id)).toEqual(['b', 'a'])
  })
})

describe('assignErrorMessage — 409 de assign-room → texto para recepción', () => {
  const conflict = (details: Record<string, unknown>) => new ApiError(409, 'Conflicto', details)

  it('room_overlap con fechas → "Ocupada por {locator} del … al …"', () => {
    const msg = assignErrorMessage(conflict({ reason: 'room_overlap', locator: 'ABC123', from: '2026-09-10', to: '2026-09-12' }))
    expect(msg).toBe('Ocupada por ABC123 del 2026-09-10 al 2026-09-12')
  })

  it('room_overlap sin fechas → "Ocupada por {locator}"', () => {
    expect(assignErrorMessage(conflict({ reason: 'room_overlap', locator: 'ABC123' }))).toBe('Ocupada por ABC123')
  })

  it('type_mismatch → tipo real vs. tipo vendido', () => {
    expect(assignErrorMessage(conflict({ reason: 'type_mismatch', expected: 'Doble', actual: 'Suite' })))
      .toBe('Es de tipo "Suite" y la reserva vendió "Doble"')
  })

  it('room_not_sellable → fuera de servicio con el estado', () => {
    expect(assignErrorMessage(conflict({ reason: 'room_not_sellable', status: 'maintenance' })))
      .toBe('Fuera de servicio (maintenance)')
  })

  it('invalid_status → estado de la reserva', () => {
    expect(assignErrorMessage(conflict({ reason: 'invalid_status', status: 'cancelled' })))
      .toBe('No se puede asignar en estado cancelled')
  })

  it('409 con reason desconocida o ApiError sin details → message del backend', () => {
    expect(assignErrorMessage(conflict({ reason: 'algo_nuevo' }))).toBe('Conflicto')
    expect(assignErrorMessage(new ApiError(400, 'roomId es obligatorio'))).toBe('roomId es obligatorio')
    expect(assignErrorMessage(new ApiError(409, 'Habitación ocupada'))).toBe('Habitación ocupada')
  })

  it('Error genérico (no ApiError) → mensaje por defecto', () => {
    expect(assignErrorMessage(new Error('Failed to fetch'))).toBe('No se pudo asignar la habitación')
    expect(assignErrorMessage(undefined)).toBe('No se pudo asignar la habitación')
  })
})

describe('isUnassigned', () => {
  it('sin roomId (null, undefined o "") → true; con roomId → false', () => {
    expect(isUnassigned({ roomId: null })).toBe(true)
    expect(isUnassigned({})).toBe(true)
    expect(isUnassigned({ roomId: '' })).toBe(true)
    expect(isUnassigned({ roomId: 'r1' })).toBe(false)
  })
})
