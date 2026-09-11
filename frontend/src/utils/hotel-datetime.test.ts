// utils/hotel-datetime.test.ts — #282 (M1): la hora de Caja es la del hotel, no la de UTC.
import { describe, it, expect } from 'vitest'
import { hotelDateTime, hotelDateTimeText } from './hotel-datetime'

describe('hotelDateTime', () => {
  it('un ISO en UTC se muestra en la zona del hotel (21:39Z → 17:39 en Santo Domingo)', () => {
    expect(hotelDateTime('2026-09-11T21:39:12.000Z', 'America/Santo_Domingo')).toEqual({ date: '2026-09-11', time: '17:39' })
    expect(hotelDateTimeText('2026-09-11T21:39:12.000Z', 'America/Santo_Domingo')).toBe('2026-09-11 17:39')
  })

  it('cruza la medianoche: 03:10Z del 12 es 23:10 del 11 en Santo Domingo, y medianoche sale 00:xx (no 24:xx)', () => {
    expect(hotelDateTime('2026-09-12T03:10:00.000Z', 'America/Santo_Domingo')).toEqual({ date: '2026-09-11', time: '23:10' })
    expect(hotelDateTime('2026-09-12T04:05:00.000Z', 'America/Santo_Domingo')).toEqual({ date: '2026-09-12', time: '00:05' })
  })

  it('un valor sin zona se muestra tal cual vino (no se inventa una conversión)', () => {
    expect(hotelDateTime('2026-08-22T08:00:00', 'America/Santo_Domingo')).toEqual({ date: '2026-08-22', time: '08:00' })
  })

  it('sin zona del hotel o con una inválida no rompe: cae a la del navegador / al texto crudo', () => {
    expect(hotelDateTime('2026-09-11T21:39:12.000Z', 'Marte/Olympus').date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(hotelDateTime('', 'America/Santo_Domingo')).toEqual({ date: '', time: '' })
    expect(hotelDateTimeText(undefined)).toBe('')
    expect(hotelDateTime('2026-13-45T99:00:00Z')).toEqual({ date: '2026-13-45', time: '99:00' })   // inválido: el texto crudo, como antes
  })
})
