// bookingengine/tests/public-room-types.test.ts
//
// Cubre GET /api/public/hotels/:slug/room-types — catálogo de tipos de habitación SIN filtrar
// por disponibilidad. Regresión ancla del bug real (2026-08-20): la vitrina "Habitaciones" de la
// landing reusaba `/rates` con una ventana de fechas indicativa, y un tipo reservado justo esos
// días desaparecía ENTERO de la web pública. Este usecase no mira reservas en absoluto — agrupa
// directo `Rooms` por `type`.
import { describe, it, expect } from 'bun:test'
import { getPublicRoomTypes } from '../usecases/public-room-types'

const activeHotel = { id: 'h1', slug: 'caribe', onlineBookingStatus: 'active' }

const repo = (rows: any[]) => ({
  findMany: async (_f?: any) => rows,
  findOne: async (_f?: any) => rows[0] ?? null,
}) as any

const makeDeps = (hotel: any, rooms: any[], opts: { hotelMedia?: any[]; bookingConfig?: any } = {}) => ({
  hotels: { findOne: async () => hotel } as any,
  rooms: repo(rooms),
  hotelMedia: opts.hotelMedia ? repo(opts.hotelMedia) : undefined,
  bookingConfig: opts.bookingConfig !== undefined ? { findOne: async () => opts.bookingConfig } as any : undefined,
})

describe('getPublicRoomTypes — catálogo sin filtrar por disponibilidad', () => {
  it('REGRESIÓN — un tipo 100% reservado/ocupado igual aparece en el catálogo', async () => {
    // El usecase NO recibe reservas ni fechas: agrupa Rooms tal cual, sin importar su estado
    // operacional actual. Esto es justamente lo que /rates no puede garantizar (necesita un
    // rango de fechas y excluye correctamente lo sin stock continuo PARA ESE rango).
    const rooms = [
      { id: 'r1', hotelId: 'h1', type: 'suite', capacity: 2, surfaceArea: 35, basePrice: 200, status: 'occupied' },
    ]
    const res = await getPublicRoomTypes(makeDeps(activeHotel, rooms) as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body.roomTypes.map((t: any) => t.id)).toEqual(['suite'])
    expect(res.body.roomTypes[0]).toMatchObject({ id: 'suite', name: 'suite', capacity: 2, surfaceArea: 35, basePrice: 200 })
  })

  it('agrupa por tipo: capacidad/superficie MÁXIMA, precio MÍNIMO entre las unidades', async () => {
    const rooms = [
      { id: 'r1', hotelId: 'h1', type: 'double', capacity: 2, surfaceArea: 20, basePrice: 90, status: 'available' },
      { id: 'r2', hotelId: 'h1', type: 'double', capacity: 3, surfaceArea: 25, basePrice: 80, status: 'available' },
    ]
    const res = await getPublicRoomTypes(makeDeps(activeHotel, rooms) as any, 'caribe')
    expect(res.body.roomTypes[0]).toMatchObject({ capacity: 3, surfaceArea: 25, basePrice: 80 })
  })

  it('unidad de mantenimiento/fuera de servicio TAMBIÉN cuenta para el catálogo (el tipo existe)', async () => {
    const rooms = [
      { id: 'r1', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: 200, status: 'out_of_order' },
    ]
    const res = await getPublicRoomTypes(makeDeps(activeHotel, rooms) as any, 'caribe')
    expect(res.body.roomTypes.map((t: any) => t.id)).toEqual(['suite'])
  })

  it('resuelve photoUrl vía HotelMedia (mismo criterio que /rates)', async () => {
    const rooms = [{ id: 'r1', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: 200, status: 'available' }]
    const media = [{ hotelId: 'h1', type: 'room', roomId: 'r1', url: 'https://cdn/suite.jpg', sortOrder: 0 }]
    const res = await getPublicRoomTypes(makeDeps(activeHotel, rooms, { hotelMedia: media }) as any, 'caribe')
    expect(res.body.roomTypes[0].photoUrl).toBe('https://cdn/suite.jpg')
  })

  it('sin HotelMedia cableado, photoUrl es null (degradación graceful)', async () => {
    const rooms = [{ id: 'r1', hotelId: 'h1', type: 'suite', capacity: 2, basePrice: 200, status: 'available' }]
    const res = await getPublicRoomTypes(makeDeps(activeHotel, rooms) as any, 'caribe')
    expect(res.body.roomTypes[0].photoUrl).toBeNull()
  })

  it('hotel inexistente → 404', async () => {
    const res = await getPublicRoomTypes(makeDeps(null, []) as any, 'no-existe')
    expect(res.status).toBe(404)
  })

  it('hotel pausado → MISMO 404 (anti-enumeración)', async () => {
    const res = await getPublicRoomTypes(
      makeDeps({ ...activeHotel, onlineBookingStatus: 'paused' }, []) as any, 'caribe',
    )
    expect(res.status).toBe(404)
  })

  it('booking_config.enabled=false → 404 (motor apagado por el admin)', async () => {
    const res = await getPublicRoomTypes(
      makeDeps(activeHotel, [{ id: 'r1', hotelId: 'h1', type: 'suite' }], { bookingConfig: { hotelId: 'h1', enabled: false } }) as any,
      'caribe',
    )
    expect(res.status).toBe(404)
  })

  it('hotel sin habitaciones cargadas → array vacío (200, no 404)', async () => {
    const res = await getPublicRoomTypes(makeDeps(activeHotel, []) as any, 'caribe')
    expect(res.status).toBe(200)
    expect(res.body.roomTypes).toEqual([])
  })

  it('slug vacío → 404', async () => {
    const res = await getPublicRoomTypes(makeDeps(activeHotel, []) as any, '')
    expect(res.status).toBe(404)
  })
})
