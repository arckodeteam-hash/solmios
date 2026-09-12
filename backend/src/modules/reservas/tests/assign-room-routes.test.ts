// reservas/tests/assign-room-routes.test.ts — Rutas de asignación de habitación (REQ-HAC-03, #258).
//
// A nivel de RUTA REAL (router.resolve sobre el módulo `reservas` montado con un ORM fake con datos),
// mismo molde que restaurant/tests/permissions-routes.test.ts: prueba que el guard
// (auth.authenticate + loadPermissions + requirePermission) corta sin `reservations:edit` y que con el
// permiso el camino controller → service.roomAssignmentDeps() → usecases/assign-room.ts llega a la
// fila y la deja como corresponde.
//
//   GET    /api/reservas/:id/assignable-rooms            → libres esas noches, del tipo vendido
//   GET    /api/reservas/:id/assignable-rooms?allTypes=1 → además las de otro tipo, con typeMismatch
//   POST   /api/reservas/:id/assign-room {roomId}        → roomId + roomAssignedAt/By en la reserva
//   DELETE /api/reservas/:id/assign-room                 → roomId null
//
// La lógica fina (solapes, bloqueos, tipo, reasignación en estadía, auditoría, socket) vive en
// tests/assign-room.test.ts; acá sólo el cableado HTTP.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer, NO_PERMS_ROLE } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { ReservasModule } from '../index'

type Row = Record<string, any>

const HOTEL = 'h1'
const RESERVATION = 'res-1'
const CHECK_IN = '2026-10-01'
const CHECK_OUT = '2026-10-03'

/**
 * ORM fake con tablas mutables por id. El helper compartido (`fakeOrm`) devuelve vacíos y `null`, y
 * acá hace falta que findById encuentre la reserva, findMany liste habitaciones/reservas del hotel y
 * `update` mute la fila para afirmar el estado final. Las tablas del entitlement (Plans/Subscriptions/
 * Configuration/HotelModuleOverrides) van vacías: el module guard es fail-open sin datos.
 */
function mount(roleRows: Row[] = []) {
  const rows: Record<string, Row[]> = {
    Roles: roleRows,
    Users: [
      { id: 'user-receptionist', hotelId: HOTEL, role: 'receptionist', active: 1 },
      { id: `user-${NO_PERMS_ROLE}`, hotelId: HOTEL, role: NO_PERMS_ROLE, active: 1 },
    ],
    Hotels: [{ id: HOTEL, name: 'Hotel Sol', currency: 'DOP' }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RoomBlocks: [],
    // Tres del tipo vendido (`double`): 102 está ocupada esas noches por OTRA reserva. 201 es `suite`.
    Rooms: [
      { id: 'room-101', hotelId: HOTEL, number: '101', floor: 1, type: 'double', status: 'available' },
      { id: 'room-102', hotelId: HOTEL, number: '102', floor: 1, type: 'double', status: 'available' },
      { id: 'room-103', hotelId: HOTEL, number: '103', floor: 1, type: 'double', status: 'cleaning' },
      { id: 'room-201', hotelId: HOTEL, number: '201', floor: 2, type: 'suite', status: 'available' },
    ],
    Reservations: [
      // La reserva bajo prueba: vendió un `double`, todavía sin unidad (HAC-01).
      { id: RESERVATION, hotelId: HOTEL, guestId: 'g1', roomId: null, roomType: 'double', status: 'confirmed', checkIn: CHECK_IN, checkOut: CHECK_OUT, nights: 2, guests: 2, totalAmount: 200 },
      // Otra reserva del hotel con la 102 asignada y noches que se solapan.
      { id: 'res-other', hotelId: HOTEL, guestId: 'g2', roomId: 'room-102', roomType: 'double', status: 'confirmed', checkIn: '2026-10-02', checkOut: '2026-10-04', nights: 2, guests: 1, totalAmount: 200, externalLocator: 'LOC-OTHER' },
    ],
  }
  const table = (t: string) => (rows[t] ??= [])
  const matches = (r: Row, f?: Row) => Object.entries(f ?? {}).every(([k, v]) => r[k] === v)
  const orm: any = {
    define() { return orm },
    findMany: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)),
    findById: async (t: string, id: string) => table(t).find((r) => r.id === id) ?? null,
    findOne: async (t: string, f?: Row) => table(t).find((r) => matches(r, f)) ?? null,
    create: async (t: string, d: Row) => { const row = { id: `gen-${table(t).length + 1}`, ...d }; table(t).push(row); return row },
    update: async (t: string, id: string, d: Row) => {
      const cur = table(t).find((r) => r.id === id)
      if (!cur) return null
      Object.assign(cur, d)
      return cur
    },
    delete: async (t: string, id: string) => {
      const i = table(t).findIndex((r) => r.id === id)
      if (i >= 0) table(t).splice(i, 1)
      return i >= 0
    },
    count: async (t: string, f?: Row) => table(t).filter((r) => matches(r, f)).length,
    paginate: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
    transaction: async (fn: any) => fn(orm),
    updateMany: async (t: string, f: Row, d: Row) => { const hit = table(t).filter((r) => matches(r, f)); hit.forEach((r) => Object.assign(r, d)); return hit.length },
  }

  const router = new Router()
  const auth = makeAuth()
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const service = (ReservasModule() as any).create({ logger: fakeLogger(), orm, cache, router, auth })
  const reservation = () => rows.Reservations.find((r) => r.id === RESERVATION)!
  return { router, auth, rows, service, reservation }
}

