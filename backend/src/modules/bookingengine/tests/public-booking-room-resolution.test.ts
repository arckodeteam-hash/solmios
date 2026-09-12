// bookingengine/tests/public-booking-room-resolution.test.ts — REQ-HAC-05 (#260).
//
// Antecedente (FIX 2026-07-30): `public-rates.ts` no tiene entidad RoomType propia — el `id` que
// publica por tipo ES el string `room.type` ("double"), y el widget lo mandaba como `roomId` →
// 404 siempre. Desde entonces el guest elige un TIPO. Hasta HAC-05 el backend elegía además la
// unidad física al crear; ahora NO: la reserva del widget nace POR TIPO, con `roomType` y
// `roomId: null`, y la unidad la asigna recepción (`reservas/usecases/assign-room.ts`). La venta
// la decide SOLO `availableOfType` (rooms − booked por noche, contando reservas asignadas o sin
// asignar y bloqueos).
//
// Cubre:
//  (a) alta mandando SOLO `roomType` → 201, fila con `roomId === null` y `roomType`; respuesta
//      con `roomType` y `roomId` null.
//  (a2) unidades no vendibles (mantenimiento) no cuentan como inventario del tipo.
//  (b) N unidades del tipo con N reservas activas (asignadas o sin asignar) → 409; N−1 → 201.
//  (b2) reservas cancelled/no_show NO consumen inventario.
//  (c) compat: `roomId` real → 201, fila con `roomType = room.type` y `roomId` null (la unidad
//      pedida NO se asigna); `roomId` de otro hotel → assertOwnership.
//  (d) tipo inexistente en el hotel → 404 (no confundir con 409); sin `roomId` resoluble ni
//      `roomType` → 404 "Habitación no encontrada".
//  (e) 400 cuando no viene ni `roomId` ni `roomType`.
//  (f) capacidad contra el PERFIL del tipo (la mayor unidad vendible): no entra → 409; entra en
//      alguna → 201 sin unidad; sin `capacity` en la fila no bloquea.
//  (g) precio: fallback = MÍNIMO `basePrice` entre las unidades vendibles del tipo.
//  (h) carrera: el re-chequeo por tipo dentro de la tx rebota con 409 si el tipo se agotó.
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

const OVERSOLD = 'No hay habitaciones de este tipo disponibles para esas fechas'

/** Mock de orm con soporte real para `findMany('Rooms', {hotelId, type})` (a diferencia de los
 *  mocks de otros archivos de test, que ignoran los filtros — acá los necesitamos para probar
 *  la venta por tipo). `Reservations` acumula lo creado para que el re-chequeo de la tx lo vea. */
function makeOrm(opts: {
  rooms?: any[]
  reservations?: any[]
  blocks?: any[]
} = {}) {
  const created: any[] = []
  const rooms = opts.rooms ?? []
  const reservations = [...(opts.reservations ?? [])]
  const lockCalls: Array<{ model: string; filter: any }> = []
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
      if (model === 'RoomBlocks') return opts.blocks ?? []
      return []
    },
    create: async (model: string, payload: any) => {
      const row = { id: payload.id || crypto.randomUUID(), ...payload }
      created.push({ model, row })
      if (model === 'Reservations') reservations.push(row)
      return row
    },
    updateMany: async (model: string, filter: any) => {
      lockCalls.push({ model, filter })
      return model === 'Rooms' ? rooms.filter((r) => r.hotelId === filter.hotelId && r.type === filter.type).length : 0
    },
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
    update: async () => null,
    findOne: async () => null,
  }
  return { orm, created, reservations, lockCalls }
}

const double = (id: string, extra: any = {}) => ({ id, hotelId: 'h1', type: 'double', basePrice: 100, status: 'available', ...extra })
const active = (over: any = {}) => ({ id: crypto.randomUUID(), hotelId: 'h1', roomType: 'double', roomId: null, status: 'confirmed', checkIn: '2026-08-09', checkOut: '2026-08-11', ...over })

