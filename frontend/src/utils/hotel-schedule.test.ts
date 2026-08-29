import { describe, it, expect } from 'vitest'
import {
  normalizeTime, hotelCheckInTime, hotelCheckOutTime,
  effectiveCheckInTime, effectiveCheckOutTime, hasCustomSchedule,
} from './hotel-schedule'
// `?raw` de Vite en vez de `node:fs`: el tsconfig del frontend no incluye los tipos de Node
// (el build con tsc falla), y así el test lee el MISMO fuente que compila Vite.
import modalSrc from '@/components/features/ReservationModal.vue?raw'
import calendarSrc from '@/components/features/ReservationCalendar.vue?raw'

describe('normalizeTime', () => {
  it('normaliza y rechaza lo inválido', () => {
    expect(normalizeTime('9:05')).toBe('09:05')
    expect(normalizeTime('23:59')).toBe('23:59')
    expect(normalizeTime('24:00')).toBeNull()
    expect(normalizeTime('')).toBeNull()
    expect(normalizeTime(undefined)).toBeNull()
  })
})

describe('horario del hotel', () => {
  it('lee el campo REAL del modelo (checkIn), no checkInTime', () => {
    expect(hotelCheckInTime({ checkIn: '16:00' })).toBe('16:00')
    expect(hotelCheckOutTime({ checkOut: '10:30' })).toBe('10:30')
  })
  it('el default es el del modelo (15:00), NO el viejo 14:00 hardcodeado', () => {
    expect(hotelCheckInTime(null)).toBe('15:00')
    expect(hotelCheckInTime(null)).not.toBe('14:00')
    expect(hotelCheckOutTime(null)).toBe('12:00')
  })
})

describe('horario acordado con el huésped', () => {
  const hotel = { checkIn: '15:00', checkOut: '12:00' }
  it('la reserva pisa al hotel', () => {
    expect(effectiveCheckInTime({ checkInTime: '10:00' }, hotel)).toBe('10:00')
    expect(effectiveCheckOutTime({ checkOutTime: '19:00' }, hotel)).toBe('19:00')
  })
  it('sin acuerdo manda el hotel', () => {
    expect(effectiveCheckInTime(null, hotel)).toBe('15:00')
    expect(effectiveCheckInTime({ checkInTime: '' }, hotel)).toBe('15:00')
  })
  it('hasCustomSchedule distingue acuerdo de default', () => {
    expect(hasCustomSchedule({ checkInTime: '10:00' })).toBe(true)
    expect(hasCustomSchedule({ checkOutTime: '19:00' })).toBe(true)
    expect(hasCustomSchedule({ checkInTime: '', checkOutTime: '' })).toBe(false)
    expect(hasCustomSchedule(null)).toBe(false)
  })
})

// Guardia estructural: el bug original fue leer un campo que no existe (`hotel.checkInTime`)
// con un `as any` que desactivó el chequeo de tipos. Este test falla si alguien lo reintroduce.
describe('guardia — nadie vuelve a leer hotel.checkInTime', () => {
  const files: [string, string][] = [
    ['ReservationModal.vue', modalSrc],
    ['ReservationCalendar.vue', calendarSrc],
  ]
  it.each(files)('%s no lee checkInTime/checkOutTime del HOTEL', (_name, src) => {
    expect(src).not.toMatch(/\bh\?\.\s*checkInTime/)
    expect(src).not.toMatch(/\bh\?\.\s*checkOutTime/)
    expect(src).not.toMatch(/hotel\w*\.checkInTime/)
  })
  it.each(files)('%s calcula el horario con el helper compartido', (_name, src) => {
    expect(src).toContain("from '@/utils/hotel-schedule'")
    expect(src).toContain('effectiveCheckInTime(')
  })
  it('ningún componente reintroduce el literal 14:00 como hora de entrada', () => {
    for (const [, src] of files) {
      expect(src).not.toMatch(/checkInTime\s*\|\|\s*'14:00'/)
    }
  })
})