const headers = (auth: ReturnType<typeof makeAuth>, role: string) => bearer(auth, role, HOTEL)
const BASE = `/api/reservas/${RESERVATION}`

describe('#258 — rutas de asignación: guard reservations:edit', () => {
  it('rol sin reservations:edit → 403 en GET/POST/DELETE (y nada se escribe)', async () => {
    const { router, auth, reservation } = mount()
    const h = headers(auth, NO_PERMS_ROLE)
    const get = await router.resolve('GET', `${BASE}/assignable-rooms`, { headers: h })
    const post = await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-101' } })
    const del = await router.resolve('DELETE', `${BASE}/assign-room`, { headers: h })
    expect([get.status, post.status, del.status]).toEqual([403, 403, 403])
    expect(reservation().roomId).toBeNull()
  })

  it('sin token → 401 en los tres', async () => {
    const { router } = mount()
    const get = await router.resolve('GET', `${BASE}/assignable-rooms`, {})
    const post = await router.resolve('POST', `${BASE}/assign-room`, { body: { roomId: 'room-101' } })
    const del = await router.resolve('DELETE', `${BASE}/assign-room`, {})
    expect([get.status, post.status, del.status]).toEqual([401, 401, 401])
  })

  it('receptionist (reservations:edit) de OTRO hotel → 403 (ownership post-findById)', async () => {
    const { router, auth } = mount()
    const h = bearer(auth, 'receptionist', 'h-otro')
    const res = await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-101' } })
    expect(res.status).toBe(403)
  })
})

describe('#258 — GET /api/reservas/:id/assignable-rooms', () => {
  it('devuelve las libres del tipo vendido con {id,number,floor,status,cleaningStatus,suggested} y NO la ocupada esas noches', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('GET', `${BASE}/assignable-rooms`, { headers: headers(auth, 'receptionist') })
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; data: Row[] }
    expect(body.success).toBe(true)
    const ids = body.data.map((r) => r.id)
    expect(ids).toEqual(['room-101', 'room-103'])
    expect(ids).not.toContain('room-102') // ocupada por res-other
    expect(ids).not.toContain('room-201') // otro tipo, sin allTypes
    expect(body.data[0]).toMatchObject({ id: 'room-101', number: '101', floor: 1, status: 'available', cleaningStatus: 'clean', suggested: true, typeMismatch: false })
    expect(body.data[1]).toMatchObject({ id: 'room-103', number: '103', floor: 1, status: 'cleaning', cleaningStatus: 'dirty', suggested: false, typeMismatch: false })
  })

  it('?allTypes=1 incluye la de otro tipo con typeMismatch: true (al final del orden)', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('GET', `${BASE}/assignable-rooms`, { headers: headers(auth, 'receptionist'), query: { allTypes: '1' } })
    expect(res.status).toBe(200)
    const data = (res.body as { data: Row[] }).data
    expect(data.map((r) => r.id)).toEqual(['room-101', 'room-103', 'room-201'])
    expect(data.find((r) => r.id === 'room-201')).toMatchObject({ typeMismatch: true, suggested: false })
    expect(data.filter((r) => r.typeMismatch)).toHaveLength(1)
    expect(data.some((r) => r.id === 'room-102')).toBe(false)
  })

  it('?allTypes=true también vale; otro valor no', async () => {
    const { router, auth } = mount()
    const yes = await router.resolve('GET', `${BASE}/assignable-rooms`, { headers: headers(auth, 'receptionist'), query: { allTypes: 'true' } })
    const no = await router.resolve('GET', `${BASE}/assignable-rooms`, { headers: headers(auth, 'receptionist'), query: { allTypes: '0' } })
    expect((yes.body as any).data.map((r: Row) => r.id)).toContain('room-201')
    expect((no.body as any).data.map((r: Row) => r.id)).not.toContain('room-201')
  })

  it('reserva inexistente → 404', async () => {
    const { router, auth } = mount()
    const res = await router.resolve('GET', '/api/reservas/nope/assignable-rooms', { headers: headers(auth, 'receptionist') })
    expect(res.status).toBe(404)
  })
})

