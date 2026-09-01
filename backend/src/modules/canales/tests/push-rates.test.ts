// canales/tests/push-rates.test.ts — Push de tarifas por temporada a Channex.
// Cubre el bug del skip mudo: una temporada sin fechas se salteaba en silencio y la tarifa
// nunca llegaba a la OTA. Ahora: (a) se derivan rangos de season_assignments, (b) lo que
// igual no se puede publicar se REPORTA con nombre.

import { describe, it, expect } from 'bun:test'
import { groupAssignmentsIntoRanges, pushSeasonalRatesToChannex } from '../usecases/push-rates'
import type { CanalesDTO, DateRange, PushRatesResultDTO } from '../types'

describe('groupAssignmentsIntoRanges', () => {
  it('agrupa días consecutivos en un solo rango', () => {
    const r = groupAssignmentsIntoRanges([
      { date: '2026-04-02', season: 'especial' },
      { date: '2026-04-03', season: 'especial' },
      { date: '2026-04-04', season: 'especial' },
    ])
    expect(r.get('especial')).toEqual([{ startDate: '2026-04-02', endDate: '2026-04-04' }])
  })

  it('corta en tramos separados cuando hay un hueco', () => {
    const r = groupAssignmentsIntoRanges([
      { date: '2026-04-02', season: 'especial' },
      { date: '2026-04-03', season: 'especial' },
      { date: '2026-12-24', season: 'especial' },
      { date: '2026-12-25', season: 'especial' },
    ])
    expect(r.get('especial')).toEqual([
      { startDate: '2026-04-02', endDate: '2026-04-03' },
      { startDate: '2026-12-24', endDate: '2026-12-25' },
    ])
  })

  it('cruza el fin de mes sin cortar el tramo', () => {
    const r = groupAssignmentsIntoRanges([
      { date: '2026-01-30', season: 'alta' },
      { date: '2026-01-31', season: 'alta' },
      { date: '2026-02-01', season: 'alta' },
    ])
    expect(r.get('alta')).toEqual([{ startDate: '2026-01-30', endDate: '2026-02-01' }])
  })

  it('separa por temporada y ordena/dedupe las fechas', () => {
    const r = groupAssignmentsIntoRanges([
      { date: '2026-04-03', season: 'especial' },
      { date: '2026-04-02', season: 'especial' },
      { date: '2026-04-02', season: 'especial' },
      { date: '2026-07-01', season: 'alta' },
    ])
    expect(r.get('especial')).toEqual([{ startDate: '2026-04-02', endDate: '2026-04-03' }])
    expect(r.get('alta')).toEqual([{ startDate: '2026-07-01', endDate: '2026-07-01' }])
  })

  it('ignora filas sin fecha o sin temporada', () => {
    const r = groupAssignmentsIntoRanges([
      { date: '', season: 'especial' },
      { date: '2026-04-02', season: '' },
    ] as Array<{ date: string; season: string }>)
    expect(r.size).toBe(0)
  })
})

// ─── pushSeasonalRatesToChannex: qué rangos y qué motivos llegan al usecase de Channex ───

const CFG = { channexPropertyId: 'prop-1' } as CanalesDTO

interface Captured {
  rates: Array<{ roomType: string; season: string }>
  seasons: Array<{ name: string }>
  assigned: Map<string, DateRange[]>
}

function makeDeps(data: { rates: any[]; seasons: any[]; assignments: any[] }) {
  const captured: Captured = { rates: [], seasons: [], assigned: new Map() }
  const deps = {
    getConfig: async () => CFG,
    findMany: async (model: string) => {
      if (model === 'RoomRates') return data.rates
      if (model === 'Seasons') return data.seasons
      if (model === 'SeasonAssignments') return data.assignments
      return []
    },
    pushSeasonalRates: async (
      _cfg: CanalesDTO | undefined,
      rates: any[],
      seasons: any[],
      assigned: Map<string, DateRange[]>,
    ): Promise<PushRatesResultDTO> => {
      captured.rates = rates
      captured.seasons = seasons
      captured.assigned = assigned
      return { pushed: rates.length, skipped: 0, notConnected: false, seasonsWithoutDates: [], expiredSeasons: [], roomTypesWithoutRatePlan: [] }
    },
  }
  return { deps, captured }
}

describe('pushSeasonalRatesToChannex', () => {
  it('pasa los rangos derivados de season_assignments para la temporada sin fechas', async () => {
    const { deps, captured } = makeDeps({
      rates: [{ roomType: 'Doble', season: 'especial', occupancy: 2, basePrice: 100, percentage: 0, channel: '' }],
      seasons: [{ name: 'especial', label: 'Temporada Especial', startDate: '', endDate: '' }],
      assignments: [
        { date: '2026-12-24', season: 'especial' },
        { date: '2026-12-25', season: 'especial' },
      ],
    })
    await pushSeasonalRatesToChannex(deps, 'hotel-1')
    expect(captured.assigned.get('especial')).toEqual([{ startDate: '2026-12-24', endDate: '2026-12-25' }])
    expect(captured.rates).toHaveLength(1)
  })

  it('no inventa rangos cuando la temporada no tiene ni fechas ni días asignados', async () => {
    const { deps, captured } = makeDeps({
      rates: [{ roomType: 'Doble', season: 'especial', occupancy: 2, basePrice: 100, percentage: 0, channel: '' }],
      seasons: [{ name: 'especial', label: 'Temporada Especial', startDate: '', endDate: '' }],
      assignments: [],
    })
    await pushSeasonalRatesToChannex(deps, 'hotel-1')
    expect(captured.assigned.size).toBe(0)
  })

  it('elige el override del canal sobre la tarifa base', async () => {
    const { deps, captured } = makeDeps({
      rates: [
        { roomType: 'Doble', season: 'alta', occupancy: 2, basePrice: 100, percentage: 0, channel: '' },
        { roomType: 'Doble', season: 'alta', occupancy: 2, basePrice: 150, percentage: 0, channel: 'booking' },
      ],
      seasons: [{ name: 'alta', startDate: '2026-12-01', endDate: '2026-12-31' }],
      assignments: [],
    })
    await pushSeasonalRatesToChannex(deps, 'hotel-1', 'booking')
    expect(captured.rates).toHaveLength(1)
    expect((captured.rates[0] as any).basePrice).toBe(150)
  })

  // #404: precio por ocupación (OBP). Existió un modo "por habitación" que colapsaba a la
  // ocupación máxima y tiraba el resto — el precio de 1 persona se cargaba en el panel y nunca
  // llegaba a la OTA. Ese modo se eliminó: ahora se empujan siempre todas las ocupaciones.
  it('empuja TODAS las ocupaciones del room type, no solo la máxima', async () => {
    const { deps, captured } = makeDeps({
      rates: [
        { roomType: 'Doble', season: 'alta', occupancy: 1, basePrice: 80, percentage: 0, channel: '' },
        { roomType: 'Doble', season: 'alta', occupancy: 2, basePrice: 100, percentage: 0, channel: '' },
      ],
      seasons: [{ name: 'alta', startDate: '2026-12-01', endDate: '2026-12-31' }],
      assignments: [],
    })
    await pushSeasonalRatesToChannex(deps, 'hotel-1')
    expect(captured.rates).toHaveLength(2)                    // las dos ocupaciones, no se descarta ninguna
    expect(captured.rates.map((r: any) => r.occupancy).sort()).toEqual([1, 2])
    expect(captured.rates.map((r: any) => r.basePrice).sort((a: number, b: number) => a - b)).toEqual([80, 100])
  })
})
