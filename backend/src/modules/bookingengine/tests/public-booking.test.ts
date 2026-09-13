// bookingengine/tests/public-booking.test.ts — F0 0.13
// spec: openspec/changes/solmi-direct-booking/specs/booking-unification/spec.md
//
// Cubre:
// - createPublicBookingDirect setea `accessToken` (UUID no nulo) en la reserva creada.
// - ReservasModel declara `accessToken` (anti-patrón ORM D5) y NO es required → las reservas
//   creadas desde `/api/panel/reservas` (que NO pasan por este usecase) quedan en `null`,
//   que es el behavior requerido para el endpoint público (404 anti-IDOR).
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'
import { ReservasModel } from '../../reservas/model'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function makeOrm(overrides: Partial<{ room: any; reservations: any[] }> = {}) {
  const created: any[] = []
  // REQ-HAC-05 (#260): la venta es por TIPO — la unidad necesita `type` y `findMany('Rooms')` la devuelve.
  const room = overrides.room ?? { id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' }
  const reservations = overrides.reservations ?? []
  const orm: any = {
    findById: async (_model: string, _id: string) => room,
    findMany: async (model: string) => (model === 'Rooms' ? [room] : model === 'Reservations' ? reservations : []),
    create: async (model: string, payload: any) => {
      const row = { id: payload.id || 'row-1', ...payload }
      created.push({ model, row })
      return row
    },
    // F2 2.5 — El usecase ahora envuelve guest+reservation en orm.transaction. El mock
    // simplemente invoca el callback pasándose a sí mismo como `tx` (los creates van al
    // array `created` como antes). Sin promo no se llama a tx.update/findOne, pero los
    // dejamos como no-op por si un test futuro los invoca.
    transaction: async (cb: (tx: any) => Promise<any>) => cb(orm),
    update: async () => null,
    findOne: async () => null,
  }
  return { orm, created }
}

describe('createPublicBookingDirect — accessToken público (F0 0.13)', () => {
  const baseBody = {
    hotelId: 'h1',
    roomId: 'r1',
    guestName: 'Ana',
    guestEmail: 'ana@example.com',
    guestPhone: '+18095550000',
    checkIn: '2026-08-10',
    checkOut: '2026-08-12',
    adults: 2,
    children: 0,
  }

  it('setea accessToken (UUID no nulo) al crear la reserva por flujo público', async () => {
    const { orm, created } = makeOrm()
    const res = await createPublicBookingDirect(orm, baseBody)
    expect(res.status).toBe(201)

    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(reservationCreate).toBeDefined()
    expect(reservationCreate.row.accessToken).toBeTruthy()
    expect(UUID_RE.test(reservationCreate.row.accessToken)).toBe(true)
    // La reserva devuelta también lo expone.
    expect(UUID_RE.test(res.body.reservation.accessToken)).toBe(true)
    // REQ-RWP-04 — origen web separado de la carga en recepción: `source='web'`, pero `channel`
    // sigue 'direct' para que el reporte de directas (booking-engine.ts) la siga contando.
    expect(reservationCreate.row.source).toBe('web')
    expect(reservationCreate.row.channel).toBe('direct')
  })

  // REQ-HAC-01 (#258): lo vendido es el TIPO — la fila lo lleva desde el alta (antes sólo el
  // panel lo escribía y las reservas web quedaban con `roomType` NULL). REQ-HAC-05 (#260): el
  // `roomId` del body sólo deriva el tipo — la fila nace SIN unidad (`roomId` null).
  it('persiste roomType = rooms.type derivado del roomId (HAC-01) y roomId null (HAC-05)', async () => {
    const { orm, created } = makeOrm({ room: { id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' } })
    const res = await createPublicBookingDirect(orm, baseBody)
    expect(res.status).toBe(201)
    const row = created.find((c) => c.model === 'Reservations')!.row
    expect(row.roomType).toBe('double')
    expect(row.roomId).toBeNull()
    expect(res.body.reservation.roomType).toBe('double')
    expect(res.body.reservation.roomId).toBeNull()
  })

  it('accessToken distinto entre dos reservas (no reutiliza)', async () => {
    const { orm, created } = makeOrm()
    await createPublicBookingDirect(orm, baseBody)
    await createPublicBookingDirect(orm, { ...baseBody, guestEmail: 'otro@example.com' })
    const reservations = created.filter((c) => c.model === 'Reservations')
    expect(reservations).toHaveLength(2)
    expect(reservations[0].row.accessToken).not.toBe(reservations[1].row.accessToken)
  })

  it('no rompe si recibe guestPhone vacío (campo opcional del widget)', async () => {
    const { orm, created } = makeOrm()
    const { phone, ...bodyWithoutPhone } = baseBody as any
    void phone
    const res = await createPublicBookingDirect(orm, bodyWithoutPhone)
    expect(res.status).toBe(201)
    const reservationCreate = created.find((c) => c.model === 'Reservations')
    expect(UUID_RE.test(reservationCreate.row.accessToken)).toBe(true)
  })
})

describe('ReservasModel — columna accessToken declarada (anti-patrón ORM D5)', () => {
  it('declara el campo accessToken como string nullable', () => {
    const fields = ReservasModel.fields as Record<string, any>
    expect(fields.accessToken).toBeDefined()
    expect(fields.accessToken.type).toBe('string')
    // NO required: reservas creadas desde panel (sin usecase público) quedan en null → 404
    // anti-IDOR en el endpoint público (spec booking-unification D4).
    expect(fields.accessToken.required).not.toBe(true)
  })

  it('la tabla física es `reservations` (ingleés only, multi-tenant por hotelId)', () => {
    expect(ReservasModel.table).toBe('reservations')
    expect(ReservasModel.fields.hotelId).toBeDefined()
  })
})
