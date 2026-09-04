// bookingengine/tests/public-hotel-info.test.ts — Info pública del hotel por slug (F0 0.4
// spec public-hotel-info). Cubre: allow-list estricta (ninguna clave privada del hotelero se
// filtra, en ningún nivel del JSON), 404 genérico idéntico para hotel-inexistente y
// onlineBookingStatus!=active, defaults correctos (checkIn '15:00' / checkOut '12:00' del
// modelo, NO '14:00'/'11:00' hardcodeados del stub viejo), y rate-limit 60/60s propio.
// Mirror de restaurant/tests/public-menu.test.ts (helpers backed<T>/makeRepo<T>).
import { describe, it, expect } from 'bun:test'
import { NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { getPublicHotelInfo } from '../usecases/public-hotel-info'
import { rateLimit } from '../../../shared/middlewares/rate-limit'

// ─── Helpers (mismo patrón que restaurant/tests/public-menu.test.ts) ───
function makeRepo<T extends object>(overrides: Partial<RepositoryAdapter<T>> = {}): RepositoryAdapter<T> {
  return {
    findMany: async () => [], findById: async () => null, findOne: async () => null,
    create: async (data: any) => ({ id: 'gen-id', ...data }),
    update: async (id: any, data: any) => ({ id, ...data }),
    delete: async () => true, count: async () => 0,
    paginate: async () => ({ data: [], total: 0, limit: 100, offset: 0, pages: 0 }),
    ...overrides,
  } as RepositoryAdapter<T>
}
function backed<T extends object>(seed: any[] = []): RepositoryAdapter<T> {
  const store = [...seed]
  const match = (r: any, q: any) => Object.keys(q || {}).every((k) => r[k] === q[k])
  return {
    ...makeRepo<any>(),
    findById: async (id: any) => store.find((r) => r.id === id) ?? null,
    findOne: async (q: any) => store.find((r) => match(r, q)) ?? null,
    findMany: async (q: any = {}) => store.filter((r) => match(r, q)),
  } as RepositoryAdapter<T>
}

// 10 claves privadas del hotelero que el DTO público NUNCA debe exponer (spec
// public-hotel-info). Si el usecase hiciera spread del objeto hotel, todas estas aparecerían.
const FORBIDDEN_KEYS = [
  'taxId', 'ownerName', 'ownerTaxId', 'deviceEmail', 'wifiNetwork', 'wifiPassword',
  'internalNotes', 'bookingEngineUrl', 'motorVersion', 'warningPhone', 'registrationNumber',
]

// Seed completo de un hotel activo con TODOS los campos privados poblados — para verificar
// que el allow-list los descarta TODOS.
function hotelSeed(overrides: Record<string, any> = {}): any {
  return {
    id: 'h1',
    name: 'Hotel Paraíso',
    slug: 'hotel-paraiso',
    descriptionJson: JSON.stringify({ title: 'Hotel Paraíso', description: 'Un hotel de prueba' }),
    descriptionTranslations: { en: { title: 'Hotel Paradise', description: 'A test hotel' } },
    accommodationType: 'resort',
    starRating: '5',
    latitude: 18.7357,
    longitude: -70.1627,
    address: 'Calle Sol 123',
    province: 'Santo Domingo',
    municipality: 'Distrito Nacional',
    locality: 'Piantini',
    postalCode: '10210',
    phone: '+1 809 555 0000',
    email: 'contacto@hotelparaiso.com',
    website: 'https://hotelparaiso.com',
    checkIn: '15:00',
    checkOut: '12:00',
    currency: 'USD',
    taxName: 'ITBIS',
    taxRate: 18.0,
    cancellationType: 'flexible',
    freeCancellation: true,
    depositRequired: true,
    depositPercent: 30,
    releaseHours: 0,
    logo: 'https://cdn/logo.png',
    amenities: ['pool', 'gym', 'wifi', 'parking'],
    onlineBookingStatus: 'active',
    // ─── Campos PRIVADOS del hotelero (FORBIDDEN en el DTO público) ───
    taxId: '131-12345-6',
    ownerName: 'Juan Pérez',
    ownerTaxId: '001-1234567-8',
    deviceEmail: 'device@hotelparaiso.com',
    wifiNetwork: 'HotelParaíso-Guest',
    wifiPassword: 'supersecreto123',
    internalNotes: 'Cliente VIP, nunca cobrar servicio',
    bookingEngineUrl: 'https://internal.booking/admin',
    motorVersion: 'v1',
    warningPhone: '+1 829 555 9999',
    registrationNumber: 'H-2024-001',
    ...overrides,
  }
}

describe('F0 0.4 — getPublicHotelInfo: 200 con DTO completo y defaults correctos', () => {
  it('devuelve DTO con id/slug correctos, checkIn 15:00 / checkOut 12:00 (NO 14:00/11:00 hardcodeados), amenities array, starRating string', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)

    expect(dto.id).toBe('h1')
    expect(dto.slug).toBe('hotel-paraiso')
    expect(dto.name).toBe('Hotel Paraíso')
    // Defaults del modelo, NO del stub viejo (que tenía 14:00/11:00).
    expect(dto.checkIn).toBe('15:00')
    expect(dto.checkOut).toBe('12:00')
    expect(Array.isArray(dto.amenities)).toBe(true)
    expect(dto.amenities).toEqual(['pool', 'gym', 'wifi', 'parking'])
    expect(typeof dto.starRating).toBe('string')
    expect(dto.starRating).toBe('5')
    expect(dto.onlineBookingStatus).toBe('active')
    expect(dto.accommodationType).toBe('resort')
    expect(dto.currency).toBe('USD')
  })

  it('sin checkIn/checkOut declarados en el hotel → defaults del modelo (15:00/12:00)', async () => {
    const hotels = backed<any>([hotelSeed({ checkIn: undefined, checkOut: undefined })])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.checkIn).toBe('15:00')
    expect(dto.checkOut).toBe('12:00')
  })

  it('descriptionTranslations se expone crudo (para que el frontend seleccione lang) — Spanish base via descriptionJson', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.descriptionTranslations).toEqual({ en: { title: 'Hotel Paradise', description: 'A test hotel' } })
    expect(dto.title).toBe('Hotel Paraíso')
    expect(dto.description).toBe('Un hotel de prueba')
  })
})

