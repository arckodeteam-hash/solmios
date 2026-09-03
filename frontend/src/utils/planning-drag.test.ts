// planning-drag.test.ts — Arrastrar para MOVER no puede cambiar la duración ni saltar de lugar.
//
// Bug real, reproducido en producción el 2026-09-03 con la reserva de la Hab. 103
// (30/08 → 05/09, 6 noches): se arrastró UNA celda a la derecha y quedó 03/09 → 09/09. Movió 4
// días en vez de 1, y como la barra venía recortada por el borde del rango visible, en pantalla
// "creció" de 2 celdas a 6. La culpa era del tope de "no arrancar en el pasado", que usaba HOY
// como piso: a una reserva ya empezada la empujaba hacia adelante en vez de frenarla.
import { describe, it, expect } from 'vitest'
import { moveDragDestination, dragScopeFor, nightsBetween, addDays, daysBetween } from './planning-drag'

const HOY = '2026-09-03'

describe('moveDragDestination — mover es mover', () => {
  it('arrastrar una celda mueve UN día, no cuatro (el bug de la Hab. 103)', () => {
    const r = moveDragDestination({
      origCheckIn: '2026-08-30', origCheckOut: '2026-09-05',
      anchorDate: '2026-09-03',            // la agarró en el primer día VISIBLE, no en su checkIn
      dropDate: '2026-09-04',              // la soltó una celda a la derecha
      today: HOY,
    })
    expect(r).toEqual({ checkIn: '2026-08-31', checkOut: '2026-09-06' })
  })

  it('la duración nunca cambia al mover', () => {
    const casos = [
      { ci: '2026-09-10', co: '2026-09-11' },   // 1 noche
      { ci: '2026-09-10', co: '2026-09-17' },   // 7 noches
      { ci: '2026-08-30', co: '2026-09-05' },   // arranca en el pasado
    ]
    for (const c of casos) {
      for (const delta of [-3, -1, 0, 1, 5]) {
        const r = moveDragDestination({
          origCheckIn: c.ci, origCheckOut: c.co,
          anchorDate: '2026-09-10', dropDate: addDays('2026-09-10', delta), today: HOY,
        })
        expect(nightsBetween(r.checkIn, r.checkOut)).toBe(nightsBetween(c.ci, c.co))
      }
    }
  })

  it('mover N celdas mueve exactamente N días', () => {
    for (const delta of [1, 2, 5, 30]) {
      const r = moveDragDestination({
        origCheckIn: '2026-09-10', origCheckOut: '2026-09-12',
        anchorDate: '2026-09-10', dropDate: addDays('2026-09-10', delta), today: HOY,
      })
      expect(daysBetween('2026-09-10', r.checkIn)).toBe(delta)
    }
  })

  it('el ancla manda: agarrar por el medio de la barra no la teletransporta', () => {
    // Estadía 10→14. La agarra el día 12 y la suelta en el 13: mueve 1 día, no salta al 13.
    const r = moveDragDestination({
      origCheckIn: '2026-09-10', origCheckOut: '2026-09-14',
      anchorDate: '2026-09-12', dropDate: '2026-09-13', today: HOY,
    })
    expect(r).toEqual({ checkIn: '2026-09-11', checkOut: '2026-09-15' })
  })

  it('una reserva futura NO puede arrastrarse antes de hoy: se frena en hoy', () => {
    const r = moveDragDestination({
      origCheckIn: '2026-09-05', origCheckOut: '2026-09-08',
      anchorDate: '2026-09-05', dropDate: '2026-08-20', today: HOY,
    })
    expect(r).toEqual({ checkIn: HOY, checkOut: '2026-09-06' })
  })

  it('el tope FRENA, nunca adelanta: una reserva ya empezada no salta hacia adelante', () => {
    // Arrastrada hacia atrás, se frena en su propio inicio; no la empuja a hoy.
    const r = moveDragDestination({
      origCheckIn: '2026-08-30', origCheckOut: '2026-09-05',
      anchorDate: '2026-09-03', dropDate: '2026-08-25', today: HOY,
    })
    expect(r.checkIn).toBe('2026-08-30')
    expect(nightsBetween(r.checkIn, r.checkOut)).toBe(6)
  })

  it('sin movimiento, nada cambia', () => {
    const r = moveDragDestination({
      origCheckIn: '2026-09-10', origCheckOut: '2026-09-12',
      anchorDate: '2026-09-11', dropDate: '2026-09-11', today: HOY,
    })
    expect(r).toEqual({ checkIn: '2026-09-10', checkOut: '2026-09-12' })
  })
})

describe('dragScopeFor — qué se puede arrastrar según el estado', () => {
  it('una reserva sin llegar todavía se mueve entera', () => {
    for (const s of ['confirmed', 'pending', 'guaranteed', undefined]) {
      expect(dragScopeFor(s)).toBe('full')
    }
  })

  it('con el huésped ADENTRO solo se cambia de habitación: la entrada ya ocurrió', () => {
    expect(dragScopeFor('checked_in')).toBe('room-only')
  })

  it('una reserva ya cerrada no se arrastra: es historia', () => {
    expect(dragScopeFor('checked_out')).toBe('none')
  })
})
