// utils/rate-calendar.test.ts — Lógica no trivial del calendario de tarifas de la landing.
// Cubre las cuatro cosas que se pueden romper en silencio: el conteo de noches (off-by-one),
// el "este día no se puede elegir", el resumen de ocupación y la degradación sin precios.
import { describe, it, expect } from 'vitest'
import {
  MAX_CALENDAR_DAYS,
  addDays,
  buildMonthCells,
  clampSpan,
  firstBlockedNight,
  formatMoney,
  formatOccupancy,
  isDaySelectable,
  minStayFor,
  monthBounds,
  nightsBetween,
  nightsOf,
  sumStayPrice,
  todayIso,
  totalGuests,
  weekdayMondayBased,
} from './rate-calendar'
import type { CalendarDay } from '@/types/booking'

function day(date: string, over: Partial<CalendarDay> = {}): CalendarDay {
  return { date, fromPrice: 100, available: 5, closed: false, ...over }
}

function mapOf(days: CalendarDay[]): Map<string, CalendarDay> {
  return new Map(days.map((d) => [d.date, d]))
}

describe('rate-calendar — noches del rango', () => {
  it('N celdas pintadas como noche = N noches, y el checkout es el día siguiente a la última', () => {
    // 10 → 13: se duermen las noches del 10, 11 y 12; se sale el 13.
    expect(nightsBetween('2026-08-10', '2026-08-13')).toBe(3)
    expect(nightsOf('2026-08-10', '2026-08-13')).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
    // El día de salida NO es una noche pagada.
    expect(nightsOf('2026-08-10', '2026-08-13')).not.toContain('2026-08-13')
    // Y el checkout es exactamente la última noche + 1.
    expect(addDays('2026-08-12', 1)).toBe('2026-08-13')
  })

  it('una sola noche = llegada y salida consecutivas', () => {
    expect(nightsBetween('2026-08-10', '2026-08-11')).toBe(1)
  })

  it('rango inverso, igual o inválido = 0 noches (nunca negativo)', () => {
    expect(nightsBetween('2026-08-13', '2026-08-10')).toBe(0)
    expect(nightsBetween('2026-08-10', '2026-08-10')).toBe(0)
    expect(nightsBetween('', '2026-08-10')).toBe(0)
    expect(nightsBetween('2026-08-10', 'no-es-fecha')).toBe(0)
  })

  it('cruza meses y años sin perder días', () => {
    expect(nightsBetween('2026-08-30', '2026-09-02')).toBe(3)
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3)
    // Año bisiesto.
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('addDays normaliza fin de mes y año', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('todayIso usa componentes LOCALES (bug UTC: de noche en UTC-4 daba mañana)', () => {
    // 23:30 local del 15 → en UTC ya es el 16, pero acá tiene que seguir siendo el 15.
    const nocheTarde = new Date(2026, 7, 15, 23, 30, 0)
    expect(todayIso(nocheTarde)).toBe('2026-08-15')
  })
})

describe('rate-calendar — días no seleccionables', () => {
  const today = '2026-08-15'

  it('closed: true no se puede elegir', () => {
    expect(isDaySelectable('2026-08-20', day('2026-08-20', { closed: true }), today)).toBe(false)
  })

  it('available: 0 no se puede elegir (aunque no venga closed)', () => {
    expect(isDaySelectable('2026-08-20', day('2026-08-20', { available: 0 }), today)).toBe(false)
  })

  it('los días pasados no se pueden elegir, ni con disponibilidad', () => {
    expect(isDaySelectable('2026-08-14', day('2026-08-14'), today)).toBe(false)
    // Hoy SÍ (se puede reservar para hoy mismo).
    expect(isDaySelectable(today, day(today), today)).toBe(true)
  })

  it('DEGRADACIÓN: sin dato del día se puede elegir igual (endpoint caído / hotel sin tarifas)', () => {
    expect(isDaySelectable('2026-08-20', undefined, today)).toBe(true)
  })

  it('firstBlockedNight detecta una noche llena en medio del rango', () => {
    const days = mapOf([
      day('2026-08-20'),
      day('2026-08-21', { available: 0, closed: true }),
      day('2026-08-22'),
    ])
    // Noches 20 y 21 → la del 21 está llena.
    expect(firstBlockedNight('2026-08-20', '2026-08-22', days, today)).toBe('2026-08-21')
    // El día de SALIDA no es noche pagada: que el 22 esté lleno no invalida un rango 20→22.
    const salidaLlena = mapOf([day('2026-08-20'), day('2026-08-21'), day('2026-08-22', { available: 0 })])
    expect(firstBlockedNight('2026-08-20', '2026-08-22', salidaLlena, today)).toBeNull()
  })

  it('minStayFor solo devuelve el mínimo cuando es mayor a 1', () => {
    expect(minStayFor('2026-08-20', mapOf([day('2026-08-20', { minStay: 3 })]))).toBe(3)
    expect(minStayFor('2026-08-20', mapOf([day('2026-08-20', { minStay: 1 })]))).toBe(0)
    expect(minStayFor('2026-08-20', mapOf([day('2026-08-20')]))).toBe(0)
    expect(minStayFor('2026-08-20', new Map())).toBe(0)
  })
})

describe('rate-calendar — grilla del mes', () => {
  const today = '2026-08-15'

  it('rellena el inicio para que el día 1 caiga en su columna (lunes-based)', () => {
    // 1 de agosto de 2026 = sábado → índice 5 en una semana que arranca el lunes.
    expect(weekdayMondayBased('2026-08-01')).toBe(5)
    const cells = buildMonthCells(2026, 7, { today })
    expect(cells.filter((c) => !c.inMonth)).toHaveLength(5)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
    expect(cells[5]!.iso).toBe('2026-08-01')
  })

  it('marca pasado / hoy / agotado y deja el resto seleccionable', () => {
    const cells = buildMonthCells(2026, 7, {
      today,
      days: mapOf([
        day('2026-08-16', { fromPrice: 120 }),
        day('2026-08-17', { available: 0, closed: true }),
      ]),
    })
    const byIso = new Map(cells.filter((c) => c.inMonth).map((c) => [c.iso, c]))

    expect(byIso.get('2026-08-10')!.past).toBe(true)
    expect(byIso.get('2026-08-10')!.selectable).toBe(false)
    expect(byIso.get('2026-08-15')!.today).toBe(true)

    expect(byIso.get('2026-08-16')!.price).toBe(120)
    expect(byIso.get('2026-08-16')!.selectable).toBe(true)
    expect(byIso.get('2026-08-16')!.soldOut).toBe(false)

    expect(byIso.get('2026-08-17')!.soldOut).toBe(true)
    expect(byIso.get('2026-08-17')!.selectable).toBe(false)
  })

  it('SIN datos: ningún día futuro queda agotado y todos se pueden elegir (sin precio)', () => {
    const cells = buildMonthCells(2026, 7, { today }).filter((c) => c.inMonth && !c.past)
    expect(cells.every((c) => c.selectable)).toBe(true)
    expect(cells.every((c) => c.soldOut === false)).toBe(true)
    expect(cells.every((c) => c.price === null)).toBe(true)
  })

  it('fromPrice 0 (backend sin tarifa derivable) se muestra como "sin precio", no como $0', () => {
    const cells = buildMonthCells(2026, 7, { today, days: mapOf([day('2026-08-20', { fromPrice: 0 })]) })
    const cell = cells.find((c) => c.iso === '2026-08-20')!
    expect(cell.price).toBeNull()
    expect(cell.selectable).toBe(true)
  })
})

describe('rate-calendar — total de la estadía', () => {
  it('suma solo las noches, no el día de salida', () => {
    const days = mapOf([
      day('2026-08-20', { fromPrice: 100 }),
      day('2026-08-21', { fromPrice: 150 }),
      day('2026-08-22', { fromPrice: 999 }),
    ])
    expect(sumStayPrice('2026-08-20', '2026-08-22', days)).toBe(250)
  })

  it('devuelve null si falta el precio de alguna noche (un total parcial engaña)', () => {
    const days = mapOf([day('2026-08-20', { fromPrice: 100 }), day('2026-08-21', { fromPrice: 0 })])
    expect(sumStayPrice('2026-08-20', '2026-08-22', days)).toBeNull()
    expect(sumStayPrice('2026-08-20', '2026-08-22', new Map())).toBeNull()
    expect(sumStayPrice('', '', new Map())).toBeNull()
  })
})

describe('rate-calendar — rango pedido al endpoint', () => {
  it('monthBounds arranca en hoy si el mes ya empezó y termina el último día', () => {
    expect(monthBounds(2026, 7, '2026-08-15')).toEqual({ from: '2026-08-15', to: '2026-08-31' })
    expect(monthBounds(2026, 8, '2026-08-15')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })

  it('monthBounds devuelve null para un mes íntegramente pasado (no se pide nada)', () => {
    expect(monthBounds(2026, 6, '2026-08-15')).toBeNull()
  })

  it('clampSpan respeta el tope de 90 días del backend (más = 400)', () => {
    expect(MAX_CALENDAR_DAYS).toBe(90)
    // 90 días inclusive desde el 1 de enero = hasta el 31 de marzo.
    expect(clampSpan('2026-01-01', '2026-12-31')).toBe('2026-03-31')
    expect(nightsBetween('2026-01-01', clampSpan('2026-01-01', '2026-12-31')) + 1).toBe(90)
    // Un rango corto no se toca.
    expect(clampSpan('2026-01-01', '2026-01-31')).toBe('2026-01-31')
  })
})

describe('rate-calendar — resumen de ocupación', () => {
  it('muestra el resumen explícito con singular/plural', () => {
    expect(formatOccupancy({ adults: 2, children: 1, rooms: 1 })).toBe('2 adultos, 1 niño')
    expect(formatOccupancy({ adults: 1, children: 0, rooms: 1 })).toBe('1 adulto')
    expect(formatOccupancy({ adults: 3, children: 2, rooms: 1 })).toBe('3 adultos, 2 niños')
  })

  it('omite los niños en 0 y las habitaciones en 1 (nadie escribe "0 niños")', () => {
    expect(formatOccupancy({ adults: 2, children: 0, rooms: 1 })).toBe('2 adultos')
  })

  it('agrega las habitaciones solo cuando son más de una', () => {
    expect(formatOccupancy({ adults: 4, children: 0, rooms: 2 })).toBe('4 adultos, 2 habitaciones')
    expect(formatOccupancy({ adults: 2, children: 1, rooms: 3 })).toBe('2 adultos, 1 niño, 3 habitaciones')
  })

  it('totalGuests = ocupación física (un niño también ocupa una plaza)', () => {
    expect(totalGuests({ adults: 2, children: 1, rooms: 1 })).toBe(3)
    expect(totalGuests({ adults: 2, children: 0, rooms: 2 })).toBe(2)
    // Nunca 0: el endpoint exige guests >= 1.
    expect(totalGuests({ adults: 0, children: 0, rooms: 1 })).toBe(1)
  })
})

// Auditoría final (Requerimiento 15, 2026-09-04) — FIX encontrado en Playwright: `formatMoney`
// sin decimales (pensado para celdas chicas de calendario) se reusaba en TODO el flujo de reserva
// de BookingModal.vue (landing) — la landing redondeaba precios que el widget embebible
// (RoomsStep.vue) mostraba exactos, dos entradas públicas anunciando números distintos para la
// MISMA reserva. `decimals` es opt-in (default `false`) para no tocar el comportamiento de las
// celdas de calendario (CalendarView.vue/RateCalendar.vue), que siguen sin pasarlo.
//
// `Intl.NumberFormat('es', ...)` separa el número del símbolo con un espacio DURO (NBSP,
// U+00A0), no un espacio común — `plain()` lo normaliza para no depender de un carácter
// invisible dentro del código fuente del test.
function plain(s: string): string {
  return s.replace(/\s/g, ' ')
}

describe('formatMoney — decimales opt-in (Requerimiento 15, auditoría final)', () => {
  it('default (sin decimales): redondea — el comportamiento histórico de las celdas de calendario', () => {
    expect(plain(formatMoney(200, 'USD'))).toBe('200 US$')
    expect(plain(formatMoney(99.5, 'USD'))).toBe('100 US$') // redondeado — a propósito para celdas chicas
  })

  it('decimals:true: monto EXACTO, con centavos — lo que necesita el flujo de reserva completo', () => {
    expect(plain(formatMoney(200, 'USD', 'es', true))).toBe('200,00 US$')
    expect(plain(formatMoney(99.5, 'USD', 'es', true))).toBe('99,50 US$') // ya NO se pierde el centavo
  })

  it('decimals:true con moneda inválida: el fallback también respeta los centavos (no Math.round)', () => {
    expect(plain(formatMoney(99.5, 'NOPE', 'es', true))).toBe('NOPE 99.50')
  })
})
