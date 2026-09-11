// booking-confirmation-format.test.ts — helpers puros de la confirmación pública (#241).
import { describe, it, expect } from 'vitest'
import {
  formatStayDate, nightsBetween, displayName, publicAddressLine, shortBookingCode,
  hotelTimeOrEmpty, parseIsoDate,
} from './booking-confirmation-format'

describe('formatStayDate — fecha legible en el idioma de la página', () => {
  it('es: "Lunes, 19 de octubre de 2026" (no el YYYY-MM-DD crudo)', () => {
    expect(formatStayDate('2026-10-19', 'es')).toBe('Lunes, 19 de octubre de 2026')
  })
  it('en: "Monday, October 19, 2026"', () => {
    expect(formatStayDate('2026-10-19', 'en')).toBe('Monday, October 19, 2026')
  })
  it('pt: "Segunda-feira, 19 de outubro de 2026"', () => {
    expect(formatStayDate('2026-10-19', 'pt')).toBe('Segunda-feira, 19 de outubro de 2026')
  })
  it('parsea como fecha LOCAL: el 19 nunca se lee 18 por el huso', () => {
    const d = parseIsoDate('2026-10-19')!
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 19])
    // Un timestamp ISO completo también se acepta (solo se usa la parte de fecha).
    expect(formatStayDate('2026-10-19T00:00:00.000Z', 'en')).toBe('Monday, October 19, 2026')
  })
  it('texto ilegible → se devuelve tal cual, nunca un guion', () => {
    expect(formatStayDate('mañana', 'es')).toBe('mañana')
    expect(formatStayDate(null, 'es')).toBe('')
  })
})

describe('nightsBetween', () => {
  it('cuenta noches entre check-in y check-out', () => {
    expect(nightsBetween('2026-10-19', '2026-10-21')).toBe(2)
    expect(nightsBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
  it('0 si falta una fecha o el orden está invertido', () => {
    expect(nightsBetween('2026-10-21', '2026-10-19')).toBe(0)
    expect(nightsBetween(undefined, '2026-10-19')).toBe(0)
  })
})

describe('displayName — capitalización solo para mostrar', () => {
  it('normaliza mayúsculas/minúsculas mezcladas', () => {
    expect(displayName('LUIS BERNIEL Ortiz mOYA')).toBe('Luis Berniel Ortiz Moya')
  })
  it('mantiene las partículas en minúscula salvo al principio', () => {
    expect(displayName('MARÍA DE LOS ÁNGELES PÉREZ')).toBe('María de los Ángeles Pérez')
    expect(displayName('de la cruz, juan')).toBe('De la Cruz, Juan')
    expect(displayName('joão da silva')).toBe('João da Silva')
  })
  it('respeta guiones y apóstrofes', () => {
    expect(displayName("ana-maría o'brien")).toBe("Ana-María O'Brien")
  })
  it('colapsa espacios y tolera vacío', () => {
    expect(displayName('  luis   ortiz ')).toBe('Luis Ortiz')
    expect(displayName(null)).toBe('')
  })
})

describe('publicAddressLine', () => {
  it('une solo los campos cargados y no repite municipio = localidad', () => {
    expect(publicAddressLine({
      address: 'Calle Principal 123, Punta Cana',
      locality: 'Santo Domingo de Guzmán',
      municipality: 'Santo Domingo de Guzmán',
      province: 'Distrito Nacional',
    })).toBe('Calle Principal 123, Punta Cana, Santo Domingo de Guzmán, Distrito Nacional')
  })
  it('sin nada cargado → vacío (la cabecera no dibuja el pin)', () => {
    expect(publicAddressLine({ address: '', locality: null })).toBe('')
    expect(publicAddressLine(null)).toBe('')
  })
})

describe('shortBookingCode / hotelTimeOrEmpty', () => {
  it('8 primeros del UUID, como ConfirmStep y el correo', () => {
    expect(shortBookingCode('5108c56c-1234-4abc-9def-000000000000')).toBe('5108c56c')
    expect(shortBookingCode(undefined)).toBe('')
  })
  it('solo acepta HH:MM; cualquier otra cosa se omite en vez de inventarse', () => {
    expect(hotelTimeOrEmpty('15:00')).toBe('15:00')
    expect(hotelTimeOrEmpty('3pm')).toBe('')
    expect(hotelTimeOrEmpty(null)).toBe('')
  })
})
