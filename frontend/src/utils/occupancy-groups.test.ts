// occupancy-groups.test.ts — La deduplicación de precios repetidos en la matriz de
// ocupaciones. Regla protegida: SOLO se colapsa lo redundante (vendibles contiguas
// al mismo precio); diferencias y filas grises con motivo quedan fila por fila.
import { describe, it, expect } from 'vitest'
import { groupOccupancyRows } from './occupancy-groups'
import type { OccupancyUnavailableReason, RoomOccupancyRate } from '@/types/booking'

function occ(occupancy: number, price: number, pricePerNight: number, available = true, reason: OccupancyUnavailableReason | null = null): RoomOccupancyRate {
  return { occupancy, price, pricePerNight, available, unavailableReason: reason, taxBreakdown: [] }
}

/** Un grupo: [ocupaciones] — una fila individual: n (número pelado). */
function shape(entries: ReturnType<typeof groupOccupancyRows>): Array<number | number[]> {
  return entries.map(e => (e.kind === 'group' ? e.rows.map(r => r.occupancy) : e.row.occupancy))
}

describe('groupOccupancyRows', () => {
  it('colapsa la corrida completa de igual precio en UN grupo (el caso reportado: Triple x3, Doble x2)', () => {
    const entries = groupOccupancyRows([
      occ(1, 390, 130), occ(2, 390, 130), occ(3, 390, 130),
    ])
    expect(shape(entries)).toEqual([[1, 2, 3]])
  })

  it('precios distintos quedan fila por fila — ahí la diferencia ES la información', () => {
    const entries = groupOccupancyRows([
      occ(1, 210, 70), occ(2, 300, 100),
    ])
    expect(shape(entries)).toEqual([1, 2])
  })

  it('mezcla: grupo de iguales + fila distinta + grupo nuevo de iguales', () => {
    const entries = groupOccupancyRows([
      occ(1, 100, 50), occ(2, 100, 50), occ(3, 150, 75), occ(4, 150, 75),
    ])
    expect(shape(entries)).toEqual([[1, 2], [3, 4]])
  })

  it('una gris INTERUMPE el grupo: sus vecinas iguales no se funden a través de ella', () => {
    const entries = groupOccupancyRows([
      occ(1, 100, 50), occ(2, 0, 0, false, 'no_rate'), occ(3, 100, 50),
    ])
    expect(shape(entries)).toEqual([1, 2, 3])
  })

  it('una gris con precio cargado (stop_sell) NO arrastra a la vendible de igual precio', () => {
    const entries = groupOccupancyRows([
      occ(1, 480, 160, false, 'stop_sell'), occ(2, 480, 160), occ(3, 480, 160),
    ])
    // La gris sale single aunque su precio coincida: el grupo solo admite vendibles.
    expect(shape(entries)).toEqual([1, [2, 3]])
  })

  it('pricePerNight distinto desagrupa aunque el total coincida (noches mixtas)', () => {
    const entries = groupOccupancyRows([
      occ(1, 300, 100), occ(2, 300, 150),
    ])
    expect(shape(entries)).toEqual([1, 2])
  })

  it('corrida de una sola fila queda single (no grupo de 1)', () => {
    const entries = groupOccupancyRows([occ(2, 100, 50)])
    expect(shape(entries)).toEqual([2])
  })

  it('entrada desordenada se ordena por ocupación antes de agrupar', () => {
    const entries = groupOccupancyRows([
      occ(3, 390, 130), occ(1, 390, 130), occ(2, 390, 130),
    ])
    expect(shape(entries)).toEqual([[1, 2, 3]])
  })

  it('vacío → vacío', () => {
    expect(groupOccupancyRows([])).toEqual([])
  })
})