describe('createPublicBookingDirect — alta por TIPO sin unidad (REQ-HAC-05 #260)', () => {
  it('(a) roomType sin roomId → 201, fila con roomId null y roomType; la respuesta trae roomType', async () => {
    const { orm, created, lockCalls } = makeOrm({
      rooms: [double('r-expensive', { basePrice: 150 }), double('r-cheap')],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('double')
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.roomId).toBeNull()
    expect(reservationCreate.row.roomType).toBe('double')
    // El lock de la tx es sobre las unidades del TIPO, no sobre una unidad (el de `Hotels` es del
    // helper de huéspedes, MR-08).
    expect(lockCalls.filter((l) => l.model === 'Rooms')).toEqual([{ model: 'Rooms', filter: { hotelId: 'h1', type: 'double' } }])
  })

  it('(a2) unidades no vendibles (status != available) no cuentan como inventario del tipo', async () => {
    const { orm } = makeOrm({
      rooms: [double('r-oos', { basePrice: 50, status: 'mantenimiento' }), double('r-ok', { status: 'disponible' })],
      reservations: [active()],
    })
    // 1 vendible + 1 activa sin asignar → agotado, aunque la de mantenimiento "exista".
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
  })

  it('(b) N unidades con N reservas activas (asignadas o sin asignar) → 409; N−1 → 201', async () => {
    const rooms = [double('r1'), double('r2'), double('r3')]
    const full = makeOrm({
      rooms,
      reservations: [active({ roomId: 'r1' }), active(), active({ status: 'pending' })],
    })
    const res = await createPublicBookingDirect(full.orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
    expect(full.created.find((c) => c.model === 'Reservations')).toBeUndefined()

    const oneLeft = makeOrm({ rooms, reservations: [active({ roomId: 'r1' }), active()] })
    const ok = await createPublicBookingDirect(oneLeft.orm, { ...baseBody, roomType: 'double' })
    expect(ok.status).toBe(201)
    expect(ok.body.reservation.roomId).toBeNull()
  })

  it('(b2) reservas cancelled/no_show NO cuentan como ocupación → sigue disponible', async () => {
    const { orm } = makeOrm({
      rooms: [double('r1')],
      reservations: [
        active({ roomId: 'r1', status: 'cancelled', checkIn: '2026-08-10', checkOut: '2026-08-12' }),
        active({ status: 'no_show', checkIn: '2026-08-10', checkOut: '2026-08-12' }),
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
  })

  it('(b3) un bloqueo (room_blocks) descuenta una unidad del tipo', async () => {
    const { orm } = makeOrm({
      rooms: [double('r1')],
      blocks: [{ id: 'b1', hotelId: 'h1', roomId: 'r1', startDate: '2026-08-11', endDate: '2026-08-11' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
  })

  it('(c) compat — roomId real → 201, fila con roomType = room.type y roomId null (la unidad NO se asigna)', async () => {
    const { orm, created } = makeOrm({ rooms: [double('r1'), double('r-other', { basePrice: 10 })] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('double')
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate.row.roomId).toBeNull()
    expect(reservationCreate.row.roomType).toBe('double')
  })

  it('(c2) compat — roomId real + roomType distinto a la vez → manda el tipo de la unidad real', async () => {
    const { orm, created } = makeOrm({
      rooms: [double('r1'), { id: 's1', hotelId: 'h1', type: 'suite', basePrice: 300, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 's1', roomType: 'double' })
    expect(res.status).toBe(201)
    expect(created.find((c) => c.model === 'Reservations').row.roomType).toBe('suite')
  })

  it('(c3) compat — roomId real con el tipo agotado → 409 (no se saltea la venta por tipo mandando el id físico)', async () => {
    const { orm } = makeOrm({ rooms: [double('r1')], reservations: [active()] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
  })

  it('(c4) compat — roomId real pasa por assertOwnership contra el hotel del body', async () => {
    const { orm } = makeOrm({ rooms: [double('r1', { hotelId: 'h-otro' })] })
    const calls: any[] = []
    const auth = { assertOwnership: (a: any, b: any) => { calls.push([a, b]); if (a !== b) throw new Error('forbidden') } }
    await expect(createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1' }, undefined, auth)).rejects.toThrow('forbidden')
    expect(calls).toEqual([['h-otro', 'h1']])
  })

  it('(d) 404 cuando el tipo no existe en absoluto para el hotel (no confundir con 409)', async () => {
    const { orm } = makeOrm({
      rooms: [{ id: 'r1', hotelId: 'h1', type: 'suite', basePrice: 300, status: 'available' }],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Tipo de habitación no encontrado')
  })

  it('(d2) roomId que no resuelve y sin roomType → 404 "Habitación no encontrada" (como antes)', async () => {
    const { orm } = makeOrm({ rooms: [double('r1')] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'no-existe' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Habitación no encontrada')
  })

  it('(d3) roomId que no resuelve pero roomType válido → se vende por tipo (el `id` de /rates es el type)', async () => {
    const { orm } = makeOrm({ rooms: [double('r1')] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'double', roomType: 'double' })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomType).toBe('double')
  })

  it('(e) 400 cuando no viene ni roomId ni roomType', async () => {
    const { orm } = makeOrm()
    const res = await createPublicBookingDirect(orm, { ...baseBody })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('roomId o roomType')
  })

  // ─── Capacidad contra el PERFIL del tipo (la mayor unidad vendible) ────────────────────────
  it('(f) ninguna unidad del tipo admite adults+children → 409, no crea nada', async () => {
    const { orm, created } = makeOrm({ rooms: [double('r1', { capacity: 2 })] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double', adults: 3, children: 1 })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('admite hasta 2')
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
  })

  it('(f2) capacidad MIXTA: entra en la unidad grande del tipo → 201 sin unidad (recepción elige cuál)', async () => {
    const { orm } = makeOrm({
      rooms: [
        { id: 'r-cheap-chica', hotelId: 'h1', type: 'familiar', basePrice: 80, capacity: 2, status: 'available' },
        { id: 'r-grande', hotelId: 'h1', type: 'familiar', basePrice: 120, capacity: 4, status: 'available' },
      ],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'familiar', adults: 4, children: 0 })
    expect(res.status).toBe(201)
    expect(res.body.reservation.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('familiar')
  })

  it('(f3) roomId explícito (compat) también respeta la capacidad del tipo — 409, no crea nada', async () => {
    const { orm, created } = makeOrm({ rooms: [double('r1', { capacity: 2 })] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomId: 'r1', adults: 5, children: 0 })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('admite hasta 2')
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
  })

  it('(f4) sin `capacity` en la fila (dato viejo/incompleto) no bloquea — mismo criterio que availability.ts', async () => {
    const { orm } = makeOrm({ rooms: [double('r1')] })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double', adults: 6, children: 0 })
    expect(res.status).toBe(201)
  })

  // ─── Precio ────────────────────────────────────────────────────────────────────────────────
  it('(g) el fallback nightly es el MÍNIMO basePrice entre las unidades vendibles del tipo (lo que publica /rates)', async () => {
    const { orm, created } = makeOrm({
      rooms: [double('r-expensive', { basePrice: 150 }), double('r-cheap', { basePrice: 100 }), double('r-oos', { basePrice: 10, status: 'mantenimiento' })],
    })
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(201)
    // 2 noches × 100 (la de 10 está fuera de servicio: no es vendible).
    expect(res.body.totalBreakdown.subtotal).toBe(200)
    expect(created.find((c) => c.model === 'Reservations').row.totalAmount).toBe(200)
  })

  // ─── Carrera: re-chequeo por tipo dentro de la tx ──────────────────────────────────────────
  it('(h) el tipo se agota entre el chequeo de afuera y la tx → 409 y no se crea la fila', async () => {
    const { orm, created } = makeOrm({ rooms: [double('r1')] })
    const outer = orm.findMany
    let outerChecks = 0
    orm.findMany = async (model: string, filters?: any) => {
      const rows = await outer(model, filters)
      // Después de la primera lectura por tipo (afuera de la tx), "alguien" vende la última unidad.
      if (model === 'Reservations' && filters?.roomType === 'double' && outerChecks++ === 0) {
        rows.push(active())
        return rows.slice(0, -1)
      }
      return rows
    }
    const res = await createPublicBookingDirect(orm, { ...baseBody, roomType: 'double' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe(OVERSOLD)
    expect(created.find((c) => c.model === 'Reservations')).toBeUndefined()
  })
})