describe('F0 0.4 — allow-list: NINGUNA clave prohibida se filtra, en ningún nivel', () => {
  it('hotel con TODOS los campos privados poblados → DTO serializado no contiene ninguna clave prohibida', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    const json = JSON.stringify(dto)

    for (const key of FORBIDDEN_KEYS) {
      expect(json.includes(`"${key}"`)).toBe(false)
    }
  })

  it('tampoco filtra campos privados bajo lang=en (mismo allow-list)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', 'en')
    const json = JSON.stringify(dto)
    for (const key of FORBIDDEN_KEYS) {
      expect(json.includes(`"${key}"`)).toBe(false)
    }
    expect(dto.title).toBe('Hotel Paradise')
    expect(dto.description).toBe('A test hotel')
  })
})

describe('F0 0.4 — 404 genérico: slug inexistente Y onlineBookingStatus!=active dan MISMA respuesta', () => {
  it('slug inexistente → NotFoundError con httpStatus=404', async () => {
    const hotels = backed<any>([hotelSeed()])
    await expect(getPublicHotelInfo({ hotels }, 'no-existe', undefined)).rejects.toThrow('Hotel not found')
    try {
      await getPublicHotelInfo({ hotels }, 'no-existe', undefined)
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(NotFoundError)
      expect(e.httpStatus).toBe(404)
    }
  })

  it('hotel existe pero onlineBookingStatus !== "active" → MISMO NotFoundError (anti-enumeración)', async () => {
    const hotels = backed<any>([hotelSeed({ onlineBookingStatus: 'paused' })])
    await expect(getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)).rejects.toThrow('Hotel not found')
    try {
      await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(NotFoundError)
      expect(e.httpStatus).toBe(404)
    }
  })

  it('ambos casos son literalmente el mismo error (mismo mensaje, mismo httpStatus)', async () => {
    const notFoundHotels = backed<any>([hotelSeed()])
    const inactiveHotels = backed<any>([hotelSeed({ onlineBookingStatus: 'inactive' })])
    let err1: unknown; let err2: unknown
    try { await getPublicHotelInfo({ hotels: notFoundHotels }, 'slug-malo', undefined) } catch (e) { err1 = e }
    try { await getPublicHotelInfo({ hotels: inactiveHotels }, 'hotel-paraiso', undefined) } catch (e) { err2 = e }
    expect(err1).toBeInstanceOf(NotFoundError)
    expect(err2).toBeInstanceOf(NotFoundError)
    expect((err1 as NotFoundError).message).toBe((err2 as NotFoundError).message)
    expect((err1 as NotFoundError).httpStatus).toBe(404)
    expect((err2 as NotFoundError).httpStatus).toBe(404)
  })

  it('slug vacío → MISMO NotFoundError', async () => {
    const hotels = backed<any>([hotelSeed()])
    try {
      await getPublicHotelInfo({ hotels }, '', undefined)
      throw new Error('should have thrown')
    } catch (e: any) {
      expect(e).toBeInstanceOf(NotFoundError)
      expect(e.httpStatus).toBe(404)
      expect(e.message).toBe('Hotel not found')
    }
  })
})

