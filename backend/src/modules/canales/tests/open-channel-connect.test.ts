// open-channel-connect.test.ts — El mapeo con el que SolmiOS se conecta como canal.
// Los códigos tienen que ser EXACTAMENTE los que publica `buildMappingDetails` (`double`,
// `double-bar`): si no coinciden, Channex manda precios contra un plan que el PMS no reconoce.
import { describe, it, expect } from 'bun:test'
import { buildOpenChannelMappings, roomTypesFromRooms } from '../usecases/open-channel-connect'
import { DEFAULT_RATE_PLANS } from '../usecases/rate-plans'
import type { MappingEntry } from '../usecases/channex-mapping'

const MAPPINGS: MappingEntry[] = [
  { kind: 'property', localId: 'default', channexId: 'prop-1' },
  { kind: 'room_type', localId: 'double', channexId: 'rt-double' },
  { kind: 'rate_plan', localId: 'double|BAR', channexId: 'rp-double-bar' },
  { kind: 'rate_plan', localId: 'double|Bed & Breakfast', channexId: 'rp-double-bb' },
]
const ROOM_TYPES = [{ type: 'double', capacity: 2 }]

describe('buildOpenChannelMappings', () => {
  it('usa los códigos del mapping details: tipo y tipo-plan', () => {
    const out = buildOpenChannelMappings(MAPPINGS, DEFAULT_RATE_PLANS, ROOM_TYPES)
    expect(out).toEqual([
      { ratePlanId: 'rp-double-bar', roomTypeCode: 'double', ratePlanCode: 'double-bar', occupancy: 2, pricingType: 'per_person', primaryOcc: true },
      { ratePlanId: 'rp-double-bb', roomTypeCode: 'double', ratePlanCode: 'double-bb', occupancy: 2, pricingType: 'per_person', primaryOcc: true },
    ])
  })

  it('ignora las entradas que no son rate plans', () => {
    const out = buildOpenChannelMappings(MAPPINGS, DEFAULT_RATE_PLANS, ROOM_TYPES)
    expect(out.every((m) => m.ratePlanId.startsWith('rp-'))).toBe(true)
  })

  it('saltea un plan que el hotel ya no tiene en vez de inventar el código', () => {
    const conPlanViejo: MappingEntry[] = [...MAPPINGS, { kind: 'rate_plan', localId: 'double|Media Pensión', channexId: 'rp-viejo' }]
    const out = buildOpenChannelMappings(conPlanViejo, DEFAULT_RATE_PLANS, ROOM_TYPES)
    expect(out.map((m) => m.ratePlanId)).not.toContain('rp-viejo')
  })

  it('saltea un tipo sin habitaciones vivas', () => {
    const out = buildOpenChannelMappings(MAPPINGS, DEFAULT_RATE_PLANS, [{ type: 'suite', capacity: 4 }])
    expect(out).toHaveLength(0)
  })
})

describe('roomTypesFromRooms', () => {
  it('agrupa por tipo con la capacidad MÁXIMA de sus habitaciones', () => {
    expect(roomTypesFromRooms([
      { type: 'double', capacity: 2 }, { type: 'double', capacity: 3 }, { type: 'suite', capacity: 4 }, { type: '' },
    ])).toEqual([{ type: 'double', capacity: 3 }, { type: 'suite', capacity: 4 }])
  })

  it('sin capacidad cargada asume 2 (mismo default que el resto del módulo)', () => {
    expect(roomTypesFromRooms([{ type: 'twin' }])).toEqual([{ type: 'twin', capacity: 2 }])
  })
})
