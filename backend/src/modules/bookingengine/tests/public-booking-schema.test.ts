// bookingengine/tests/public-booking-schema.test.ts — B5 fix (audit solmi-direct-booking).
//
// Cubre la validación del body del POST /api/public/booking (controller.createPublicBookingDirect):
//  - Schema `ExtendedPublicBookingSchema` incluye `roomId` (string OPCIONAL) + `roomType`
//    (string required, heredado del schema base).
//  - `validateSchema` rechaza payload malformado (adults:"abc" → 400).
//  - Acepta payload completo válido (hotelId+roomId+roomType+guestName+email+checkIn+checkOut).
//  - Acepta payload SIN `roomId` (solo `roomType`) — FIX 2026-07-30, ver `public-booking.ts`.
//  - `upsells`/`idempotencyKey` se reincorporan al body crudo (no validados, documentado).
//
// El controller ahora aplica `validateSchema(ExtendedPublicBookingSchema, req.body)` antes de
// pasar al usecase. Antes `req.body` iba crudo → 500 o datos corruptos en tipos malformados.
import { describe, it, expect } from 'bun:test'
import { validateSchema } from 'arckode-framework'
import { ExtendedPublicBookingSchema, CreatePublicBookingGroupSchema } from '../validators/schema'

describe('B5 — ExtendedPublicBookingSchema validate (POST /api/public/booking)', () => {
  const validPayload = {
    hotelId: 'h1',
    roomId: 'r1',
    roomType: 'standard',
    guestName: 'Ana',
    guestEmail: 'ana@example.com',
    guestPhone: '+18095550000',
    checkIn: '2026-08-10',
    checkOut: '2026-08-12',
    adults: 2,
    children: 0,
  }

  it('acepta payload válido con roomId y campos escalares', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, validPayload) as Record<string, unknown>
    expect(out.hotelId).toBe('h1')
    expect(out.roomId).toBe('r1')
    expect(out.adults).toBe(2)
  })

  it('B5 — rechaza adults:"abc" (tipo incorrecto) → lanza ValidationError', () => {
    const bad = { ...validPayload, adults: 'abc' }
    expect(() => validateSchema(ExtendedPublicBookingSchema, bad)).toThrow()
  })

  it('FIX 2026-07-30 — acepta payload SIN roomId, solo roomType (widget público real)', () => {
    const { roomId: _drop, ...noRoomId } = validPayload
    const out = validateSchema(ExtendedPublicBookingSchema, noRoomId) as Record<string, unknown>
    expect(out.roomId).toBeUndefined()
    expect(out.roomType).toBe('standard')
  })

  it('rechaza payload sin roomType (sigue required, heredado del schema base)', () => {
    const { roomType: _drop, ...noRoomType } = validPayload
    expect(() => validateSchema(ExtendedPublicBookingSchema, noRoomType)).toThrow()
  })

  it('B5 — rechaza sin guestEmail (required)', () => {
    const { guestEmail: _drop, ...noEmail } = validPayload
    expect(() => validateSchema(ExtendedPublicBookingSchema, noEmail)).toThrow()
  })

  it('B5 — rechaza checkIn/checkOut faltantes', () => {
    const { checkIn: _a, checkOut: _b, ...noDates } = validPayload
    expect(() => validateSchema(ExtendedPublicBookingSchema, noDates)).toThrow()
  })

  it('B5 — successUrl/cancelUrl opcionales (vienen del widget F2)', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, {
      ...validPayload,
      successUrl: 'https://hotel.example/booking/success',
      cancelUrl: 'https://hotel.example/booking/cancel',
    }) as Record<string, unknown>
    expect(out.successUrl).toContain('/booking/success')
  })
})

describe('Tarea 3.1 (solmi-direct-booking-qa-fixes) — estimatedArrival + specialRequests reemplazan el `notes` roto', () => {
  const validPayload = {
    hotelId: 'h1',
    roomType: 'standard',
    guestName: 'Ana',
    guestEmail: 'ana@example.com',
    guestPhone: '+18095550000',
    checkIn: '2026-08-10',
    checkOut: '2026-08-12',
    adults: 2,
  }

  it('conserva estimatedArrival cuando viene en el body', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, {
      ...validPayload,
      estimatedArrival: '15:00',
    }) as Record<string, unknown>
    expect(out.estimatedArrival).toBe('15:00')
  })

  it('sin estimatedArrival, el campo no aparece (opcional, no revienta)', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, validPayload) as Record<string, unknown>
    expect(out.estimatedArrival).toBeUndefined()
  })

  it('conserva specialRequests cuando viene en el body (corrección 2026-08-22: el textarea ' +
    'de pedidos especiales es un requisito duro del producto, no se podía perder)', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, {
      ...validPayload,
      specialRequests: 'Cuna y piso alto, por favor',
    }) as Record<string, unknown>
    expect(out.specialRequests).toBe('Cuna y piso alto, por favor')
  })

  it('sin specialRequests, el campo no aparece (opcional, no revienta)', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, validPayload) as Record<string, unknown>
    expect(out.specialRequests).toBeUndefined()
  })

  it('REGRESIÓN — descarta `notes` (el bug real que cerró esta tarea): el textarea viejo ' +
    'mandaba `notes` en el body y validateSchema lo tiraba en silencio porque el schema nunca ' +
    'lo declaró. Si algún día alguien "arregla" esto agregando `notes` de vuelta al schema sin ' +
    'togglear este test, hay que revisar que no se reintroduzca el campo libre sin estructurar.', () => {
    const out = validateSchema(ExtendedPublicBookingSchema, {
      ...validPayload,
      notes: 'Pedido especial: cuna y piso alto',
    }) as Record<string, unknown>
    expect(out.notes).toBeUndefined()
  })

  it('mismo campo en CreatePublicBookingGroupSchema (POST /public/booking/group)', () => {
    const groupPayload = {
      hotelId: 'h1',
      guestName: 'Ana',
      guestEmail: 'ana@example.com',
      guestPhone: '+18095550000',
      checkIn: '2026-08-10',
      checkOut: '2026-08-12',
    }
    const out = validateSchema(CreatePublicBookingGroupSchema, {
      ...groupPayload,
      estimatedArrival: 'después de las 8pm',
      specialRequests: 'Alergia al gluten en el desayuno',
    }) as Record<string, unknown>
    expect(out.estimatedArrival).toBe('después de las 8pm')
    expect(out.specialRequests).toBe('Alergia al gluten en el desayuno')

    const withNotes = validateSchema(CreatePublicBookingGroupSchema, {
      ...groupPayload,
      notes: 'esto se debería perder',
    }) as Record<string, unknown>
    expect(withNotes.notes).toBeUndefined()
  })
})