// minNights/maxNights son públicas porque el cliente las necesita para armar una consulta
// VÁLIDA antes de cotizar: la landing pide tarifas indicativas apenas carga y, sin conocer el
// mínimo, un hotel con minNights:3 recibía 400 y se quedaba sin bloque de habitaciones. Antes de
// exponerlas, el frontend deducía el número parseando el texto del mensaje de error.
describe('minNights/maxNights — límites de estadía en el DTO público', () => {
  it('sin dep `bookingConfig` (caller viejo) → null, no revienta', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.minNights).toBeNull()
    expect(dto.maxNights).toBeNull()
  })

  it('con fila de booking_config devuelve los límites del hotel', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = backed<any>([{ hotelId: 'h1', minNights: 3, maxNights: 14 }])
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.minNights).toBe(3)
    expect(dto.maxNights).toBe(14)
  })

  it('0 / null / basura = sin límite (no se inventa un mínimo de 1)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = backed<any>([{ hotelId: 'h1', minNights: 0, maxNights: null }])
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.minNights).toBeNull()
    expect(dto.maxNights).toBeNull()
  })

  it('si la lectura de la config falla, la info del hotel igual se sirve', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = { findOne: async () => { throw new Error('db caída') } } as any
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.name).toBeTruthy()
    expect(dto.minNights).toBeNull()
  })
})

// Tarea 3.4 (corrección 2026-08-25) — defaults del widget (Idioma/Moneda de "Configuración
// del Widget"). Mismo criterio y mismo fetch de `bookingConfig` que minNights/maxNights de
// arriba (ver resolveStayLimits) — cubierto acá para que quede junto a su regresión hermana.
describe('widgetDefaultLanguage/widgetDefaultCurrency — defaults del widget en el DTO público', () => {
  it('sin dep `bookingConfig` → null, no revienta', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.widgetDefaultLanguage).toBeNull()
    expect(dto.widgetDefaultCurrency).toBeNull()
  })

  it('con fila de booking_config devuelve el idioma/moneda configurados', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = backed<any>([{ hotelId: 'h1', language: 'en', currency: 'EUR' }])
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.widgetDefaultLanguage).toBe('en')
    expect(dto.widgetDefaultCurrency).toBe('EUR')
  })

  it('string vacío/whitespace = sin default (no se manda "" al frontend)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = backed<any>([{ hotelId: 'h1', language: '  ', currency: '' }])
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.widgetDefaultLanguage).toBeNull()
    expect(dto.widgetDefaultCurrency).toBeNull()
  })
})

// Tarea 3.4 (corrección 2026-08-25) — "Tema del Widget". El backend NO valida contra un enum
// de presets a propósito (ver comentario en resolveStayLimits): eso lo decide el frontend
// (ACCENT_PRESETS en booking-widget.vue), así una fila vieja con un preset renombrado/borrado
// no exige migración — el widget simplemente no encuentra match y no aplica override.
describe('widgetAccentPreset — "Tema del Widget" en el DTO público', () => {
  it('sin dep `bookingConfig` → null, no revienta', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.widgetAccentPreset).toBeNull()
  })

  it('con fila de booking_config devuelve el string tal cual (sin validar contra un enum)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = backed<any>([{ hotelId: 'h1', theme: 'gold' }])
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.widgetAccentPreset).toBe('gold')
  })

  it('string vacío/whitespace = sin default', async () => {
    const hotels = backed<any>([hotelSeed()])
    const bookingConfig = backed<any>([{ hotelId: 'h1', theme: '  ' }])
    const dto = await getPublicHotelInfo({ hotels, bookingConfig }, 'hotel-paraiso', undefined)
    expect(dto.widgetAccentPreset).toBeNull()
  })
})

