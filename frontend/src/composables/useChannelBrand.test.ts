// El dashboard agrupaba las reservas por canal con un catálogo local de 6 entradas: todo lo
// que no estuviera ahí (Trip.com, Despegar, Hostelworld, walk-in, email) caía junto en un
// bucket "Otros". Estos tests fijan que la normalización compartida no vuelva a perder canales.
import { describe, it, expect } from 'vitest'
import { normalizeChannelKey, channelBrandOrDefault, getChannelBrand, CHANNEL_BRANDS } from './useChannelBrand'

describe('normalizeChannelKey', () => {
  it('resuelve los alias al mismo bucket (si no, Booking se cuenta dos veces)', () => {
    expect(normalizeChannelKey('booking.com')).toBe('booking')
    expect(normalizeChannelKey('bookingcom')).toBe('booking')
    expect(normalizeChannelKey('BOOKING')).toBe('booking')
    expect(normalizeChannelKey(' Booking.com ')).toBe('booking')
  })

  it('mapea las vías presenciales a "direct"', () => {
    expect(normalizeChannelKey('walk_in')).toBe('direct')
    expect(normalizeChannelKey('email')).toBe('direct')
    expect(normalizeChannelKey('directa')).toBe('direct')
  })

  it('reconoce los canales que el catálogo viejo del dashboard perdía', () => {
    for (const key of ['trip', 'trip.com', 'despegar', 'hostelworld', 'agoda']) {
      expect(normalizeChannelKey(key)).not.toBe('other')
    }
  })

  it('cae a "other" —que existe en el catálogo— para lo desconocido y lo vacío', () => {
    expect(normalizeChannelKey('canal-inventado')).toBe('other')
    expect(normalizeChannelKey('')).toBe('other')
    expect(normalizeChannelKey(null)).toBe('other')
    expect(CHANNEL_BRANDS.other).toBeDefined()
  })
})

describe('channelBrandOrDefault', () => {
  it('siempre devuelve una marca usable (label + color), nunca null', () => {
    for (const key of ['booking', 'canal-inventado', '', null]) {
      const brand = channelBrandOrDefault(key)
      expect(brand.label.length).toBeGreaterThan(0)
      expect(brand.color).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it('usa el color de marca real, no uno inventado por la vista', () => {
    expect(channelBrandOrDefault('booking').color).toBe('#003580')
    expect(channelBrandOrDefault('airbnb').color).toBe('#FF5A5F')
  })

  it('getChannelBrand sigue devolviendo null para lo desconocido (contrato viejo intacto)', () => {
    expect(getChannelBrand('canal-inventado')).toBeNull()
    expect(getChannelBrand(null)).toBeNull()
  })
})
