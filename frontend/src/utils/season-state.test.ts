// utils/season-state.test.ts — La regla que decide si un ajuste de temporada llega al canal.
import { describe, it, expect } from 'vitest'
import { seasonState, formatShortDate } from './season-state'

const TODAY = '2026-09-04'
const s = (over: Partial<{ name: string; startDate: string; endDate: string }> = {}) =>
  ({ name: 'media', ...over })

describe('seasonState', () => {
  it('hoy dentro del rango → vigente, se publica', () => {
    const r = seasonState(s({ startDate: '2026-06-01', endDate: '2026-11-30' }), TODAY)
    expect(r).toEqual({ publishes: true, live: true, badge: 'Vigente hoy', reason: '' })
  })

  it('rango futuro → se publica, no es la vigente, el badge muestra el rango', () => {
    const r = seasonState(s({ name: 'alta', startDate: '2026-12-01', endDate: '2026-12-31' }), TODAY)
    expect(r.publishes).toBe(true)
    expect(r.live).toBe(false)
    expect(r.badge).toBe('1/12 → 31/12')
    expect(r.reason).toBe('')
  })

  it('rango terminado → NO se publica y el motivo dice desde cuándo', () => {
    const r = seasonState(s({ name: 'baja', startDate: '2026-01-01', endDate: '2026-05-31' }), TODAY)
    expect(r.publishes).toBe(false)
    expect(r.reason).toBe('Terminó el 31/5 · no se publica')
  })

  it('sin fechas y sin días pintados → NO se publica', () => {
    const r = seasonState(s({ name: 'especial' }), TODAY)
    expect(r.publishes).toBe(false)
    expect(r.reason).toBe('Sin fechas · no se publica')
  })

  it('sin fechas propias pero pintada en el planning → SÍ se publica (el backend toma season_assignments)', () => {
    const r = seasonState(s({ name: 'especial' }), TODAY, new Set(['especial']))
    expect(r.publishes).toBe(true)
    expect(r.reason).toBe('')
    expect(r.badge).toBe('Pintada en el planning')
  })

  it('rango terminado pero pintada a futuro → se publica por el planning', () => {
    const r = seasonState(s({ name: 'baja', startDate: '2026-01-01', endDate: '2026-05-31' }), TODAY, new Set(['baja']))
    expect(r.publishes).toBe(true)
    expect(r.reason).toBe('')
  })

  it('el último día del rango todavía cuenta como vigente', () => {
    const r = seasonState(s({ startDate: '2026-06-01', endDate: TODAY }), TODAY)
    expect(r.live).toBe(true)
    expect(r.publishes).toBe(true)
  })

  it('el primer día del rango ya cuenta como vigente', () => {
    const r = seasonState(s({ startDate: TODAY, endDate: '2026-12-31' }), TODAY)
    expect(r.live).toBe(true)
  })

  it('con una sola punta del rango no alcanza: se trata como sin fechas', () => {
    expect(seasonState(s({ startDate: '2026-06-01' }), TODAY).publishes).toBe(false)
    expect(seasonState(s({ endDate: '2026-11-30' }), TODAY).publishes).toBe(false)
  })

  it('temporada inexistente → no se publica, sin romper', () => {
    expect(seasonState(undefined, TODAY).publishes).toBe(false)
  })

  it('formatShortDate no corre el día por zona horaria', () => {
    expect(formatShortDate('2026-01-01')).toBe('1/1')
    expect(formatShortDate('2026-12-31')).toBe('31/12')
    expect(formatShortDate('')).toBe('')
  })

  // Medido en producción el 2026-09-05: el catálogo del Hotel Boutique Palma tenía `media` en
  // 2027-04-16 → 2027-08-31 y la pantalla la mostraba como "16/4 → 31/8". Sin el año eso se lee
  // como el rango de este año, recién terminado, y no hay forma de notar que falta un año entero.
  it('formatShortDate muestra el año cuando NO es el de la fecha de referencia', () => {
    expect(formatShortDate('2027-04-16', '2026-09-05')).toBe('16/4/27')
    expect(formatShortDate('2026-12-15', '2026-09-05')).toBe('15/12')
  })

  it('el badge del rango de otro año lo dice', () => {
    const r = seasonState(s({ startDate: '2027-04-16', endDate: '2027-08-31' }), TODAY)
    expect(r.badge).toBe('16/4/27 → 31/8/27')
  })

  // El planning PISA al catálogo en el backend (`buildSeasonByDate` aplica los assignments al
  // final). Si la pantalla mira solo el rango, anuncia una temporada vigente mientras el motor
  // cobra la otra — el mismo molde de "el panel dice una cosa y el motor cobra otra".
  describe('el planning manda sobre el rango del catálogo', () => {
    it('hoy pintado con OTRA temporada saca a la del rango', () => {
      const r = seasonState(s({ name: 'baja', startDate: '2026-09-01', endDate: '2026-12-14' }), TODAY, new Set(['media']), 'media')
      expect(r.live).toBe(false)
      expect(r.publishes).toBe(true)
    })

    it('hoy pintado con ESTA la vuelve vigente aunque su rango sea de otro año', () => {
      const r = seasonState(s({ name: 'media', startDate: '2027-04-16', endDate: '2027-08-31' }), TODAY, new Set(['media']), 'media')
      expect(r.live).toBe(true)
      expect(r.badge).toBe('Vigente hoy')
    })

    it('hoy pintado con ESTA la vuelve vigente aunque su rango haya terminado', () => {
      const r = seasonState(s({ name: 'baja', startDate: '2026-01-01', endDate: '2026-05-31' }), TODAY, new Set(['baja']), 'baja')
      expect(r.live).toBe(true)
      expect(r.reason).toBe('')
    })

    it('sin fechas propias, pintada HOY es la vigente', () => {
      const r = seasonState(s({ name: 'especial' }), TODAY, new Set(['especial']), 'especial')
      expect(r).toEqual({ publishes: true, live: true, badge: 'Vigente hoy', reason: '' })
    })

    it('sin planning para hoy, el rango decide como antes', () => {
      const r = seasonState(s({ name: 'baja', startDate: '2026-09-01', endDate: '2026-12-14' }), TODAY, new Set(['media']))
      expect(r.live).toBe(true)
    })
  })
})
