import { describe, it, expect, vi } from 'vitest'

// El store arrastra los services (http); acá solo se prueban las funciones puras.
vi.mock('@/services/Housekeeping.service', () => ({ HousekeepingService: {}, MAX_PAGE_SIZE: 100 }))
vi.mock('@/services/Room.service', () => ({ RoomService: {} }))
vi.mock('@/services/Team.service', () => ({ TeamService: {} }))

import { parseSetupItems, setupItemLabel } from './housekeeping.store'

describe('parseSetupItems (#274)', () => {
  it('null / undefined / inválido → []', () => {
    expect(parseSetupItems(null)).toEqual([])
    expect(parseSetupItems(undefined)).toEqual([])
    expect(parseSetupItems('no es json')).toEqual([])
    expect(parseSetupItems(42)).toEqual([])
    expect(parseSetupItems('{"type":"crib"}')).toEqual([])
  })

  it('acepta JSON crudo', () => {
    expect(parseSetupItems('[{"type":"crib","qty":1}]')).toEqual([{ type: 'crib', qty: 1 }])
  })

  it('acepta array ya parseado y descarta entradas sin type válido', () => {
    expect(parseSetupItems([
      { type: 'crib', qty: 2 },
      { type: 'otro', qty: 1 },
      'string suelto',
      null,
      { type: 'amenity', name: 'Bañera', qty: 1 },
    ])).toEqual([{ type: 'crib', qty: 2 }, { type: 'amenity', name: 'Bañera', qty: 1 }])
  })
})

describe('setupItemLabel (#274)', () => {
  it('cuna con cantidad', () => {
    expect(setupItemLabel({ type: 'crib', qty: 1 })).toBe('Cuna ×1')
  })

  it('amenidad con cantidad', () => {
    expect(setupItemLabel({ type: 'amenity', name: 'Bañera', qty: 1 })).toBe('Bañera ×1')
  })

  it('régimen legible; desconocido tal cual', () => {
    expect(setupItemLabel({ type: 'regime', name: 'breakfast' })).toBe('Desayuno')
    expect(setupItemLabel({ type: 'regime', name: 'half_board' })).toBe('Media pensión')
    expect(setupItemLabel({ type: 'regime', name: 'full_board' })).toBe('Pensión completa')
    expect(setupItemLabel({ type: 'regime', name: 'all_inclusive' })).toBe('Todo incluido')
    expect(setupItemLabel({ type: 'regime', name: 'brunch' })).toBe('brunch')
  })

  it('pedido especial: el texto', () => {
    expect(setupItemLabel({ type: 'request', text: 'Piso alto' })).toBe('Piso alto')
  })
})
