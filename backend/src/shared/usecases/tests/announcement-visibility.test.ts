// Reglas puras de visibilidad de anuncios. Son las que deciden si un mensaje del dueño de la
// plataforma llega o no llega a un hotel, así que se verifican caso por caso y sin base de datos.
import { describe, it, expect } from 'bun:test'
import {
  effectiveAudience, isPlatformWide, isVisibleFor, isWithinWindow, isActive,
  byRecencyDesc, dedupeById, ADMIN_ROLES,
} from '../announcement-visibility'

const recepcion = { role: 'receptionist', hotelId: 'h1' }
const duenoH1 = { role: 'hotel_admin', hotelId: 'h1' }
const duenoH2 = { role: 'hotel_admin', hotelId: 'h2' }

describe('effectiveAudience', () => {
  it('respeta la columna cuando tiene un valor válido', () => {
    expect(effectiveAudience({ audience: 'all', hotelId: 'h1' })).toBe('all')
    expect(effectiveAudience({ audience: 'admins' })).toBe('admins')
    expect(effectiveAudience({ audience: 'hotel', hotelId: 'h1' })).toBe('hotel')
  })

  it('deduce la audiencia de las filas anteriores a la columna', () => {
    expect(effectiveAudience({ hotelId: 'h1' })).toBe('hotel')
    expect(effectiveAudience({ hotelId: null })).toBe('all')
    expect(effectiveAudience({ audience: 'basura' as any, hotelId: 'h1' })).toBe('hotel')
  })
})

describe('isPlatformWide', () => {
  it('un hotelId vacío es tan "de plataforma" como uno ausente', () => {
    expect(isPlatformWide({ hotelId: '' })).toBe(true)
    expect(isPlatformWide({})).toBe(true)
    expect(isPlatformWide({ hotelId: 'h1' })).toBe(false)
  })
})

describe('isVisibleFor', () => {
  it('un anuncio de plataforma lo ven todos los hoteles', () => {
    const row = { audience: 'all', hotelId: null }
    expect(isVisibleFor(row, duenoH1)).toBe(true)
    expect(isVisibleFor(row, duenoH2)).toBe(true)
    expect(isVisibleFor(row, recepcion)).toBe(true)
  })

  it('un anuncio de un hotel NUNCA sale de ese hotel', () => {
    const row = { audience: 'hotel', hotelId: 'h1' }
    expect(isVisibleFor(row, duenoH1)).toBe(true)
    expect(isVisibleFor(row, duenoH2)).toBe(false)
  })

  it('el aislamiento por hotel manda sobre la audiencia', () => {
    // Una fila mal cargada: dice "para todos" pero está atada a un hotel. No puede filtrarse.
    const row = { audience: 'all', hotelId: 'h1' }
    expect(isVisibleFor(row, duenoH2)).toBe(false)
    expect(isVisibleFor(row, duenoH1)).toBe(true)
  })

  it('"admins" excluye a los roles operativos', () => {
    const row = { audience: 'admins', hotelId: null }
    expect(isVisibleFor(row, recepcion)).toBe(false)
    expect(isVisibleFor(row, { role: 'housekeeper', hotelId: 'h1' })).toBe(false)
    expect(isVisibleFor(row, duenoH1)).toBe(true)
    expect(isVisibleFor(row, { role: 'super_admin', hotelId: null })).toBe(true)
  })

  it('ADMIN_ROLES es exactamente quien administra', () => {
    expect([...ADMIN_ROLES].sort()).toEqual(['hotel_admin', 'super_admin'])
  })
})

describe('isWithinWindow', () => {
  const ahora = new Date('2026-06-15T12:00:00Z')

  it('sin fechas, siempre vigente', () => {
    expect(isWithinWindow({}, ahora)).toBe(true)
  })

  it('antes de startsAt no se entrega', () => {
    expect(isWithinWindow({ startsAt: '2026-06-20T00:00:00Z' }, ahora)).toBe(false)
    expect(isWithinWindow({ startsAt: '2026-06-01T00:00:00Z' }, ahora)).toBe(true)
  })

  it('después de endsAt no se entrega', () => {
    expect(isWithinWindow({ endsAt: '2026-06-01T00:00:00Z' }, ahora)).toBe(false)
    expect(isWithinWindow({ endsAt: '2026-06-30T00:00:00Z' }, ahora)).toBe(true)
  })

  it('una fecha ilegible NO esconde el anuncio', () => {
    // Un dato mal cargado no puede silenciar un aviso que el hotel debería estar viendo.
    expect(isWithinWindow({ startsAt: 'mañana' }, ahora)).toBe(true)
    expect(isWithinWindow({ endsAt: '??' }, ahora)).toBe(true)
  })
})

describe('isActive', () => {
  it('acepta las dos formas en que viaja un booleano', () => {
    expect(isActive({ active: 1 })).toBe(true)
    expect(isActive({ active: true })).toBe(true)
    expect(isActive({ active: 0 })).toBe(false)
    expect(isActive({})).toBe(false)
  })
})

describe('byRecencyDesc', () => {
  it('ordena lo más reciente primero, con createdAt de respaldo', () => {
    const rows = [
      { id: 'viejo', date: '2026-01-01T00:00:00Z' },
      { id: 'nuevo', date: '2026-06-01T00:00:00Z' },
      { id: 'sin-date', createdAt: '2026-03-01T00:00:00Z' },
    ]
    expect([...rows].sort(byRecencyDesc).map((r) => r.id)).toEqual(['nuevo', 'sin-date', 'viejo'])
  })

  it('con la misma fecha, el orden es estable entre llamadas', () => {
    const rows = [{ id: 'b', date: 'x' }, { id: 'a', date: 'x' }]
    expect([...rows].sort(byRecencyDesc).map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('dedupeById', () => {
  it('un anuncio que viene de dos consultas aparece una sola vez', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'a' }]
    expect(dedupeById(rows).map((r) => r.id)).toEqual(['a', 'b'])
  })
})
