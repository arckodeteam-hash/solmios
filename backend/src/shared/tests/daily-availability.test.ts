// shared/tests/daily-availability.test.ts
//
// Cubre la lógica pura extraída de `canales/usecases/availability.ts` (que ahora re-exporta
// desde acá). Los tests de `canales/tests/ari-ingestion.test.ts` siguen apuntando al módulo y
// deben seguir pasando sin cambios: esto verifica la pieza compartida en sí, incluyendo lo
// NUEVO que canales no usa (días inclusivos y el criterio de estados parametrizable que
// necesita el calendario público).
import { describe, it, expect } from 'bun:test'
import {
  eachDayExclusive,
  eachDayInclusive,
  addDays,
  daysBetween,
  computeDailyAvailability,
  compressToRanges,
  computeAvailabilityRanges,
  buildAvailabilityRanges,
  roomsOfType,
} from '../utils/daily-availability'

describe('rango de fechas', () => {
  it('eachDayExclusive no incluye el día final (checkout libera la noche)', () => {
    expect(eachDayExclusive('2026-06-01', '2026-06-04')).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })

  it('eachDayInclusive incluye ambos extremos (celdas del calendario)', () => {
    expect(eachDayInclusive('2026-06-01', '2026-06-03')).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })

  it('un solo día inclusivo devuelve ese día', () => {
    expect(eachDayInclusive('2026-06-01', '2026-06-01')).toEqual(['2026-06-01'])
  })

  it('cruza cambio de mes y de año sin corrimientos', () => {
    expect(eachDayInclusive('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('addDays / daysBetween operan en UTC', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01') // 2026 no es bisiesto
    expect(daysBetween('2026-06-01', '2026-06-10')).toBe(9)
    expect(daysBetween('2026-06-10', '2026-06-01')).toBe(-9)
  })

  it('fecha inválida no explota: devuelve lista vacía', () => {
    expect(eachDayExclusive('no-es-fecha', '2026-06-04')).toEqual([])
  })
})

describe('computeDailyAvailability', () => {
  const days = eachDayInclusive('2026-06-01', '2026-06-04')

  it('resta reservas con [checkIn, checkOut) — el día de salida queda libre', () => {
    const out = computeDailyAvailability(days, 2, [{ checkIn: '2026-06-02', checkOut: '2026-06-04' }], [])
    expect(out.map((d) => d.available)).toEqual([2, 1, 1, 2])
  })

  it('resta bloqueos con [startDate, endDate] inclusivo', () => {
    const out = computeDailyAvailability(days, 2, [], [{ startDate: '2026-06-02', endDate: '2026-06-04' }])
    expect(out.map((d) => d.available)).toEqual([2, 1, 1, 1])
  })

  it('overbook se clampea a 0, nunca negativo', () => {
    const out = computeDailyAvailability(['2026-06-01'], 1, [
      { checkIn: '2026-06-01', checkOut: '2026-06-02' },
      { checkIn: '2026-06-01', checkOut: '2026-06-02' },
    ], [])
    expect(out[0]!.available).toBe(0)
  })
})

describe('compresión a rangos', () => {
  it('comprime días consecutivos de igual disponibilidad', () => {
    const ranges = compressToRanges([
      { date: '2026-06-01', available: 2 },
      { date: '2026-06-02', available: 2 },
      { date: '2026-06-03', available: 1 },
    ])
    expect(ranges).toEqual([
      { dateFrom: '2026-06-01', dateTo: '2026-06-02', availability: 2 },
      { dateFrom: '2026-06-03', dateTo: '2026-06-03', availability: 1 },
    ])
  })

  it('computeAvailabilityRanges mantiene la firma histórica de canales', () => {
    const ranges = computeAvailabilityRanges('2026-06-01', '2026-06-05', 2,
      [{ checkIn: '2026-06-02', checkOut: '2026-06-04' }], [])
    expect(ranges).toEqual([
      { dateFrom: '2026-06-01', dateTo: '2026-06-01', availability: 2 },
      { dateFrom: '2026-06-02', dateTo: '2026-06-03', availability: 1 },
      { dateFrom: '2026-06-04', dateTo: '2026-06-04', availability: 2 },
    ])
  })
})

describe('buildAvailabilityRanges', () => {
  const rooms = [{ id: 'a', type: 'Suite' }, { id: 'b', type: 'suite' }, { id: 'c', type: 'standard' }]

  it('matchea el tipo case-insensitive', () => {
    expect(roomsOfType('suite', rooms).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('devuelve null si el hotel no tiene ese tipo', () => {
    expect(buildAvailabilityRanges('triple', rooms, [], [])).toBeNull()
  })

  it('default (canales): todo lo que no esté cancelled ocupa', () => {
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = addDays(today, 1)
    const ranges = buildAvailabilityRanges('suite', rooms, [
      { roomId: 'a', status: 'no_show', checkIn: today, checkOut: tomorrow },
    ], [])
    expect(ranges![0]!.availability).toBe(1)
  })

  it('con criterio parametrizado (whitelist del motor público) un no_show NO ocupa', () => {
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = addDays(today, 1)
    const whitelist = (s: string) => ['confirmed', 'checked_in', 'pending', 'guaranteed'].includes(s)
    const ranges = buildAvailabilityRanges('suite', rooms, [
      { roomId: 'a', status: 'no_show', checkIn: today, checkOut: tomorrow },
    ], [], whitelist)
    expect(ranges![0]!.availability).toBe(2)
  })
})

// HAC-02 (#257/#258): una reserva activa SIN unidad (`roomId` null, vende sólo `roomType`)
// consume UNA del tipo. Antes el filtro era `typeRoomIds.has(r.roomId)` y soltar la unidad de
// una `confirmed` la sacaba del push a Channex (+1 en la OTA con la reserva vendida).
describe('buildAvailabilityRanges — reservas sin unidad (HAC-02)', () => {
  const rooms = [{ id: 'a', type: 'Suite' }, { id: 'b', type: 'suite' }, { id: 'c', type: 'standard' }]
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = addDays(today, 1)

  it('confirmed sin roomId de tipo suite baja la disponibilidad de suite en 1 en sus fechas', () => {
    const ranges = buildAvailabilityRanges('suite', rooms, [
      { roomId: null, roomType: 'suite', status: 'confirmed', checkIn: today, checkOut: tomorrow },
    ], [])!
    expect(ranges[0]!.dateFrom).toBe(today)
    expect(ranges[0]!.dateTo).toBe(today)
    expect(ranges[0]!.availability).toBe(1)
    expect(ranges[1]!.availability).toBe(2)
  })

  it('matchea el tipo case-insensitive y NO descuenta de otro tipo', () => {
    const res = [{ roomId: null, roomType: 'SUITE', status: 'confirmed', checkIn: today, checkOut: tomorrow }]
    expect(buildAvailabilityRanges('suite', rooms, res, [])![0]!.availability).toBe(1)
    expect(buildAvailabilityRanges('standard', rooms, res, [])![0]!.availability).toBe(1)
  })

  it('sin unidad y cerrada (cancelled/no_show/checked_out) no consume, ni con el criterio laxo de canales', () => {
    for (const status of ['cancelled', 'no_show', 'checked_out']) {
      const ranges = buildAvailabilityRanges('suite', rooms, [
        { roomId: null, roomType: 'suite', status, checkIn: today, checkOut: tomorrow },
      ], [])!
      expect(ranges[0]!.availability).toBe(2)
    }
  })

  it('sin unidad y sin roomType no hay contra qué descontar: no cuenta', () => {
    const ranges = buildAvailabilityRanges('suite', rooms, [
      { roomId: null, roomType: null, status: 'confirmed', checkIn: today, checkOut: tomorrow },
    ], [])!
    expect(ranges[0]!.availability).toBe(2)
  })

  it('con unidad manda la física: roomType distinto al de la habitación no descuenta dos veces', () => {
    const res = [{ roomId: 'c', roomType: 'suite', status: 'confirmed', checkIn: today, checkOut: tomorrow }]
    expect(buildAvailabilityRanges('suite', rooms, res, [])![0]!.availability).toBe(2)
    expect(buildAvailabilityRanges('standard', rooms, res, [])![0]!.availability).toBe(0)
  })
})
