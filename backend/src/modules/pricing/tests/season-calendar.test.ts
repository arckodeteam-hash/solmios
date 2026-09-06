// pricing/tests/season-calendar.test.ts — Una sola respuesta a "en qué temporada estoy".
//
// El caso que lo motivó, medido en producción el 2026-09-05 (Hotel Boutique Palma): el planning leía
// solo los días PINTADOS, así que un día cubierto por el rango del catálogo no mostraba temporada
// alguna aunque el motor ya estuviera cobrando esa. Tres pantallas resolvían la mezcla por su cuenta.

import { describe, it, expect } from 'bun:test'
import { seasonCalendar, datesBetween, type SeasonCalendarDeps } from '../usecases/season-calendar'

const SEASONS = [
  { name: 'baja', startDate: '2026-09-01', endDate: '2026-12-14' },
  { name: 'media', startDate: '2027-04-16', endDate: '2027-08-31' },
  { name: 'especial', startDate: '', endDate: '' },
]

function deps(assignments: Array<{ date: string; season: string }> = [], seasons = SEASONS): SeasonCalendarDeps {
  return { seasons: async () => seasons, assignments: async () => assignments }
}

describe('datesBetween', () => {
  it('incluye las dos puntas', () => {
    expect(datesBetween('2026-09-04', '2026-09-06')).toEqual(['2026-09-04', '2026-09-05', '2026-09-06'])
  })

  it('rango invertido o mal formado devuelve vacío', () => {
    expect(datesBetween('2026-09-06', '2026-09-04')).toEqual([])
    expect(datesBetween('ayer', '2026-09-06')).toEqual([])
  })

  it('acota el rango: no genera un día por cada fecha de una consulta abusiva', () => {
    expect(datesBetween('2026-01-01', '2030-01-01').length).toBe(400)
  })
})

describe('seasonCalendar', () => {
  it('un día cubierto por el rango del catálogo YA tiene temporada, sin pintar nada', async () => {
    const r = await seasonCalendar(deps(), 'h1', '2026-09-05', '2026-09-05')
    expect(r).toEqual([{ date: '2026-09-05', season: 'baja', source: 'catalog' }])
  })

  it('un día pintado gana sobre el rango del catálogo, igual que en el cobro', async () => {
    const r = await seasonCalendar(deps([{ date: '2026-09-05', season: 'especial' }]), 'h1', '2026-09-05', '2026-09-05')
    expect(r).toEqual([{ date: '2026-09-05', season: 'especial', source: 'planning' }])
  })

  it('marca `planning` cuando la pintura es la que decide, aunque coincida con el rango', async () => {
    const r = await seasonCalendar(deps([{ date: '2026-09-05', season: 'baja' }]), 'h1', '2026-09-05', '2026-09-05')
    expect(r[0]!.source).toBe('planning')
  })

  it('una temporada de OTRO año no cubre hoy', async () => {
    const r = await seasonCalendar(deps(), 'h1', '2027-05-01', '2027-05-01')
    expect(r[0]!.season).toBe('media')
    const hoy = await seasonCalendar(deps(), 'h1', '2026-09-05', '2026-09-05')
    expect(hoy[0]!.season).toBe('baja')
  })

  it('un día sin rango ni pintura queda AFUERA (esa noche cotiza el base sin recargo)', async () => {
    const r = await seasonCalendar(deps(), 'h1', '2026-08-30', '2026-08-31')
    expect(r).toEqual([])
  })

  it('una temporada sin fechas no cubre nada por sí sola', async () => {
    const r = await seasonCalendar(deps([], [{ name: 'especial', startDate: '', endDate: '' }]), 'h1', '2026-09-05', '2026-09-05')
    expect(r).toEqual([])
  })

  it('devuelve el rango completo, un día por fecha', async () => {
    const r = await seasonCalendar(deps([{ date: '2026-09-06', season: 'especial' }]), 'h1', '2026-09-05', '2026-09-07')
    expect(r.map((d) => `${d.date}:${d.season}`)).toEqual([
      '2026-09-05:baja', '2026-09-06:especial', '2026-09-07:baja',
    ])
  })

  it('sin catálogo ni asignaciones no rompe', async () => {
    const r = await seasonCalendar(deps([], []), 'h1', '2026-09-05', '2026-09-06')
    expect(r).toEqual([])
  })
})
