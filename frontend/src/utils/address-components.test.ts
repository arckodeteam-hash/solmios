// address-components.test.ts — GH-33 + MAPGEO. El mapeo viejo leía Municipio SOLO de
// `administrative_area_level_2`; Google no devuelve ese componente en buena parte de RD, así que
// el campo quedaba vacío aun con un geocoding perfecto. Acá se fija la cadena de fallbacks.
// MAPGEO: Nominatim (OpenStreetMap) se usa como fallback cuando no hay key de Google.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mapAddressComponents, unresolvedFields, geocodeErrorMessage,
  reverseGeocodeNominatim,
  ADDRESS_FIELD_LABELS, type AddressComponent,
} from './address-components'

const comp = (long_name: string, ...types: string[]): AddressComponent => ({ long_name, types })

describe('mapAddressComponents', () => {
  it('mapea un punto con el set completo de componentes', () => {
    expect(mapAddressComponents([
      comp('Higüey', 'locality', 'political'),
      comp('Higüey', 'administrative_area_level_2', 'political'),
      comp('La Altagracia', 'administrative_area_level_1', 'political'),
      comp('23000', 'postal_code'),
      comp('República Dominicana', 'country', 'political'),
    ])).toEqual({
      province: 'La Altagracia',
      municipality: 'Higüey',
      locality: 'Higüey',
      postalCode: '23000',
    })
  })

  it('resuelve Municipio desde locality cuando falta administrative_area_level_2', () => {
    // Caso Distrito Nacional: Google no manda el nivel 2 — el bug original dejaba Municipio vacío.
    const mapped = mapAddressComponents([
      comp('Santo Domingo', 'locality', 'political'),
      comp('Distrito Nacional', 'administrative_area_level_1', 'political'),
    ])
    expect(mapped.municipality).toBe('Santo Domingo')
    expect(mapped.province).toBe('Distrito Nacional')
  })

  it('cae a la entidad de primer orden si no hay ni nivel 2 ni ciudad', () => {
    const mapped = mapAddressComponents([comp('Pedernales', 'administrative_area_level_1', 'political')])
    expect(mapped.municipality).toBe('Pedernales')
    expect(mapped.province).toBe('Pedernales')
  })

  it('resuelve Localidad desde el sector/barrio cuando no hay locality', () => {
    expect(mapAddressComponents([
      comp('Piantini', 'sublocality_level_1', 'sublocality', 'political'),
      comp('Distrito Nacional', 'administrative_area_level_1', 'political'),
    ]).locality).toBe('Piantini')

    expect(mapAddressComponents([
      comp('Bávaro', 'neighborhood', 'political'),
    ]).locality).toBe('Bávaro')
  })

  it('acepta postal_code_prefix cuando no hay código postal exacto', () => {
    expect(mapAddressComponents([comp('11', 'postal_code_prefix')]).postalCode).toBe('11')
  })

  it('nunca inventa: sin componentes útiles devuelve todo vacío', () => {
    const mapped = mapAddressComponents([comp('República Dominicana', 'country', 'political')])
    expect(mapped).toEqual({ province: '', municipality: '', locality: '', postalCode: '' })
    expect(unresolvedFields(mapped)).toEqual(['province', 'municipality', 'locality', 'postalCode'])
  })

  it('tolera entradas basura sin reventar', () => {
    const vacio = { province: '', municipality: '', locality: '', postalCode: '' }
    expect(mapAddressComponents(undefined)).toEqual(vacio)
    expect(mapAddressComponents(null)).toEqual(vacio)
    expect(mapAddressComponents([])).toEqual(vacio)
    expect(mapAddressComponents([{ long_name: 'x' } as unknown as AddressComponent])).toEqual(vacio)
  })

  it('ignora componentes con nombre en blanco y sigue la cadena', () => {
    const mapped = mapAddressComponents([
      comp('   ', 'administrative_area_level_2', 'political'),
      comp('Sosúa', 'locality', 'political'),
    ])
    expect(mapped.municipality).toBe('Sosúa')
  })
})

describe('unresolvedFields', () => {
  it('lista solo lo que quedó vacío', () => {
    expect(unresolvedFields({ province: 'La Altagracia', municipality: 'Higüey', locality: '', postalCode: '' }))
      .toEqual(['locality', 'postalCode'])
  })
})

