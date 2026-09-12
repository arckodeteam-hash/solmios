// reservas/tests/checkin-assign-routes.test.ts — El check-in exige habitación y la asigna en el
// mismo paso (REQ-HAC-04, #259).
//
// A nivel de RUTA REAL (router.resolve sobre el módulo `reservas` montado con un ORM fake con datos),
// mismo harness que tests/assign-room-routes.test.ts. Prueba el cableado
// controller.checkin → service.checkin(opts) → assignRoom → executeCheckin:
//
//   POST /api/reservas/:id/checkin {}                          → 409 room_not_assigned, nada escrito
//   POST /api/reservas/:id/checkin {roomId: ocupada}           → 409 room_overlap, nada escrito
//   POST /api/reservas/:id/checkin {roomId: libre}             → 200: reserva checked_in con esa unidad,
//                                                                folio con roomId, habitación occupied
//   POST /api/reservas/:id/checkin {roomId: otro tipo}         → 409 type_mismatch; con allowTypeChange → 200
//
// La lógica fina de la asignación vive en tests/assign-room.test.ts; la del check-in en
// tests/checkin.test.ts y checkin-no-room.test.ts.
import { describe, it, expect } from 'bun:test'
import { Router } from 'arckode-framework'
import { fakeLogger, makeAuth, bearer } from '../../../infrastructure/auth/tests/route-permission-helpers'
import { ReservasModule } from '../index'

type Row = Record<string, any>

const HOTEL = 'h1'
const RESERVATION = 'res-1'
const CHECK_IN = '2026-10-01'
const CHECK_OUT = '2026-10-03'

/** executeCheckin lee los pagos anticipados por el puerto de dinero (best-effort): vacío alcanza. */
const emptyMoneyPort = { folios: async () => [], invoices: async () => [], payments: async () => [], reservationIdOf: async () => null }

/**
 * ORM fake con tablas mutables por id (copia del de assign-room-routes.test.ts). `transaction(fn)`
 * pasa el mismo orm como `tx`: executeCheckin usa updateMany (claim), create (Folios/FolioCharges),
 * findMany (extras/cargos) y update (Reservations/Rooms) sobre él.
 */
function mount() {
  const rows: Record<string, Row[]> = {
    Roles: [],
    Users: [{ id: 'user-receptionist', hotelId: HOTEL, role: 'receptionist', active: 1 }],
    Hotels: [{ id: HOTEL, name: 'Hotel Sol', currency: 'DOP', taxRate: 0 }],
    Plans: [], Subscriptions: [], Configuration: [], HotelModuleOverrides: [],
    RoomBlocks: [], Folios: [], FolioCharges: [], ReservationAddons: [], Auditlog: [],
    SeasonAssignments: [], Seasons: [], RoomRates: [],
    // Dos del tipo vendido (`double`): 102 está ocupada esas noches por OTRA reserva. 201 es `suite`.
    Rooms: [
      { id: 'room-101', hotelId: HOTEL, number: '101', floor: 1, type: 'double', status: 'available', basePrice: 100 },
      { id: 'room-102', hotelId: HOTEL, number: '102', floor: 1, type: 'double', status: 'available', basePrice: 100 },
      { id: 'room-201', hotelId: HOTEL, number: '201', floor: 2, type: 'suite', status: 'available', basePrice: 200 },
    ],
    Reservations: [
      // La reserva bajo prueba: vendió un `double`, todavía sin unidad (HAC-01).
      { id: RESERVATION, hotelId: HOTEL, guestId: 'g1', roomId: null, roomType: 'double', status: 'confirmed', checkIn: CHECK_IN, checkOut: CHECK_OUT, nights: 2, guests: 2, adults: 2, totalAmount: 200, currency: 'DOP' },
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
  service.setOrchestrationDeps({ moneyPort: emptyMoneyPort })
  const reservation = () => rows.Reservations.find((r) => r.id === RESERVATION)!
  const room = (id: string) => rows.Rooms.find((r) => r.id === id)!
  return { router, auth, rows, service, reservation, room }
}

const headers = (auth: ReturnType<typeof makeAuth>) => bearer(auth, 'receptionist', HOTEL)
const URL = `/api/reservas/${RESERVATION}/checkin`

describe('#259 — POST /api/reservas/:id/checkin sin habitación', () => {
  it('sin body → 409 details.reason=room_not_assigned; la reserva sigue confirmed, sin roomId y sin folio', async () => {
    const { router, auth, rows, reservation } = mount()
    const res = await router.resolve('POST', URL, { headers: headers(auth) })
    expect(res.status).toBe(409)
    expect((res.body as any).details?.reason).toBe('room_not_assigned')
    expect(reservation()).toMatchObject({ status: 'confirmed', roomId: null })
    expect(reservation().checkedInAt).toBeUndefined()
    expect(rows.Folios).toHaveLength(0)
    expect(rows.FolioCharges).toHaveLength(0)
  })

  it('{} explícito también es 409 room_not_assigned (el schema es todo opcional, no 400)', async () => {
    const { router, auth, reservation } = mount()
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: {} })
    expect(res.status).toBe(409)
    expect((res.body as any).details?.reason).toBe('room_not_assigned')
    expect(reservation().status).toBe('confirmed')
  })
})

