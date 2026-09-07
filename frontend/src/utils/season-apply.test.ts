// utils/season-apply.test.ts — El rango que se propone al aplicar una temporada desde tarifas.
import { describe, it, expect } from 'vitest'
import { proposedApplyRange, applyRangeError } from './season-apply'

const TODAY = '2026-09-04'

describe('proposedApplyRange', () => {
  it('rango futuro del catálogo → se propone tal cual', () => {
    const r = proposedApplyRange({ startDate: '2026-12-01', endDate: '2026-12-31' }, TODAY)
    expect(r).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('el rango que arranca hoy no se toca', () => {
    const r = proposedApplyRange({ startDate: TODAY, endDate: '2026-11-30' }, TODAY)
    expect(r).toEqual({ from: TODAY, to: '2026-11-30' })
  })

  // Pintar días pasados sale 200 y no cambia ningún precio que se esté vendiendo: el hotel apretaría
  // "Aplicar" y la pantalla seguiría mostrando la misma temporada rigiendo hoy.
  it('temporada terminada → se propone solo hoy, no sus fechas viejas', () => {
    const r = proposedApplyRange({ startDate: '2026-01-01', endDate: '2026-05-31' }, TODAY)
    expect(r).toEqual({ from: TODAY, to: TODAY })
  })

  it('terminada ayer sigue siendo terminada', () => {
    const r = proposedApplyRange({ startDate: '2026-01-01', endDate: '2026-09-03' }, TODAY)
    expect(r).toEqual({ from: TODAY, to: TODAY })
  })

  it('temporada en curso → el inicio se recorta a hoy y se respeta el fin', () => {
    const r = proposedApplyRange({ startDate: '2026-06-01', endDate: '2026-11-30' }, TODAY)
    expect(r).toEqual({ from: TODAY, to: '2026-11-30' })
  })

  it('el rango que termina HOY todavía sirve: se aplica el día de hoy', () => {
    const r = proposedApplyRange({ startDate: '2026-06-01', endDate: TODAY }, TODAY)
    expect(r).toEqual({ from: TODAY, to: TODAY })
  })

  it('sin fechas → solo hoy, que es lo mínimo que se ve en pantalla', () => {
    expect(proposedApplyRange({}, TODAY)).toEqual({ from: TODAY, to: TODAY })
  })

  it('con una sola punta no alcanza: se propone solo hoy', () => {
    expect(proposedApplyRange({ startDate: '2026-12-01' }, TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(proposedApplyRange({ endDate: '2026-12-31' }, TODAY)).toEqual({ from: TODAY, to: TODAY })
  })

  it('temporada inexistente → solo hoy, sin romper', () => {
    expect(proposedApplyRange(undefined, TODAY)).toEqual({ from: TODAY, to: TODAY })
  })

  // Con `new Date('2026-01-01')` el día se corre por zona horaria y el rango de otro año se
  // compararía mal contra hoy. Todo se decide como texto ISO.
  it('compara como texto ISO: el rango del año que viene no queda como terminado', () => {
    const r = proposedApplyRange({ startDate: '2027-04-16', endDate: '2027-08-31' }, TODAY)
    expect(r).toEqual({ from: '2027-04-16', to: '2027-08-31' })
  })
})

describe('applyRangeError', () => {
  it('rango usable → sin error', () => {
    expect(applyRangeError('2026-09-04', '2026-11-30')).toBe('')
    expect(applyRangeError(TODAY, TODAY)).toBe('')
  })

  it('falta alguna de las dos fechas', () => {
    expect(applyRangeError('', '2026-11-30')).toBe('Elegí las dos fechas')
    expect(applyRangeError('2026-09-04', '')).toBe('Elegí las dos fechas')
    expect(applyRangeError('', '')).toBe('Elegí las dos fechas')
  })

  it('fin anterior al inicio', () => {
    expect(applyRangeError('2026-11-30', '2026-09-04')).toBe(
      'La fecha de fin no puede ser anterior a la de inicio',
    )
  })

  // Con `todayISO` la validación tapa el agujero que deja el `min` de los inputs: se puede tipear
  // una fecha anterior, y aplicar el pasado repinta noches ya vendidas.
  it('con todayISO rechaza un inicio anterior a hoy', () => {
    expect(applyRangeError('2026-08-01', '2026-11-30', TODAY)).toBe(
      'No se pueden aplicar días pasados: elegí desde hoy en adelante',
    )
    expect(applyRangeError('2026-08-01', '2026-08-20', TODAY)).toBe(
      'No se pueden aplicar días pasados: elegí desde hoy en adelante',
    )
  })

  it('con todayISO acepta desde hoy en adelante', () => {
    expect(applyRangeError(TODAY, TODAY, TODAY)).toBe('')
    expect(applyRangeError(TODAY, '2026-11-30', TODAY)).toBe('')
    expect(applyRangeError('2027-04-16', '2027-08-31', TODAY)).toBe('')
  })

  // El orden importa: un rango pasado E invertido tiene que avisar del invertido primero, que es el
  // error que el hotel puede ver en pantalla sin pensar en fechas.
  it('el rango invertido gana sobre el pasado', () => {
    expect(applyRangeError('2026-08-20', '2026-08-01', TODAY)).toBe(
      'La fecha de fin no puede ser anterior a la de inicio',
    )
  })

  // Sin `todayISO` sigue valiendo lo de antes: nadie que ya la use se rompe.
  it('sin todayISO no mira el pasado', () => {
    expect(applyRangeError('2020-01-01', '2020-01-31')).toBe('')
  })
})
