import { describe, it, expect } from 'bun:test'
import { computeAvailabilityRanges, buildAvailabilityRanges } from '../usecases/availability'
import { applyBookingRevision } from '../usecases/booking-ingestion'

// QA-02 (#296): flujo de canales — push de ARI (disponibilidad) a Channex + ingesta de bookings OTA.

describe('push ARI — computeAvailabilityRanges (QA-02)', () => {
  it('disponibilidad = total − ocupadas por día y agrupa días consecutivos iguales', () => {
    // 2 habitaciones; una reserva ocupa 02 y 03 (checkOut exclusivo).
    const ranges = computeAvailabilityRanges('2026-06-01', '2026-06-05', 2,
      [{ checkIn: '2026-06-02', checkOut: '2026-06-04' }], [])
    expect(ranges).toEqual([
      { dateFrom: '2026-06-01', dateTo: '2026-06-01', availability: 2 },
      { dateFrom: '2026-06-02', dateTo: '2026-06-03', availability: 1 },
      { dateFrom: '2026-06-04', dateTo: '2026-06-04', availability: 2 },
    ])
  })

  it('un bloqueo (endDate inclusivo) también resta disponibilidad', () => {
    const ranges = computeAvailabilityRanges('2026-06-01', '2026-06-03', 1, [],
      [{ startDate: '2026-06-01', endDate: '2026-06-01' }])
    expect(ranges[0]).toEqual({ dateFrom: '2026-06-01', dateTo: '2026-06-01', availability: 0 })
    expect(ranges[1].availability).toBe(1)
  })
})

describe('push ARI — buildAvailabilityRanges (QA-02)', () => {
  const rooms = [{ id: 'r1', type: 'suite' }, { id: 'r2', type: 'suite' }, { id: 'r3', type: 'double' }]
  it('devuelve rangos para el tipo pedido (excluye reservas canceladas)', () => {
    const res = buildAvailabilityRanges('suite', rooms, [], [])
    expect(res).not.toBeNull()
    expect(Array.isArray(res)).toBe(true)
  })
  it('devuelve null si el hotel no tiene habitaciones de ese tipo (nada que empujar)', () => {
    expect(buildAvailabilityRanges('triple', rooms, [], [])).toBeNull()
  })
})

const noopCancel = async () => ({ ok: true })

describe('ingesta OTA — applyBookingRevision (QA-02)', () => {
  it('dedupe: NO vuelve a crear si el locator externo ya existe', async () => {
    const created: any[] = []
    const orm: any = {
      findMany: async (t: string, q: any) => (t === 'Reservations' && q.externalLocator === 'OTA123' ? [{ id: 'existing' }] : []),
      update: async () => {},
      create: async (_t: string, d: any) => { created.push(d); return d },
    }
    await applyBookingRevision({ orm, channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel }, { externalLocator: 'OTA123', status: 'new' })
    expect(created).toHaveLength(0)
  })

  it('cancelación OTA delega en el puerto de reservas (NO hace orm.update directo)', async () => {
    const updates: any[] = []
    const calls: any[] = []
    const orm: any = {
      findMany: async (t: string) => (t === 'Reservations' ? [{ id: 'existing' }] : []),
      update: async (_t: string, id: string, d: any) => { updates.push({ id, ...d }) },
      create: async () => {},
    }
    const cancelReservation = async (id: string, hotelId: string, reason: string) => {
      calls.push({ id, hotelId, reason }); return { ok: true }
    }
    await applyBookingRevision({ orm, channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation }, { externalLocator: 'OTA123', status: 'cancelled' })
    // El update crudo a Reservations desaparece: la cancelación pasa por el módulo reservas,
    // que aplica política, persiste el snapshot y emite onReservationCancelled.
    expect(updates).toHaveLength(0)
    expect(calls).toEqual([{ id: 'existing', hotelId: 'h1', reason: 'Cancelada por el canal OTA' }])
  })

  it('si el puerto de cancelación falla, la revisión lanza (no se ackea, se reintenta)', async () => {
    const orm: any = {
      findMany: async (t: string) => (t === 'Reservations' ? [{ id: 'existing' }] : []),
      update: async () => {},
      create: async () => {},
    }
    const cancelReservation = async () => ({ ok: false, error: 'puerto no cableado' })
    await expect(
      applyBookingRevision({ orm, channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation }, { externalLocator: 'OTA123', status: 'cancelled' }),
    ).rejects.toThrow(/puerto no cableado/)
  })

  // Reintentar sirve para lo que puede mejorar. Que el canal cancele una reserva que ya hizo
  // check-in no mejora nunca: el próximo tick daría lo mismo. Lanzar ahí dejaba la revisión
  // rebotando para siempre y tapando las revisiones sanas que vienen detrás.
  for (const error of ['invalid_state', 'not_found']) {
    it(`una cancelación OTA imposible (${error}) se registra y NO se reintenta`, async () => {
      const orm: any = {
        findMany: async (t: string) => (t === 'Reservations' ? [{ id: 'existing' }] : []),
        update: async () => {}, create: async () => {},
      }
      const logged: { msg: string; meta?: Record<string, unknown> }[] = []
      const logger = { error: (msg: string, meta?: Record<string, unknown>) => { logged.push({ msg, meta }) } }

      const result = await applyBookingRevision(
        { orm, channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: async () => ({ ok: false, error }), logger },
        { externalLocator: 'OTA123', status: 'cancelled' },
      )

      // No lanza → el caller ackea la revisión y el feed sigue drenando.
      expect(result).toEqual({ created: false })
      // Pero queda rastro: alguien tiene que mirar esa reserva (el huésped está adentro).
      expect(logged).toHaveLength(1)
      expect(logged[0].meta).toMatchObject({ reservationId: 'existing', externalLocator: 'OTA123', reason: error })
    })
  }
})