describe('googleMapsApiKey — resuelto vía configuration KV con fallback a platform (2026-08-01)', () => {
  it('sin dep `config` (caller viejo) → null, no revienta', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.googleMapsApiKey).toBeNull()
  })

  it('con dep `config` pero sin fila ni para el hotel ni para platform → null', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.googleMapsApiKey).toBeNull()
  })

  it('key propia del hotel (hotelId=h1) → se usa esa, no la de platform', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'h1', key: 'google_maps', value: JSON.stringify({ apiKey: 'key-del-hotel' }) },
      { hotelId: 'platform', key: 'google_maps', value: JSON.stringify({ apiKey: 'key-de-platform' }) },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.googleMapsApiKey).toBe('key-del-hotel')
  })

  it('sin key propia del hotel → cae a la de platform (mismo fallback que hoteles/usecases/config-kv.ts)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'platform', key: 'google_maps', value: JSON.stringify({ apiKey: 'key-de-platform' }) },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.googleMapsApiKey).toBe('key-de-platform')
  })

  it('value con apiKey vacío/espacios → null (no expone un string vacío como si fuera key válida)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'platform', key: 'google_maps', value: JSON.stringify({ apiKey: '   ' }) },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.googleMapsApiKey).toBeNull()
  })

  it('value corrupto (JSON inválido) → null, no revienta el endpoint público', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'platform', key: 'google_maps', value: '{not json' },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.googleMapsApiKey).toBeNull()
  })
})

describe('childPolicy — política de niños del hotel en el DTO público (2026-09-02)', () => {
  it('sin dep `config` ni fila cargada → DEFAULT_CHILD_POLICY (acepta, todo niño consume plaza)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const dto = await getPublicHotelInfo({ hotels }, 'hotel-paraiso', undefined)
    expect(dto.childPolicy).toEqual({ acceptChildren: true, maxChildAge: 17, maxFreeAge: 0 })
  })

  it('con política configurada del hotel, se usa tal cual (ejemplo del pedido)', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'h1', key: 'child_policy', value: JSON.stringify({ acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }) },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.childPolicy).toEqual({ acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 })
  })

  it('NO cae a la política de "platform" — es una decisión de cada hotel, a diferencia de google_maps', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'platform', key: 'child_policy', value: JSON.stringify({ acceptChildren: false, maxChildAge: 5, maxFreeAge: 5 }) },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.childPolicy).toEqual({ acceptChildren: true, maxChildAge: 17, maxFreeAge: 0 })
  })

  it('acceptChildren: false → el widget no debe ofrecer agregar niños', async () => {
    const hotels = backed<any>([hotelSeed()])
    const config = backed<any>([
      { hotelId: 'h1', key: 'child_policy', value: JSON.stringify({ acceptChildren: false, maxChildAge: 17, maxFreeAge: 0 }) },
    ])
    const dto = await getPublicHotelInfo({ hotels, config }, 'hotel-paraiso', undefined)
    expect(dto.childPolicy.acceptChildren).toBe(false)
  })
})

describe('F0 0.5 — rate-limit en endpoints públicos (60/60s para getHotelPublicInfo)', () => {
  it('60 requests de la misma IP permiten, la 61ª bloquea con retryAfter > 0', async () => {
    // Clave ÚNICA por test (UUID) — el rate-limit es un Map global en memoria; sin esto,
    // el estado de tests anteriores (o paralelos) contaminaría el contador.
    const key = `public-hotel-info:${crypto.randomUUID()}`
    for (let i = 0; i < 60; i++) {
      const r = await rateLimit(key, { maxAttempts: 60, windowMs: 60_000 })
      expect(r.allowed).toBe(true)
    }
    const blocked = await rateLimit(key, { maxAttempts: 60, windowMs: 60_000 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('claves distintas tienen buckets independientes (no se contamina entre endpoints)', async () => {
    const ip = '203.0.113.7'
    const keyHotel = `public-hotel-info:${ip}-${crypto.randomUUID()}`
    const keyBooking = `public-booking-info:${ip}-${crypto.randomUUID()}`
    for (let i = 0; i < 60; i++) await rateLimit(keyHotel, { maxAttempts: 60, windowMs: 60_000 })
    expect((await rateLimit(keyHotel, { maxAttempts: 60, windowMs: 60_000 })).allowed).toBe(false)
    expect((await rateLimit(keyBooking, { maxAttempts: 60, windowMs: 60_000 })).allowed).toBe(true)
  })

  it('endpoints de escritura (booking-create/checkout) limitan a 20/60s', async () => {
    const key = `public-bookings-create:${crypto.randomUUID()}`
    for (let i = 0; i < 20; i++) {
      expect((await rateLimit(key, { maxAttempts: 20, windowMs: 60_000 })).allowed).toBe(true)
    }
    const blocked = await rateLimit(key, { maxAttempts: 20, windowMs: 60_000 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('events (tracking) limita a 120/60s', async () => {
    const key = `public-events:${crypto.randomUUID()}`
    for (let i = 0; i < 120; i++) {
      expect((await rateLimit(key, { maxAttempts: 120, windowMs: 60_000 })).allowed).toBe(true)
    }
    const blocked = await rateLimit(key, { maxAttempts: 120, windowMs: 60_000 })
    expect(blocked.allowed).toBe(false)
  })
})
