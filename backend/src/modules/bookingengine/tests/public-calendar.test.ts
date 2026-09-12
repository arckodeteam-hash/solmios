// bookingengine/tests/public-calendar.test.ts
//
// GET /api/public/hotels/:slug/calendar — precio desde + disponibilidad real por día.
// Se testea a nivel usecase (el controller es delgado, igual que /rates).
//
// Casos:
//  (1) Precio con temporada: season_assignment + room_rates → price de la fila.
//  (2) Fallback: día sin temporada asignada → rooms.basePrice del tipo.
//  (3) Fallback: temporada asignada pero SIN fila en room_rates → rooms.basePrice.
//  (4) Día sin disponibilidad (todo reservado) → available 0 + closed true + fromPrice 0.
//  (5) Día con room_block → resta una unidad (el motor público hoy ignora los bloqueos).
//  (6) Rango inválido / excesivo / formato malo → 400.
//  (7) Anti-enumeración: hotel inexistente o no activo → 404. booking_config.enabled=false → 404.
//  (8) Stop-sell: room_rates.closed=1 → el tipo no suma unidades ni compite por el fromPrice.
//  (9) minStay de la tarifa que da el fromPrice.
// (10) Whitelist de estados: 'cancelled'/'no_show' NO ocupan (criterio del motor público).
// (11) Override de canal (channel='airbnb') NO se filtra al calendario directo.
// (12) guests filtra por capacidad + elige la ocupación correcta (per_person).
// (13) Conversión de moneda con currency_rates; sin rates degrada a la moneda del hotel.
import { describe, it, expect } from 'bun:test'
import { getPublicCalendar, MAX_CALENDAR_DAYS, pickRate, ratePrice } from '../usecases/public-calendar'

const repo = (rows: any[]) => ({
  findMany: async (_f?: any) => rows,
  findOne: async (_f?: any) => rows[0] ?? null,
}) as any

const hotelsRepo = (hotel: any) => ({ findOne: async () => hotel }) as any

const baseHotel = (overrides: Partial<any> = {}): any => ({
  id: 'h1', name: 'Caribe Paradise', slug: 'caribe-paradise',
  onlineBookingStatus: 'active', currency: 'USD',
  ...overrides,
})

interface DepsOverrides {
  hotel?: any | null
  rooms?: any[]
  reservations?: any[]
  blocks?: any[]
  assignments?: any[]
  rates?: any[]
  config?: any
  bookingConfig?: any | null
}

const makeDeps = (o: DepsOverrides = {}) => ({
  hotels: hotelsRepo(o.hotel === undefined ? baseHotel() : o.hotel),
  rooms: repo(o.rooms ?? [{ id: 'r1', hotelId: 'h1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' }]),
  reservations: repo(o.reservations ?? []),
  roomBlocks: repo(o.blocks ?? []),
  seasonAssignments: repo(o.assignments ?? []),
  roomRates: repo(o.rates ?? []),
  config: o.config ?? { findMany: async () => [] },
  bookingConfig: o.bookingConfig === undefined ? undefined : ({ findOne: async () => o.bookingConfig } as any),
}) as any

