// bookingengine/tests/public-reservation.test.ts — F0 0.14
// spec: openspec/changes/solmi-direct-booking/specs/booking-unification/spec.md
//
// Cubre el endpoint seguro `GET /api/public/reservations/:id?token=X`:
// - Sin token → 404 (anti-enumeración).
// - Token incorrecto → 404 (anti-enumeración).
// - Token válido → 200 con `{ reservation, guest, paymentStatus }`.
// - accessToken=null (reserva creada desde panel) → 404.
// - Reserva inexistente → 404 (mismo body que el resto de los 404).
// - Los 4 casos 404 devuelven EXACTAMENTE el mismo body (anti-enumeración).
// - Token con longitud distinta no rompe `timingSafeEqual` (siempre 404).
//
// El token de la URL es el `accessToken` (UUID) que F0 0.13 guarda en claro.
// El usecase computa `HMAC(secret, accessToken)` y `HMAC(secret, token)` y los
// compara con `timingSafeEqual` (anti timing attack).
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getPublicReservation } from '../usecases/public-reservation'

const VALID_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeOrm(opts: { reservations?: any[]; guest?: any } = {}) {
  const reservations = opts.reservations ?? [
    {
      id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'r1',
      accessToken: VALID_TOKEN,
      status: 'pending', paymentStatus: 'unpaid',
      checkIn: '2026-08-10', checkOut: '2026-08-12', totalAmount: 200,
    },
  ]
  const guest = opts.guest ?? { id: 'g1', hotelId: 'h1', name: 'Ana', email: 'ana@example.com' }
  // Mockea `findMany({id})[0]` — el patrón que usa el código real (no findById, que
  // dispararía el falso positivo del analyzer). Mismo contract que el ORM del framework.
  const orm: any = {
    findMany: async (model: string, query: any) => {
      const id = query?.id
      if (model === 'Reservations') return reservations.filter((r) => r.id === id)
      if (model === 'Guests') return guest && guest.id === id ? [guest] : []
      return []
    },
  }
  return { orm, reservations, guest }
}

describe('getPublicReservation — IDOR cerrado (F0 0.14)', () => {
  const prevSecret = process.env.BOOKING_TOKEN_SECRET
  beforeEach(() => { process.env.BOOKING_TOKEN_SECRET = 'test-secret-fixed' })
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.BOOKING_TOKEN_SECRET
    else process.env.BOOKING_TOKEN_SECRET = prevSecret
  })

  it('sin token → 404 con body neutro', async () => {
    const { orm, reservations } = makeOrm()
    const res = await getPublicReservation(orm, reservations[0].id, undefined)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('token incorrecto → 404 con el MISMO body que sin token', async () => {
    const { orm, reservations } = makeOrm()
    const res = await getPublicReservation(orm, reservations[0].id, 'wrong-token')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('token válido → 200 con { reservation, guest, paymentStatus }', async () => {
    const { orm, reservations, guest } = makeOrm()
    const res = await getPublicReservation(orm, reservations[0].id, VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.id).toBe(reservations[0].id)
    expect(res.body.guest.id).toBe(guest.id)
    expect(res.body.paymentStatus).toBe('unpaid')
  })

  // Requerimiento 4 (Edad de los niños, 2026-09-03) — el huésped tiene que poder recuperar las
  // edades que declaró al reservar (no solo el conteo `children`), mismo criterio que
  // `adults`/`children` de siempre en este allow-list.
  it('expone childrenAges cuando la reserva las trae', async () => {
    const { orm, reservations } = makeOrm({
      reservations: [{
        id: 'res-1', hotelId: 'h1', guestId: 'g1', roomId: 'r1', accessToken: VALID_TOKEN,
        status: 'pending', paymentStatus: 'unpaid', adults: 2, children: 2,
        childrenAges: [4, 9], checkIn: '2026-08-10', checkOut: '2026-08-12', totalAmount: 200,
      }],
    })
    const res = await getPublicReservation(orm, reservations[0]!.id, VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.childrenAges).toEqual([4, 9])
  })

  it('reserva vieja sin childrenAges: expone [] en vez de undefined', async () => {
    const { orm, reservations } = makeOrm()
    const res = await getPublicReservation(orm, reservations[0]!.id, VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.reservation.childrenAges).toEqual([])
  })

  it('accessToken=null (reserva creada desde panel) → 404', async () => {
    const { orm } = makeOrm({
      reservations: [
        { id: 'panel-res', hotelId: 'h1', guestId: 'g1', accessToken: null,
          status: 'confirmed', paymentStatus: 'paid' },
      ],
    })
    const res = await getPublicReservation(orm, 'panel-res', 'any-token-at-all')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('reserva inexistente → 404 con el MISMO body', async () => {
    const { orm } = makeOrm()
    const res = await getPublicReservation(orm, 'does-not-exist', VALID_TOKEN)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Reservation not found' })
  })

  it('los 4 casos 404 devuelven EXACTAMENTE el mismo body (anti-enumeración)', async () => {
    const { orm } = makeOrm({
      reservations: [
        { id: 'res-1', hotelId: 'h1', guestId: 'g1', accessToken: VALID_TOKEN, paymentStatus: 'unpaid' },
        { id: 'panel-res', hotelId: 'h1', guestId: 'g1', accessToken: null, paymentStatus: 'paid' },
      ],
    })
    const cases = await Promise.all([
      getPublicReservation(orm, 'res-1', undefined),         // sin token
      getPublicReservation(orm, 'res-1', 'wrong'),          // token incorrecto
      getPublicReservation(orm, 'missing-id', VALID_TOKEN), // no existe
      getPublicReservation(orm, 'panel-res', 'any'),        // accessToken null
    ])
    const bodies = new Set(cases.map((c) => JSON.stringify(c.body)))
    expect(bodies.size).toBe(1)
    expect(cases.every((c) => c.status === 404)).toBe(true)
    expect(cases[0].body).toEqual({ error: 'Reservation not found' })
  })

  it('token con longitud distinta al accessToken NO rompe timingSafeEqual (sigue 404)', async () => {
    const { orm, reservations } = makeOrm()
    // Buffer lengths van a diferir después del HMAC solo si inputs diferentes, pero
    // igual forzamos un token muy corto para validar el path de `safeEqual` cuando
    // los outputs de HMAC coinciden en longitud (siempre 32 bytes acá) y el contenido
    // difiere → 404 sin throw.
    const res = await getPublicReservation(orm, reservations[0].id, 'a')
    expect(res.status).toBe(404)
  })

  it('no devuelve guest si reservation.guestId es null (sin throw)', async () => {
    const { orm } = makeOrm({
      reservations: [
        { id: 'res-no-guest', hotelId: 'h1', guestId: null, accessToken: VALID_TOKEN,
          status: 'pending', paymentStatus: 'unpaid' },
      ],
    })
    const res = await getPublicReservation(orm, 'res-no-guest', VALID_TOKEN)
    expect(res.status).toBe(200)
    expect(res.body.guest).toBeNull()
    expect(res.body.paymentStatus).toBe('unpaid')
  })
})