describe('#259 — POST /api/reservas/:id/checkin {roomId} asigna y hace check-in en el mismo paso', () => {
  it('habitación ocupada esas noches → 409 room_overlap y NO hay check-in (sigue confirmed, roomId null, sin folio)', async () => {
    const { router, auth, rows, reservation, room } = mount()
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: { roomId: 'room-102' } })
    expect(res.status).toBe(409)
    expect((res.body as any).details).toMatchObject({ reason: 'room_overlap', locator: 'LOC-OTHER' })
    expect(reservation()).toMatchObject({ status: 'confirmed', roomId: null })
    expect(rows.Folios).toHaveLength(0)
    expect(room('room-102').status).toBe('available')
  })

  it('habitación libre → 200: reserva checked_in con roomId/roomAssignedAt, folio con esa unidad y habitación occupied', async () => {
    const { router, auth, rows, reservation, room } = mount()
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: { roomId: 'room-101' } })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, reservationId: RESERVATION, status: 'checked_in', roomCharge: 100 })
    const row = reservation()
    expect(row).toMatchObject({ status: 'checked_in', roomId: 'room-101', roomAssignedBy: 'user-receptionist', roomType: 'double' })
    expect(typeof row.roomAssignedAt).toBe('string')
    expect(typeof row.checkedInAt).toBe('string')
    expect(rows.Folios).toHaveLength(1)
    expect(rows.Folios[0]).toMatchObject({ reservationId: RESERVATION, roomId: 'room-101', status: 'open' })
    expect(row.folioId).toBe(rows.Folios[0].id)
    expect(rows.FolioCharges.filter((c) => c.category === 'room')).toHaveLength(1)
    expect(room('room-101').status).toBe('occupied')
  })

  it('otro tipo sin allowTypeChange → 409 type_mismatch y sigue confirmed; con allowTypeChange:true → 200 y roomType suite', async () => {
    const { router, auth, rows, reservation, room } = mount()
    const h = headers(auth)
    const denied = await router.resolve('POST', URL, { headers: h, body: { roomId: 'room-201' } })
    expect(denied.status).toBe(409)
    expect((denied.body as any).details.reason).toBe('type_mismatch')
    expect(reservation()).toMatchObject({ status: 'confirmed', roomId: null, roomType: 'double' })
    expect(rows.Folios).toHaveLength(0)

    const ok = await router.resolve('POST', URL, { headers: h, body: { roomId: 'room-201', allowTypeChange: true } })
    expect(ok.status).toBe(200)
    expect(reservation()).toMatchObject({ status: 'checked_in', roomId: 'room-201', roomType: 'suite' })
    expect(rows.Folios[0]).toMatchObject({ roomId: 'room-201' })
    expect(room('room-201').status).toBe('occupied')
  })

  it('habitación de otro hotel → 400 (ValidationError mapeada) y nada se escribe', async () => {
    const { router, auth, rows, reservation } = mount()
    rows.Rooms.push({ id: 'room-x', hotelId: 'h-otro', number: '9', type: 'double', status: 'available' })
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: { roomId: 'room-x' } })
    expect(res.status).toBe(400)
    expect(reservation()).toMatchObject({ status: 'confirmed', roomId: null })
    expect(rows.Folios).toHaveLength(0)
  })

  it('la reserva YA tiene habitación: el body se ignora y el check-in va con la asignada (cambiar es POST /assign-room)', async () => {
    const { router, auth, rows, reservation, room } = mount()
    Object.assign(reservation(), { roomId: 'room-101' })
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: { roomId: 'room-201', allowTypeChange: true } })
    expect(res.status).toBe(200)
    expect(reservation()).toMatchObject({ status: 'checked_in', roomId: 'room-101', roomType: 'double' })
    expect(rows.Folios[0]).toMatchObject({ roomId: 'room-101' })
    expect(room('room-101').status).toBe('occupied')
    expect(room('room-201').status).toBe('available')
  })

  it('reserva cancelled con roomId en el body → 409 por estado y NO se asigna la habitación', async () => {
    const { router, auth, reservation } = mount()
    Object.assign(reservation(), { status: 'cancelled' })
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: { roomId: 'room-101' } })
    expect(res.status).toBe(409)
    expect(reservation()).toMatchObject({ status: 'cancelled', roomId: null })
  })

  it('empuja disponibilidad a Channex para la unidad recién asignada (best-effort)', async () => {
    const { router, auth, service } = mount()
    const pushed: string[] = []
    service.setOrchestrationDeps({ moneyPort: emptyMoneyPort, pushAvailabilityToChannex: (hotelId: string, roomId: string) => { pushed.push(`${hotelId}/${roomId}`) } })
    const res = await router.resolve('POST', URL, { headers: headers(auth), body: { roomId: 'room-101' } })
    expect(res.status).toBe(200)
    expect(pushed).toContain(`${HOTEL}/room-101`)
  })
})
