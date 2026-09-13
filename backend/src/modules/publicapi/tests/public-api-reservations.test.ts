// publicapi/tests/public-api-reservations.test.ts — REQ-HAC-05 (#260): la API pública v1 crea
// reservas POR TIPO. `roomId` dejó de ser obligatorio: con `roomType` la fila nace con
// `roomId: null` + `roomType` (la unidad se asigna en recepción); sin ninguno de los dos → 400;
// con `roomId` sigue funcionando (compat). La respuesta de alta y de lectura lleva `roomType`
// y `roomId` nullable.
//
// El puerto `reservations` corre el `createReservation` REAL del módulo reservas (como cablea el
// connector `publicapi-reservas`): es ahí donde viven la validación del tipo y la disponibilidad
// (`availableOfType`) — este test prueba que la API pública NO se las saltea.

import { describe, it, expect } from 'bun:test'
import { silentLogger } from 'arckode-framework/testing'
import { ValidationError, ConflictError } from 'arckode-framework'
import { PublicapiController } from '../controller'
import { PublicapiService } from '../service'
import { createPublicReservation, getPublicReservation } from '../../../shared/usecases/public-api-reservations'
import { createReservation, getReservationById } from '../../reservas/usecases/crud'

const log = silentLogger()
const HOTEL = 'hotel-1'
const noopCache = { get: async () => null, set: async () => {}, delete: async () => {}, flush: async () => {} } as any

const twoDoubles = [
  { id: 'd-1', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 120, number: '101' },
  { id: 'd-2', hotelId: HOTEL, type: 'double', status: 'available', capacity: 2, basePrice: 100, number: '102' },
]

function setup(opts: { rooms?: any[]; reservations?: any[] } = {}) {
  const rooms = opts.rooms ?? twoDoubles
  const rows: any[] = [...(opts.reservations ?? [])]
  const created: any[] = []
  const reservationRepo = {
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    findMany: async (q: any = {}) => rows.filter((r) =>
      (q.roomId == null || r.roomId === q.roomId)
      && (q.roomType == null || r.roomType === q.roomType)
      && (q.hotelId == null || r.hotelId === q.hotelId)),
    create: async (data: any) => {
      const row = { id: `r-${created.length + 1}`, createdAt: 'now', updatedAt: 'now', ...data }
      created.push(row); rows.push(row); return row
    },
  } as any
  const roomRepo = {
    findOne: async (f: { id: string }) => rooms.find((r) => r.id === f.id) ?? null,
    findById: async (id: string) => rooms.find((r) => r.id === id) ?? null,
    findMany: async (q: any = {}) => rooms.filter((r) =>
      (q.hotelId == null || r.hotelId === q.hotelId) && (q.type == null || r.type === q.type)),
  } as any
  const guests: any[] = []
  const huespedes = { create: async (dto: any, user: any) => { const g = { id: `g-${guests.length + 1}`, hotelId: user.hotelId, ...dto }; guests.push(g); return g } }
  const guestRepo = { findOne: async (f: { id: string }) => guests.find((g) => g.id === f.id) ?? null } as any
  // Puerto `reservas` como el connector: el create REAL del módulo (crud.ts) con sus repos.
  const reservas = {
    create: (dto: any, user: any) => createReservation(reservationRepo, undefined, log, noopCache, {}, {}, dto, user, roomRepo, guestRepo, undefined, undefined, undefined, { findOne: async () => null } as any),
    getById: (id: string, user: any) => getReservationById(reservationRepo, id, user),
  }
  const service = new PublicapiService(log)
  service.setDeps({
    reservations: {
      create: (hotelId, dto) => createPublicReservation(huespedes, reservas, hotelId, dto),
      getById: (hotelId, id) => getPublicReservation(reservas, hotelId, id),
    },
  })
  const controller = new PublicapiController(service, log)
  const post = (body: any) => controller.createReservation({ body, params: {}, query: {}, apiKeyAuth: { hotelId: HOTEL, scope: 'write:reservations,read:reservations' } } as any)
  const get = (id: string) => controller.getReservation({ params: { id }, query: {}, apiKeyAuth: { hotelId: HOTEL, scope: 'read:reservations' } } as any)
  return { created, guests, post, get }
}