// REQ-HAC-02 (#257) — la unidad se elige con la fuente única de disponibilidad por tipo:
// entre las unidades del tipo, la primera sin reserva bloqueante solapada. Si no queda ninguna,
// la OTA se ingesta igual (nunca se dropea) y la nota marca el overbooking.
describe('ingesta OTA — applyBookingRevision elige la unidad libre del tipo (REQ-HAC-02)', () => {
  const DTO = {
    externalLocator: 'OTA-HAC02', status: 'confirmed', channel: 'Booking.com', notes: 'OTA: Booking.com',
    checkIn: '2026-10-10', checkOut: '2026-10-12', channexRoomTypeId: 'rt-twin',
  }
  const channex: any = { getRoomTypeById: async () => ({ id: 'rt-twin', title: 'Twin Room' }) }
  const TWINS = [{ id: 'r1', type: 'twin', status: 'available' }, { id: 'r2', type: 'twin', status: 'available' }]

  const ormCon = (reservations: any[], created: any[]): any => ({
    findMany: async (t: string, q: any) => {
      if (t === 'Rooms') return TWINS
      if (t === 'Reservations') return q?.externalLocator ? [] : reservations
      return []
    },
    update: async () => {},
    create: async (_t: string, d: any) => { created.push(d); return d },
  })

  it('2 twin, r1 ocupada esas noches → la OTA se crea en r2', async () => {
    const created: any[] = []
    const orm = ormCon([{ id: 'x1', roomId: 'r1', roomType: 'twin', status: 'confirmed', checkIn: '2026-10-09', checkOut: '2026-10-11' }], created)
    const result = await applyBookingRevision({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel }, { ...DTO })
    expect(result).toEqual({ created: true })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ roomId: 'r2', roomType: 'twin' })
    expect(created[0].notes).not.toContain('OVERBOOKING')
  })

  it('tipo agotado por 2 reservas SIN unidad (roomId null) → se crea igual con nota ⚠ OVERBOOKING', async () => {
    const created: any[] = []
    const orm = ormCon([
      { id: 'u1', roomId: null, roomType: 'twin', status: 'confirmed', checkIn: '2026-10-09', checkOut: '2026-10-11' },
      { id: 'u2', roomId: null, roomType: 'twin', status: 'confirmed', checkIn: '2026-10-10', checkOut: '2026-10-12' },
    ], created)
    const result = await applyBookingRevision({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel }, { ...DTO })
    expect(result).toEqual({ created: true })
    expect(created[0]).toMatchObject({ roomId: 'r1', roomType: 'twin' })
    expect(created[0].notes).toContain('⚠ OVERBOOKING: sin unidad libre de twin')
  })

  it('las 2 twin ocupadas → igual se crea (nunca dropea) en r1 con nota ⚠ OVERBOOKING', async () => {
    const created: any[] = []
    const orm = ormCon([
      { id: 'x1', roomId: 'r1', roomType: 'twin', status: 'confirmed', checkIn: '2026-10-09', checkOut: '2026-10-11' },
      { id: 'x2', roomId: 'r2', roomType: 'twin', status: 'checked_in', checkIn: '2026-10-11', checkOut: '2026-10-13' },
    ], created)
    const result = await applyBookingRevision({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel }, { ...DTO })
    expect(result).toEqual({ created: true })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ roomId: 'r1', roomType: 'twin' })
    expect(created[0].notes).toBe('OTA: Booking.com | ⚠ OVERBOOKING: sin unidad libre de twin para esas fechas')
  })

  it('una reserva del tipo SIN unidad asignada no bloquea ninguna unidad física: se elige r1', async () => {
    const created: any[] = []
    const orm = ormCon([{ id: 'x1', roomId: null, roomType: 'twin', status: 'confirmed', checkIn: '2026-10-10', checkOut: '2026-10-12' }], created)
    await applyBookingRevision({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel }, { ...DTO })
    expect(created[0]).toMatchObject({ roomId: 'r1', roomType: 'twin' })
  })

  it('si el chequeo de disponibilidad falla, cae a rooms[0] sin romper la ingesta', async () => {
    const created: any[] = []
    const orm: any = {
      findMany: async (t: string, q: any) => {
        if (t === 'Rooms') return TWINS
        if (t === 'Reservations' && q?.externalLocator) return []
        throw new Error('modelo no soportado')
      },
      update: async () => {},
      create: async (_t: string, d: any) => { created.push(d); return d },
    }
    const result = await applyBookingRevision({ orm, channex, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel }, { ...DTO })
    expect(result).toEqual({ created: true })
    expect(created[0]).toMatchObject({ roomId: 'r1', roomType: 'twin' })
  })
})