describe('geocodeErrorMessage', () => {
  it('distingue REQUEST_DENIED y nombra la API que hay que habilitar', () => {
    const msg = geocodeErrorMessage(new Error('REQUEST_DENIED'))
    expect(msg.variant).toBe('error')
    expect(`${msg.title} ${msg.detail}`).toContain('Geocoding API')
  })

  it('trata ZERO_RESULTS como aviso, no como error', () => {
    expect(geocodeErrorMessage({ code: 'ZERO_RESULTS' }).variant).toBe('warning')
  })

  it('reconoce el agotamiento de cuota', () => {
    expect(geocodeErrorMessage(new Error('OVER_QUERY_LIMIT')).detail).toContain('Google Cloud')
  })

  it('da un mensaje accionable para un fallo de red desconocido', () => {
    const msg = geocodeErrorMessage(new TypeError('Failed to fetch'))
    expect(msg.variant).toBe('error')
    expect(msg.detail).toContain('conexión')
  })

  it('no explota con null/undefined', () => {
    expect(geocodeErrorMessage(null).title).toBeTruthy()
    expect(geocodeErrorMessage(undefined).title).toBeTruthy()
  })
})

describe('ADDRESS_FIELD_LABELS', () => {
  it('cubre los cuatro campos con el texto que muestra la pantalla', () => {
    expect(ADDRESS_FIELD_LABELS).toEqual({
      province: 'Provincia', municipality: 'Municipio',
      locality: 'Localidad', postalCode: 'Código Postal',
    })
  })
})

// ── MAPGEO — Nominatim (OpenStreetMap) fallback ───────────────────────────────────────────────

describe('reverseGeocodeNominatim', () => {
  const fetchSpy = vi.fn()

  beforeEach(() => {
    fetchSpy.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })

  const nominatimResponse = (address: Record<string, string>) => ({
    ok: true,
    json: async () => ({ address }),
  })

  it('mapea state→province, city→municipality, suburb→locality, postcode→postalCode', async () => {
    fetchSpy.mockResolvedValueOnce(nominatimResponse({
      state: 'La Altagracia',
      city: 'Higüey',
      suburb: 'Villa Piantini',
      postcode: '23000',
    }))
    const result = await reverseGeocodeNominatim(18.6, -68.7)

    expect(result).toEqual({
      province: 'La Altagracia',
      municipality: 'Higüey',
      locality: 'Villa Piantini',
      postalCode: '23000',
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    )
  })

  it('usa town como fallback para municipio cuando no hay city', async () => {
    fetchSpy.mockResolvedValueOnce(nominatimResponse({
      state: 'Duarte',
      town: 'San Francisco de Macorís',
      postcode: '31000',
    }))
    const result = await reverseGeocodeNominatim(19.3, -70.25)

    expect(result.municipality).toBe('San Francisco de Macorís')
    expect(result.locality).toBe('San Francisco de Macorís')
  })

  it('usa village como último recurso para municipio', async () => {
    fetchSpy.mockResolvedValueOnce(nominatimResponse({
      state: 'Pedernales',
      village: 'Las Galeras',
    }))
    const result = await reverseGeocodeNominatim(19.0, -69.5)

    expect(result.municipality).toBe('Las Galeras')
    expect(result.locality).toBe('Las Galeras')
  })

  it('resuelve locality desde neighbourhood si no hay suburb ni city', async () => {
    fetchSpy.mockResolvedValueOnce(nominatimResponse({
      state: 'Santiago',
      neighbourhood: 'Ciudad Nueva',
    }))
    const result = await reverseGeocodeNominatim(19.45, -70.7)

    expect(result.province).toBe('Santiago')
    expect(result.locality).toBe('Ciudad Nueva')
    expect(result.municipality).toBe('')  // sin city/town/village/county/state_district
  })

  it('devuelve todo vacío cuando Nominatim no trae address', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const result = await reverseGeocodeNominatim(19.0, -70.0)

    expect(result).toEqual({ province: '', municipality: '', locality: '', postalCode: '' })
  })

  it('lanza error cuando fetch falla', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(reverseGeocodeNominatim(19.0, -70.0)).rejects.toThrow()
  })

  it('lanza error cuando Nominatim responde con HTTP error', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(reverseGeocodeNominatim(19.0, -70.0)).rejects.toThrow('429')
  })

  it('usa county como fallback para municipio', async () => {
    fetchSpy.mockResolvedValueOnce(nominatimResponse({
      state: 'Santiago',
      county: 'Santiago',
      postcode: '51000',
    }))
    const result = await reverseGeocodeNominatim(19.45, -70.7)

    expect(result.municipality).toBe('Santiago')
  })
})