const body = (over: Record<string, any> = {}) => ({
  checkIn: '2026-08-01', checkOut: '2026-08-05', adults: 2, totalAmount: 400, guestName: 'Juan Pérez', guestEmail: 'juan@example.com', ...over,
})

async function httpStatusOf(p: Promise<any>): Promise<{ status: number; err: any }> {
  try { await p } catch (e: any) { return { status: Number(e?.httpStatus), err: e } }
  return { status: 0, err: null }
}

describe('POST /api/public/v1/reservations — por tipo (REQ-HAC-05)', () => {
  it('sin roomId con roomType → 201, la fila nace con roomId null + roomType y la respuesta trae roomType', async () => {
    const { created, post } = setup()
    const res = await post(body({ roomType: 'double' }))
    expect(res.status).toBe(201)
    expect(created).toHaveLength(1)
    expect(created[0].roomId).toBeNull()
    expect(created[0].roomType).toBe('double')
    expect(created[0].source).toBe('public-api')
    expect(created[0].status).toBe('pending')
    expect((res.body as any).roomType).toBe('double')
    expect((res.body as any).roomId).toBeNull()
    expect((res.body as any).guestId).toBe('g-1')
  })

  it('sin roomId ni roomType → 400 (ValidationError) y no crea huésped ni reserva', async () => {
    const { created, guests, post } = setup()
    const { status, err } = await httpStatusOf(post(body()))
    expect(err).toBeInstanceOf(ValidationError)
    expect(status).toBe(400)
    expect(created).toHaveLength(0)
    expect(guests).toHaveLength(0)
  })

  it('con roomId (compat) → 201; la fila lleva la unidad y su roomType', async () => {
    const { created, post } = setup()
    const res = await post(body({ roomId: 'd-1' }))
    expect(res.status).toBe(201)
    expect(created[0].roomId).toBe('d-1')
    expect(created[0].roomType).toBe('double')
    expect((res.body as any).roomType).toBe('double')
    expect((res.body as any).roomId).toBe('d-1')
  })

  it('tipo agotado (2 unidades + 2 confirmadas del tipo sin unidad) → 409 type_sold_out, no crea', async () => {
    const confirmed = (id: string) => ({ id, hotelId: HOTEL, roomId: null, roomType: 'double', status: 'confirmed', checkIn: '2026-08-02', checkOut: '2026-08-04' })
    const { created, post } = setup({ reservations: [confirmed('a'), confirmed('b')] })
    const { status, err } = await httpStatusOf(post(body({ roomType: 'double' })))
    expect(err).toBeInstanceOf(ConflictError)
    expect(status).toBe(409)
    expect(err.details?.reason).toBe('type_sold_out')
    expect(created).toHaveLength(0)
  })

  it('tipo que el hotel no tiene → 409 unknown_room_type', async () => {
    const { post } = setup()
    const { status, err } = await httpStatusOf(post(body({ roomType: 'penthouse' })))
    expect(status).toBe(409)
    expect(err.details?.reason).toBe('unknown_room_type')
  })

  it('el schema sigue exigiendo checkIn/checkOut/totalAmount/guestName (400)', async () => {
    const { post } = setup()
    const { status } = await httpStatusOf(post({ roomType: 'double', checkIn: '2026-08-01' }))
    expect(status).toBe(400)
  })
})

describe('GET /api/public/v1/reservations/:id — respuesta por tipo (REQ-HAC-05)', () => {
  it('la lectura devuelve roomType y roomId null mientras no haya unidad asignada', async () => {
    const { post, get } = setup()
    const createdRes = await post(body({ roomType: 'double' }))
    const res = await get((createdRes.body as any).id)
    expect(res.status).toBe(200)
    expect((res.body as any).roomType).toBe('double')
    expect((res.body as any).roomId).toBeNull()
  })
})
