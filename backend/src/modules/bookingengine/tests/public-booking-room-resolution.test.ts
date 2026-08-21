// bookingengine/tests/public-booking-room-resolution.test.ts — FIX 2026-07-30.
//
// Bug confirmado por QA visual (Playwright): el flujo público de reserva daba 404 "Habitación
// no encontrada" en el 100% de los intentos. Root cause: `public-rates.ts` no tiene entidad
// RoomType propia — el `id` que devuelve por tipo de habitación ES el string `room.type`
// ("double"), NO un UUID de `Rooms`. El widget lo mandaba tal cual como `roomId` →
// `orm.findById('Rooms', 'double')` → siempre null → 404.
//
// Fix: `createPublicBookingDirect` ahora resuelve la habitación física en el momento de crear
// la reserva (no en la cotización) a partir de `roomType` + `hotelId` + disponibilidad para las
// fechas pedidas, minimizando la ventana de carrera. `roomId` real sigue soportado (compat).
//
// Cubre (spec del fix):
//  (a) reserva exitosa mandando SOLO `roomType` (sin `roomId`) → elige la unidad libre más
//      barata entre las del type.
//  (b) 409 cuando el type existe pero no hay unidades libres para esas fechas (overlap).
//  (c) 404 cuando el type no existe en absoluto para el hotel.
//  (d) compat: reserva exitosa mandando un `roomId` real (comportamiento viejo intacto, no pasa
//      por la resolución por tipo).
//  (e) 400 cuando no viene ni `roomId` ni `roomType`.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'

const baseBody = {
  hotelId: 'h1',
  guestName: 'Ana',
  guestEmail: 'ana@example.com',
  guestPhone: '+18095550000',
  checkIn: '2026-08-10',
  checkOut: '2026-08-12',
  adults: 2,
  children: 0,
}

/** Mock de orm con soporte real para `findMany('Rooms', {hotelId, type})` (a diferencia de los
 *  mocks de otros archivos de test, que ignoran los filtros — acá los necesitamos para probar
 *  la resolución por tipo). */
function makeOrm(opts: {
  rooms?: any[]
  reservations?: any[]
} = {}) {
  const created: any[] = []
  const rooms = opts.rooms ?? []
  const reservations = opts.reservations ?? []
  const orm: any = {
    findById: async (model: string, id: string) => {
      if (model !== 'Rooms') return null
      return rooms.find((r) => r.id === id) ?? null
    },
    findMany: async (model: string, filters?: any) => {
      if (model === 'Rooms') {
        return rooms.filter((r) =>
          (!filters?.hotelId || r.hotelId === filters.hotelId) &&
          (!filters?.type || r.type === filters.type))
      }
      if (model === 'Reservations') return reservations
      return []
    },
    create: async (model: string, payload: any) => {
      const row = { id: payload.id || crypto.randomUUID(), ...payload }
      created.push({ model, row })
      return row
    },
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
    update: async () => null,
    findOne: async () => null,
  }
  return { orm, created }
}

describe('createPublicBookingDirect — resolución de habitación por roomType (FIX 2026-07-30)', () => {
  it('(a) roomType sin roomId → elige la unidad libre más barata del tipo', async () => {
    const { orm, created } = makeOrm({
      rooms: [
        { id: 'r-expensive', hotelId: 'h1', type: 'double', basePrice: 150, status: 'available' },
        { id: 'r-cheap', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBe('r-cheap')
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.roomId).toBe('r-cheap')
  })

  it('(a2) roomType ignora habitaciones no disponibles (status != available)', async () => {
    const { orm } = makeOrm({
      rooms: [
        { id: 'r-oos', hotelId: 'h1', type: 'double', basePrice: 50, status: 'mantenimiento' },
        { id: 'r-ok', hotelId: 'h1', type: 'double', basePrice: 100, status: 'disponible' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBe('r-ok')
  })

  it('(b) 409 cuando el tipo existe pero todas las unidades están ocupadas en esas fechas', async () => {
    const { orm } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' }],
      reservations: [
        { roomId: 'r1', status: 'confirmed', checkIn: '2026-08-09', checkOut: '2026-08-11' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('No hay habitaciones de este tipo disponibles para esas fechas')
  })

  it('(b2) reservas cancelled/no_show NO cuentan como ocupación → sigue disponible', async () => {
    const { orm } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' }],
      reservations: [
        { roomId: 'r1', status: 'cancelled', checkIn: '2026-08-10', checkOut: '2026-08-12' },
        { roomId: 'r1', status: 'no_show', checkIn: '2026-08-10', checkOut: '2026-08-12' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBe('r1')
  })

  it('(c) 404 cuando el tipo no existe en absoluto para el hotel (no confundir con 409)', async () => {
    const { orm } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'suite', basePrice: 300, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Tipo de habitación no encontrado')
  })

  it('(d) compat — roomId real sigue funcionando sin pasar por la resolución por tipo', async () => {
    const { orm, created } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBe('r1')
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.roomId).toBe('r1')
  })

  it('(d2) compat — roomId real + roomType presente a la vez → gana roomId (no busca por tipo)', async () => {
    const { orm } = makeOrm({
      rooms: [
        { id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' },
        { id: 'r-other', hotelId: 'h1', type: 'double', basePrice: 10, status: 'available' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1', roomType: 'double' })
    expect(res.status).toBe(201)
    // Si hubiera caído al path de roomType, habría elegido 'r-other' (más barata).
    expect(res.body.reservation.roomId).toBe('r1')
  })

  it('(e) 400 cuando no viene ni roomId ni roomType', async () => {
    const { orm } = makeOrm()
    const res = await createPublicBookingDirect(orm, { ...baseBody })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('roomId o roomType')
  })

  // ─── Capacidad física (defensa en profundidad — la matriz de /rates ya deshabilita esto en
  // la UI, pero un POST directo no pasa por ahí, ver comentario del fix en public-booking.ts) ──
  it('(f) roomType con TODAS las unidades sin capacidad para adults+children → 409, no crea nada', async () => {
    const { orm, created } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, capacity: 2, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double', adults: 3, children: 1 })
    expect(res.status).toBe(409)
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
  })

  it('(f2) roomType con capacidad MIXTA → salta la más barata que no entra y elige la que sí', async () => {
    const { orm } = makeOrm({
      rooms: [
        { id: 'r-cheap-chica', hotelId: 'h1', type: 'familiar', basePrice: 80, capacity: 2, status: 'available' },
        { id: 'r-grande', hotelId: 'h1', type: 'familiar', basePrice: 120, capacity: 4, status: 'available' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'familiar', adults: 4, children: 0 })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBe('r-grande')
  })

  it('(f3) roomId explícito (path de compat) también respeta la capacidad — 409, no crea nada', async () => {
    const { orm, created } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, capacity: 2, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1', adults: 5, children: 0 })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('admite hasta 2')
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
  })

  it('(f4) sin `capacity` en la fila (dato viejo/incompleto) no bloquea — mismo criterio que availability.ts', async () => {
    const { orm } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double', adults: 6, children: 0 })
    expect(res.status).toBe(201)
  })
})