// #246 — el aviso al hotel sale SOLO cuando la ingesta crea una reserva nueva. Dedupe, modificación
// y cancelación no avisan; y un aviso que falla nunca deshace la ingesta ni frena el ack.
describe('ingesta OTA — onIngested (#246)', () => {
  const NEW_DTO = { externalLocator: 'OTA999', status: 'confirmed', channel: 'Booking.com', notes: 'OTA', channexRoomTypeId: null }

  const ormNuevo = (created: any[] = []): any => ({
    findMany: async (t: string) => (t === 'Rooms' ? [{ id: 'room-1' }] : []),
    update: async () => {},
    create: async (_t: string, d: any) => { created.push(d); return d },
  })

  it('revisión nueva → onIngested UNA vez con {hotelId, reservationId (el creado), ota}', async () => {
    const created: any[] = []
    const calls: any[] = []
    const onIngested = async (d: any) => { calls.push(d) }

    const result = await applyBookingRevision(
      { orm: ormNuevo(created), channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel, onIngested },
      { ...NEW_DTO },
    )

    expect(result).toEqual({ created: true })
    expect(created).toHaveLength(1)
    expect(calls).toEqual([{ hotelId: 'h1', reservationId: created[0].id, ota: 'Booking.com' }])
  })

  it('revisión de modificación (reserva existente, no cancelada) → 0 avisos', async () => {
    const calls: any[] = []
    const orm: any = {
      findMany: async (t: string) => (t === 'Reservations' ? [{ id: 'existing' }] : [{ id: 'room-1' }]),
      update: async () => {}, create: async () => {},
    }
    const result = await applyBookingRevision(
      { orm, channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel, onIngested: async (d: any) => { calls.push(d) } },
      { ...NEW_DTO, status: 'modified' },
    )
    expect(result).toEqual({ created: false })
    expect(calls).toHaveLength(0)
  })

  it('cancelación → 0 avisos', async () => {
    const calls: any[] = []
    const orm: any = {
      findMany: async (t: string) => (t === 'Reservations' ? [{ id: 'existing' }] : [{ id: 'room-1' }]),
      update: async () => {}, create: async () => {},
    }
    const result = await applyBookingRevision(
      { orm, channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel, onIngested: async (d: any) => { calls.push(d) } },
      { ...NEW_DTO, status: 'cancelled' },
    )
    expect(result).toEqual({ created: false })
    expect(calls).toHaveLength(0)
  })

  it('onIngested que lanza → la ingesta resuelve {created:true} igual y deja rastro en el log', async () => {
    const created: any[] = []
    const logged: any[] = []
    const logger = { error: (msg: string, meta?: Record<string, unknown>) => { logged.push({ msg, meta }) } }
    const onIngested = async () => { throw new Error('notificaciones caída') }

    const result = await applyBookingRevision(
      { orm: ormNuevo(created), channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel, onIngested, logger },
      { ...NEW_DTO },
    )

    expect(result).toEqual({ created: true })
    expect(created).toHaveLength(1)
    expect(logged).toHaveLength(1)
    expect(logged[0].meta).toMatchObject({ hotelId: 'h1', reservationId: created[0].id, error: 'notificaciones caída' })
  })

  it('sin onIngested → la ingesta funciona como siempre', async () => {
    const created: any[] = []
    const result = await applyBookingRevision(
      { orm: ormNuevo(created), channex: {} as any, hotelId: 'h1', apiKey: 'k', cancelReservation: noopCancel },
      { ...NEW_DTO },
    )
    expect(result).toEqual({ created: true })
    expect(created).toHaveLength(1)
  })
})
