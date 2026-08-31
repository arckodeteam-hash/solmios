import { describe, it, expect } from 'bun:test'
import { addMonths, daysInMonth } from '../add-months'

// El bug que motivó el helper: `new Date(2026, 8, 31)` (31 de septiembre) no existe, y el
// constructor sigue contando hasta el 1 de octubre. Un "mes gratis" otorgado el 31/08 vencía un
// día tarde, y la suite del 31/08/2026 frenó el deploy por esto.

/** `mes` acá va 1-indexado para que el caso se lea como en el calendario. */
function d(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day)
}
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

describe('addMonths — el día se recorta, no se desborda', () => {
  it('31 de agosto + 1 mes es el 30 de septiembre, NO el 1 de octubre', () => {
    expect(iso(addMonths(d(2026, 8, 31), 1))).toBe('2026-09-30')
  })

  it('31 de enero + 1 mes es el último día de febrero', () => {
    expect(iso(addMonths(d(2026, 1, 31), 1))).toBe('2026-02-28')
    expect(iso(addMonths(d(2024, 1, 31), 1))).toBe('2024-02-29') // bisiesto
  })

  it('31 de marzo + 3 meses es el 30 de junio', () => {
    expect(iso(addMonths(d(2026, 3, 31), 3))).toBe('2026-06-30')
  })

  it('un día que existe en el mes destino no se toca', () => {
    expect(iso(addMonths(d(2026, 8, 15), 1))).toBe('2026-09-15')
    expect(iso(addMonths(d(2026, 8, 30), 1))).toBe('2026-09-30')
  })

  it('cruza el año', () => {
    expect(iso(addMonths(d(2026, 12, 31), 1))).toBe('2027-01-31')
    expect(iso(addMonths(d(2026, 11, 30), 3))).toBe('2027-02-28')
  })

  it('12 meses caen en la misma fecha del año siguiente', () => {
    expect(iso(addMonths(d(2026, 8, 31), 12))).toBe('2027-08-31')
  })

  it('acepta meses negativos con el mismo recorte', () => {
    expect(iso(addMonths(d(2026, 3, 31), -1))).toBe('2026-02-28')
  })

  it('0 meses devuelve la misma fecha', () => {
    expect(iso(addMonths(d(2026, 8, 31), 0))).toBe('2026-08-31')
  })

  it('conserva la hora: un mes desde ahora vence a la misma hora, no a medianoche', () => {
    const start = new Date(2026, 7, 31, 13, 45, 30)
    const end = addMonths(start, 1)
    expect(end.getHours()).toBe(13)
    expect(end.getMinutes()).toBe(45)
    expect(end.getSeconds()).toBe(30)
  })

  it('no muta la fecha que recibe', () => {
    const start = d(2026, 8, 31)
    addMonths(start, 1)
    expect(iso(start)).toBe('2026-08-31')
  })
})

describe('daysInMonth', () => {
  it('meses de 30 y 31', () => {
    expect(daysInMonth(2026, 8)).toBe(30) // septiembre
    expect(daysInMonth(2026, 7)).toBe(31) // agosto
  })

  it('febrero según el año', () => {
    expect(daysInMonth(2026, 1)).toBe(28)
    expect(daysInMonth(2024, 1)).toBe(29)
    expect(daysInMonth(2000, 1)).toBe(29) // divisible por 400
    expect(daysInMonth(1900, 1)).toBe(28) // divisible por 100 pero no por 400
  })
})
