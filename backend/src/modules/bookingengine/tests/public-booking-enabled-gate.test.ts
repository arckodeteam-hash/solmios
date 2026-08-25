// bookingengine/tests/public-booking-enabled-gate.test.ts — FIX 2026-07-31.
//
// El toggle "Activo/Inactivo" de /panel/booking-engine (booking_config.enabled) se guardaba
// pero no lo leía nada — /rates, /ota-prices y /booking corrían igual con el motor "apagado".
// Este archivo cubre la defensa en profundidad en createPublicBookingDirect (POST /api/public/
// booking): un guest normal nunca llega hasta acá si /rates ya bloqueó, pero un caller directo
// del endpoint sí podría.
import { describe, it, expect } from 'bun:test'
import { createPublicBookingDirect } from '../usecases/public-booking'

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

function makeOrm() {
  const room = { id: 'r1', hotelId: 'h1', type: 'double', basePrice: 100, status: 'available' }
  const created: Array<{ model: string; row: any }> = []
  const orm: any = {
    findById: async (model: string, id: string) => (model === 'Rooms' && id === 'r1' ? room : null),
    findMany: async (model: string) => (model === 'Reservations' ? [] : []),
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

describe('createPublicBookingDirect — bookingConfig.enabled (defensa en profundidad)', () => {
  it('enabled=false → 404 "Hotel no encontrado" (mismo criterio anti-enumeración que /rates)', async () => {
    const { orm } = makeOrm()
    const bookingConfig = { findOne: async () => ({ hotelId: 'h1', enabled: false }) }
    const res = await createPublicBookingDirect(
      orm, baseBody, undefined, undefined, undefined, undefined, undefined,
      { bookingConfig: bookingConfig as any },
    )
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Hotel no encontrado')
  })

  it('enabled=true → sigue el flujo normal (201)', async () => {
    const { orm } = makeOrm()
    const bookingConfig = { findOne: async () => ({ hotelId: 'h1', enabled: true }) }
    const res = await createPublicBookingDirect(
      orm, baseBody, undefined, undefined, undefined, undefined, undefined,
      { bookingConfig: bookingConfig as any },
    )
    expect(res.status).toBe(201)
  })

  it('sin fila de bookingConfig (nunca tocó la pantalla) → NO bloquea', async () => {
    const { orm } = makeOrm()
    const bookingConfig = { findOne: async () => null }
    const res = await createPublicBookingDirect(
      orm, baseBody, undefined, undefined, undefined, undefined, undefined,
      { bookingConfig: bookingConfig as any },
    )
    expect(res.status).toBe(201)
  })

  it('sin bookingConfig cableado (compat callers/tests viejos) → NO bloquea', async () => {
    const { orm } = makeOrm()
    const res = await createPublicBookingDirect(orm, baseBody)
    expect(res.status).toBe(201)
  })
})

describe('createPublicBookingDirect — bookingConfig.instantConfirmation (Tarea 3.4, corrección 2026-08-25)', () => {
  it('instantConfirmation=false → la reserva nace approvalStatus:"pending"', async () => {
    const { orm, created } = makeOrm()
    const bookingConfig = { findOne: async () => ({ hotelId: 'h1', enabled: true, instantConfirmation: false }) }
    const res = await createPublicBookingDirect(
      orm, baseBody, undefined, undefined, undefined, undefined, undefined,
      { bookingConfig: bookingConfig as any },
    )
    expect(res.status).toBe(201)
    const reservationRow = created.find((c) => c.model === 'Reservations')
    expect(reservationRow?.row.approvalStatus).toBe('pending')
  })

  it('instantConfirmation=true (o sin fila) → approvalStatus queda undefined (no aplica)', async () => {
    const { orm, created } = makeOrm()
    const bookingConfig = { findOne: async () => ({ hotelId: 'h1', enabled: true, instantConfirmation: true }) }
    const res = await createPublicBookingDirect(
      orm, baseBody, undefined, undefined, undefined, undefined, undefined,
      { bookingConfig: bookingConfig as any },
    )
    expect(res.status).toBe(201)
    const reservationRow = created.find((c) => c.model === 'Reservations')
    expect(reservationRow?.row.approvalStatus).toBeUndefined()
  })

  it('sin bookingConfig cableado (compat callers viejos) → approvalStatus queda undefined', async () => {
    const { orm, created } = makeOrm()
    const res = await createPublicBookingDirect(orm, baseBody)
    expect(res.status).toBe(201)
    const reservationRow = created.find((c) => c.model === 'Reservations')
    expect(reservationRow?.row.approvalStatus).toBeUndefined()
  })
})