describe('#258 — POST /api/reservas/:id/assign-room', () => {
  it('{roomId} → 200 y la reserva queda con roomId/roomAssignedAt/roomAssignedBy', async () => {
    const { router, auth, reservation } = mount()
    const res = await router.resolve('POST', `${BASE}/assign-room`, { headers: headers(auth, 'receptionist'), body: { roomId: 'room-101' } })
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; data: Row }
    expect(body.success).toBe(true)
    expect(body.data).toMatchObject({ id: RESERVATION, roomId: 'room-101', roomAssignedBy: 'user-receptionist' })
    expect(typeof body.data.roomAssignedAt).toBe('string')
    const row = reservation()
    expect(row.roomId).toBe('room-101')
    expect(row.roomAssignedBy).toBe('user-receptionist')
    expect(row.roomAssignedAt).toBe(body.data.roomAssignedAt)
    expect(row.roomType).toBe('double')
  })

  it('sin roomId → 400 (validateSchema) y nada se escribe', async () => {
    const { router, auth, reservation } = mount()
    const res = await router.resolve('POST', `${BASE}/assign-room`, { headers: headers(auth, 'receptionist'), body: {} })
    expect(res.status).toBe(400)
    expect(reservation().roomId).toBeNull()
  })

  it('habitación ocupada esas noches → 409 con details.reason=room_overlap y el localizador', async () => {
    const { router, auth, reservation } = mount()
    const res = await router.resolve('POST', `${BASE}/assign-room`, { headers: headers(auth, 'receptionist'), body: { roomId: 'room-102' } })
    expect(res.status).toBe(409)
    expect((res.body as any).details).toMatchObject({ reason: 'room_overlap', locator: 'LOC-OTHER' })
    expect(reservation().roomId).toBeNull()
  })

  it('otro tipo sin allowTypeChange → 409 type_mismatch; con la flag → 200 y roomType nuevo', async () => {
    const { router, auth, reservation } = mount()
    const h = headers(auth, 'receptionist')
    const denied = await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-201' } })
    expect(denied.status).toBe(409)
    expect((denied.body as any).details.reason).toBe('type_mismatch')
    expect(reservation().roomId).toBeNull()

    const ok = await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-201', allowTypeChange: true } })
    expect(ok.status).toBe(200)
    expect(reservation()).toMatchObject({ roomId: 'room-201', roomType: 'suite' })
  })

  it('reasignar empuja disponibilidad a Channex para la nueva Y la anterior (best-effort)', async () => {
    const { router, auth, service } = mount()
    const pushed: string[] = []
    service.setOrchestrationDeps({ pushAvailabilityToChannex: (hotelId: string, roomId: string) => { pushed.push(`${hotelId}/${roomId}`) } })
    const h = headers(auth, 'receptionist')
    await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-101' } })
    expect(pushed).toEqual([`${HOTEL}/room-101`])
    await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-103' } })
    expect(pushed.slice(1).sort()).toEqual([`${HOTEL}/room-101`, `${HOTEL}/room-103`])
  })
})

describe('#258 — DELETE /api/reservas/:id/assign-room', () => {
  it('→ 200 y roomId/roomAssignedAt/roomAssignedBy en null; el tipo vendido se conserva', async () => {
    const { router, auth, reservation } = mount()
    const h = headers(auth, 'receptionist')
    const assigned = await router.resolve('POST', `${BASE}/assign-room`, { headers: h, body: { roomId: 'room-101' } })
    expect(assigned.status).toBe(200)
    expect(reservation().roomId).toBe('room-101')

    const res = await router.resolve('DELETE', `${BASE}/assign-room`, { headers: h })
    expect(res.status).toBe(200)
    const body = res.body as { success: boolean; data: Row }
    expect(body.success).toBe(true)
    expect(body.data.roomId).toBeNull()
    const row = reservation()
    expect(row.roomId).toBeNull()
    expect(row.roomAssignedAt).toBeNull()
    expect(row.roomAssignedBy).toBeNull()
    expect(row.roomType).toBe('double')
  })

  it('en estadía (checked_in) → 409 invalid_status: la unidad no se suelta', async () => {
    const { router, auth, reservation } = mount()
    Object.assign(reservation(), { roomId: 'room-101', status: 'checked_in' })
    const res = await router.resolve('DELETE', `${BASE}/assign-room`, { headers: headers(auth, 'receptionist') })
    expect(res.status).toBe(409)
    expect((res.body as any).details.reason).toBe('invalid_status')
    expect(reservation().roomId).toBe('room-101')
  })
})