describe('getPublicCalendar — precio por día', () => {
  it('(1) usa la tarifa de la temporada asignada a esa fecha', async () => {
    const deps = makeDeps({
      assignments: [
        { hotelId: 'h1', date: '2026-09-01', season: 'alta' },
        { hotelId: 'h1', date: '2026-09-02', season: 'alta' },
      ],
      rates: [
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', basePrice: 100, percentage: 20, price: 120, closed: 0, minStay: 0 },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02' })

    expect(res.status).toBe(200)
    expect(res.body.days).toHaveLength(2)
    // fromPrice = precio de ESA noche (no total de estadía).
    expect(res.body.days[0]).toEqual({ date: '2026-09-01', fromPrice: 120, available: 1, closed: false })
    expect(res.body.days[1].fromPrice).toBe(120)
    expect(res.body.currency).toBe('USD')
    expect(res.body.chargeCurrency).toBe('USD')
    expect(res.body.guests).toBe(2)
  })

  it('(2) sin season_assignment para esa fecha → fallback a rooms.basePrice', async () => {
    const deps = makeDeps({
      // Temporada solo el día 1; el día 2 queda sin asignar.
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'alta' }],
      rates: [{ hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', basePrice: 100, percentage: 0, price: 100, closed: 0 }],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02' })

    expect(res.body.days[0].fromPrice).toBe(100)  // tarifa de temporada
    expect(res.body.days[1].fromPrice).toBe(80)   // rooms.basePrice
    expect(res.body.days[1].closed).toBe(false)
  })

  it('(3) temporada asignada pero sin fila en room_rates → fallback a rooms.basePrice', async () => {
    const deps = makeDeps({
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'especial' }],
      rates: [{ hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', price: 300, closed: 0 }],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0].fromPrice).toBe(80)
  })

  it('toma el MENOR precio entre los tipos vendibles', async () => {
    const deps = makeDeps({
      rooms: [
        { id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r2', type: 'suite', capacity: 2, basePrice: 200, status: 'available' },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0].fromPrice).toBe(80)
    expect(res.body.days[0].available).toBe(2)
  })
})

describe('getPublicCalendar — disponibilidad', () => {
  it('(4) día totalmente reservado → available 0, closed true, fromPrice 0', async () => {
    const deps = makeDeps({
      reservations: [
        { id: 'res1', roomId: 'r1', status: 'confirmed', checkIn: '2026-09-01', checkOut: '2026-09-02' },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02' })

    // La noche del 1 está ocupada; el día de checkout (2) queda libre (turnover).
    expect(res.body.days[0]).toEqual({ date: '2026-09-01', fromPrice: 0, available: 0, closed: true })
    expect(res.body.days[1]).toEqual({ date: '2026-09-02', fromPrice: 80, available: 1, closed: false })
  })

  it('(5) room_block resta disponibilidad (inclusive en ambos extremos)', async () => {
    const deps = makeDeps({
      rooms: [
        { id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r2', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
      blocks: [{ id: 'b1', roomId: 'r1', startDate: '2026-09-02', endDate: '2026-09-03', reason: 'mantenimiento' }],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-04' })

    expect(res.body.days.map((d: any) => d.available)).toEqual([2, 1, 1, 2])
  })

  it('(10) whitelist del motor público: cancelled y no_show NO ocupan', async () => {
    const deps = makeDeps({
      rooms: [{ id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' }],
      reservations: [
        { id: 'res1', roomId: 'r1', status: 'cancelled', checkIn: '2026-09-01', checkOut: '2026-09-02' },
        { id: 'res2', roomId: 'r1', status: 'no_show', checkIn: '2026-09-01', checkOut: '2026-09-02' },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    // Con el criterio laxo de canales (!== 'cancelled') el no_show restaría y daría 0.
    expect(res.body.days[0].available).toBe(1)
  })

  // HAC-02 (#257/#258): una `confirmed` sin unidad (vende sólo `roomType`) resta una del tipo
  // en sus noches. Antes `groupReservationsByRoom` la saltaba y el calendario mostraba libre lo vendido.
  it('(14) reserva confirmada SIN habitación de tipo standard baja la disponibilidad de standard en 1', async () => {
    const deps = makeDeps({
      rooms: [
        { id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r2', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r3', type: 'suite', capacity: 2, basePrice: 200, status: 'available' },
      ],
      reservations: [
        { id: 'res1', roomId: null, roomType: 'Standard', status: 'confirmed', checkIn: '2026-09-02', checkOut: '2026-09-03' },
        // Sin unidad y cancelada / sin roomType: no descuentan.
        { id: 'res2', roomId: null, roomType: 'standard', status: 'cancelled', checkIn: '2026-09-01', checkOut: '2026-09-04' },
        { id: 'res3', roomId: null, roomType: null, status: 'confirmed', checkIn: '2026-09-01', checkOut: '2026-09-04' },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-03' })
    // 3 unidades (2 standard + 1 suite); el 02 hay una standard vendida sin unidad → 2.
    expect(res.body.days.map((d: any) => d.available)).toEqual([3, 2, 3])
  })

  it('pending y guaranteed SÍ ocupan (whitelist completa)', async () => {
    for (const status of ['confirmed', 'checked_in', 'pending', 'guaranteed']) {
      const deps = makeDeps({
        reservations: [{ id: 'x', roomId: 'r1', status, checkIn: '2026-09-01', checkOut: '2026-09-02' }],
      })
      const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
      expect(res.body.days[0].available).toBe(0)
    }
  })

  it('habitaciones no vendibles (out_of_order/maintenance) no cuentan', async () => {
    const deps = makeDeps({
      rooms: [
        { id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'out_of_order' },
        { id: 'r2', type: 'standard', capacity: 2, basePrice: 80, status: 'maintenance' },
        { id: 'r3', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0].available).toBe(1)
  })
})

describe('getPublicCalendar — stop-sell y restricciones', () => {
  it('(8) room_rates.closed=1 → el tipo no se vende ese día', async () => {
    const deps = makeDeps({
      rooms: [
        { id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r2', type: 'suite', capacity: 2, basePrice: 200, status: 'available' },
      ],
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'alta' }],
      rates: [
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', price: 100, closed: 1 },
        { hotelId: 'h1', roomType: 'suite', occupancy: 2, season: 'alta', channel: '', price: 250, closed: 0 },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    // standard cerrado: ni suma unidad ni compite por el fromPrice.
    expect(res.body.days[0].available).toBe(1)
    expect(res.body.days[0].fromPrice).toBe(250)
    expect(res.body.days[0].closed).toBe(false)
  })

  // Hotel recién dado de alta: cargó habitaciones pero todavía no les puso precio (basePrice es
  // required con min:0, así que 0 es un valor válido y real). Antes, la falta de precio cerraba
  // el día: el mes entero salía "Lleno", ninguna celda era clickeable y no se podía ni empezar
  // una reserva. `closed` describe DISPONIBILIDAD, no si supimos derivar una tarifa.
  it('hotel sin precio derivable → fromPrice 0 pero el día NO se cierra', async () => {
    const deps = makeDeps({
      rooms: [{ id: 'r1', type: 'standard', capacity: 2, basePrice: 0, status: 'available' }],
      assignments: [],
      rates: [],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0]).toEqual({ date: '2026-09-01', fromPrice: 0, available: 1, closed: false })
  })

  it('todos los tipos cerrados → closed true', async () => {
    const deps = makeDeps({
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'alta' }],
      rates: [{ hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', price: 100, closed: 1 }],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0]).toEqual({ date: '2026-09-01', fromPrice: 0, available: 0, closed: true })
  })

  it('(9) minStay viaja solo si la tarifa del fromPrice lo impone (> 1)', async () => {
    const deps = makeDeps({
      assignments: [
        { hotelId: 'h1', date: '2026-09-01', season: 'alta' },
        { hotelId: 'h1', date: '2026-09-02', season: 'baja' },
      ],
      rates: [
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', price: 100, closed: 0, minStay: 3 },
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'baja', channel: '', price: 60, closed: 0, minStay: 0 },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02' })
    expect(res.body.days[0].minStay).toBe(3)
    expect(res.body.days[1].minStay).toBeUndefined()
  })

  it('(11) el override de canal (airbnb) no se filtra al calendario directo', async () => {
    const deps = makeDeps({
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'alta' }],
      rates: [
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: 'airbnb', price: 500, closed: 0 },
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', price: 100, closed: 0 },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0].fromPrice).toBe(100)
  })

  it('un stop-sell SOLO del canal airbnb no cierra el directo', async () => {
    const deps = makeDeps({
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'alta' }],
      rates: [
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: 'airbnb', price: 500, closed: 1 },
        { hotelId: 'h1', roomType: 'standard', occupancy: 2, season: 'alta', channel: '', price: 100, closed: 0 },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(res.body.days[0].closed).toBe(false)
    expect(res.body.days[0].fromPrice).toBe(100)
  })
})

describe('getPublicCalendar — guests', () => {
  it('(12) descarta tipos que no entran el grupo y elige la ocupación pedida', async () => {
    const deps = makeDeps({
      rooms: [
        { id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' },
        { id: 'r2', type: 'family', capacity: 4, basePrice: 150, status: 'available' },
      ],
      assignments: [{ hotelId: 'h1', date: '2026-09-01', season: 'alta' }],
      rates: [
        { hotelId: 'h1', roomType: 'family', occupancy: 2, season: 'alta', channel: '', price: 150, closed: 0 },
        { hotelId: 'h1', roomType: 'family', occupancy: 4, season: 'alta', channel: '', price: 260, closed: 0 },
      ],
    })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01', guests: 4 })
    // standard (capacity 2) queda fuera; family con occupancy=4 es la fila exacta.
    expect(res.body.days[0].available).toBe(1)
    expect(res.body.days[0].fromPrice).toBe(260)
    expect(res.body.guests).toBe(4)
  })
})

describe('getPublicCalendar — validación y anti-enumeración', () => {
  it('(6) from/to faltantes → 400', async () => {
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from: '', to: '' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('requeridos')
  })

  it('(6) formato inválido → 400', async () => {
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from: '01/09/2026', to: '2026-09-02' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('YYYY-MM-DD')
  })

  it('(6) to anterior a from → 400', async () => {
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from: '2026-09-10', to: '2026-09-01' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('posterior')
  })

  it('(6) rango mayor al máximo → 400 con el límite en el mensaje', async () => {
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from: '2026-01-01', to: '2026-12-31' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain(String(MAX_CALENDAR_DAYS))
  })

  it('(6) exactamente MAX_CALENDAR_DAYS días es válido', async () => {
    const from = '2026-09-01'
    const to = new Date(Date.parse(`${from}T00:00:00Z`) + (MAX_CALENDAR_DAYS - 1) * 86_400_000).toISOString().slice(0, 10)
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from, to })
    expect(res.status).toBe(200)
    expect(res.body.days).toHaveLength(MAX_CALENDAR_DAYS)
  })

  it('(6) guests inválido → 400', async () => {
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02', guests: 0 })
    expect(res.status).toBe(400)
  })

  it('(7) hotel inexistente → 404', async () => {
    const res = await getPublicCalendar(makeDeps({ hotel: null }), 'no-existe', { from: '2026-09-01', to: '2026-09-02' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Hotel not found')
  })

  it('(7) hotel no activo → MISMO 404 (anti-enumeración)', async () => {
    const deps = makeDeps({ hotel: baseHotel({ onlineBookingStatus: 'paused' }) })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Hotel not found')
  })

  it('(7) booking_config.enabled=false → 404', async () => {
    const deps = makeDeps({ bookingConfig: { hotelId: 'h1', enabled: false } })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-02' })
    expect(res.status).toBe(404)
  })

  it('slug vacío → 404 sin tocar la DB', async () => {
    const res = await getPublicCalendar(makeDeps(), '', { from: '2026-09-01', to: '2026-09-02' })
    expect(res.status).toBe(404)
  })
})

describe('getPublicCalendar — moneda', () => {
  const ratesConfig = {
    findMany: async (f: any) => f?.key === 'currency_rates'
      ? [{ value: { base: 'USD', rates: { USD: 1, DOP: 60 } } }]
      : [],
  }

  it('(13) convierte con currency_rates', async () => {
    const deps = makeDeps({ config: ratesConfig })
    const res = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01', currency: 'DOP' })
    expect(res.body.currency).toBe('DOP')
    expect(res.body.chargeCurrency).toBe('USD')
    expect(res.body.days[0].fromPrice).toBe(4800) // 80 USD × 60
  })

  it('(13) sin currency_rates degrada a la moneda del hotel', async () => {
    const res = await getPublicCalendar(makeDeps(), 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01', currency: 'DOP' })
    expect(res.body.currency).toBe('USD')
    expect(res.body.days[0].fromPrice).toBe(80)
  })
})

describe('getPublicCalendar — cache', () => {
  it('sirve del cache en la segunda llamada (no re-lee la DB)', async () => {
    const store = new Map<string, any>()
    let reads = 0
    const deps = makeDeps()
    const countingRooms = { findMany: async () => { reads++; return [{ id: 'r1', type: 'standard', capacity: 2, basePrice: 80, status: 'available' }] } }
    deps.rooms = countingRooms
    deps.cache = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: any) => { store.set(k, v) },
      delete: async () => {},
      flush: async () => {},
    }

    const a = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    const b = await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    expect(a.body).toEqual(b.body)
    expect(reads).toBe(1)
  })

  it('la clave del cache separa por guests y por moneda', async () => {
    const store = new Map<string, any>()
    const deps = makeDeps()
    deps.cache = {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: any) => { store.set(k, v) },
      delete: async () => {}, flush: async () => {},
    }
    await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01' })
    await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01', guests: 1 })
    await getPublicCalendar(deps, 'caribe-paradise', { from: '2026-09-01', to: '2026-09-01', currency: 'DOP' })
    expect(store.size).toBe(3)
    expect([...store.keys()].every((k) => k.startsWith('rate-calendar:h1:'))).toBe(true)
  })
})

describe('helpers puros', () => {
  const rates = [
    { roomType: 'standard', season: 'alta', occupancy: 1, channel: '', price: 70 },
    { roomType: 'standard', season: 'alta', occupancy: 2, channel: '', price: 100 },
    { roomType: 'standard', season: 'alta', occupancy: 4, channel: '', price: 160 },
  ]

  it('pickRate: sin temporada → null (el caller cae al basePrice)', () => {
    expect(pickRate(rates, 'standard', null, 2)).toBeNull()
  })

  it('pickRate: ocupación exacta gana', () => {
    expect(pickRate(rates, 'standard', 'alta', 2)?.price).toBe(100)
  })

  it('pickRate: sin exacta, la menor que cubre al grupo', () => {
    expect(pickRate(rates, 'standard', 'alta', 3)?.price).toBe(160)
  })

  it('pickRate: si ninguna cubre, la mayor disponible', () => {
    expect(pickRate(rates, 'standard', 'alta', 8)?.price).toBe(160)
  })

  it('pickRate: tipo sin tarifas → null', () => {
    expect(pickRate(rates, 'suite', 'alta', 2)).toBeNull()
  })

  it('ratePrice: usa price; si viene 0 recompone basePrice × (1 + percentage/100)', () => {
    expect(ratePrice({ price: 120, basePrice: 100, percentage: 20 })).toBe(120)
    expect(ratePrice({ price: 0, basePrice: 100, percentage: 20 })).toBe(120)
    expect(ratePrice({ price: 0, basePrice: 0, percentage: 20 })).toBe(0)
  })
})
