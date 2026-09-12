// reservas/tests/backfill-reservation-addons.test.ts — #269 (MR-04): backfill de
// `reservation_addons` (source booking_engine) para las reservas del motor anteriores al cambio,
// reconstruidas desde `priceBreakdown` / `childAmenities` / `roomAmenities` / `notes`.
//
// Cubre:
//  (a) 1.ª corrida: sólo la reserva del motor CON extras recibe filas (upsell desde notes,
//      child_amenity desde el snapshot), con taxRate = Σ taxBreakdown; la del motor sin extras
//      y la del panel (accessToken null) no reciben nada.
//  (b) 2.ª corrida: created 0 y siguen las mismas 2 filas (idempotente).
//  (c) dry-run: cuenta sin escribir.
//  (d) `parseUpsellSummary`: "nombre×qty=total" → unitario = total/qty; "id×qty" sin "=" se ignora.
import { describe, it, expect } from 'bun:test'
import {
  backfillReservationAddonsFromBreakdown, parseUpsellSummary,
} from '../../../../scripts/backfill-reservation-addons-from-breakdown'

/** ORM en memoria, mismo patrón que `bookingengine/tests/public-booking-child-amenities.test.ts`. */
function makeDb(seed: { reservations?: any[]; addons?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    Reservations: seed.reservations ?? [],
    ReservationAddons: seed.addons ?? [],
  }
  const t = (name: string) => (tables[name] ??= [])
  const matches = (row: any, filter: any = {}) => Object.entries(filter).every(([k, v]) => row[k] === v)
  const orm = {
    findMany: async (table: string, filter: any = {}) => t(table).filter((r) => matches(r, filter)),
    create: async (table: string, data: any) => {
      const row = { id: data.id || crypto.randomUUID(), ...data }
      t(table).push(row)
      return row
    },
  }
  return { orm, tables }
}

const MOTOR_CON_EXTRAS = {
  id: 'res-motor-1', hotelId: 'h1', roomId: 'room-1', guestId: 'g1', status: 'confirmed',
  checkIn: '2026-09-10', checkOut: '2026-09-12', totalAmount: 165.2, source: 'web',
  accessToken: 'tok-1',
  notes: 'Reserva online | Upsells: Transfer×1=30.00 | Amenidades infantiles: Cuna=10.00',
  childAmenities: [{ key: 'crib', name: 'Cuna', price: 10, quantity: 1, total: 10 }],
  childAmenitiesTotal: 10,
  priceBreakdown: {
    subtotal: 140, promoDiscount: 0, upsellsTotal: 30, childAmenitiesTotal: 10, roomAmenitiesTotal: 0,
    taxes: 25.2, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 25.2 }], total: 165.2,
  },
}

const MOTOR_SIN_EXTRAS = {
  id: 'res-motor-2', hotelId: 'h1', roomId: 'room-2', guestId: 'g2', status: 'confirmed',
  checkIn: '2026-09-10', checkOut: '2026-09-12', totalAmount: 118, source: 'web',
  accessToken: 'tok-2', notes: 'Reserva online',
  priceBreakdown: {
    subtotal: 100, promoDiscount: 0, upsellsTotal: 0, childAmenitiesTotal: 0, roomAmenitiesTotal: 0,
    taxes: 18, taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 18 }], total: 118,
  },
}

const PANEL = {
  id: 'res-panel-1', hotelId: 'h1', roomId: 'room-3', guestId: 'g3', status: 'confirmed',
  checkIn: '2026-09-10', checkOut: '2026-09-12', totalAmount: 118, source: 'direct',
  accessToken: null, notes: 'Upsells: Transfer×1=30.00', priceBreakdown: null,
}

function seed() {
  return makeDb({ reservations: [structuredClone(MOTOR_CON_EXTRAS), structuredClone(MOTOR_SIN_EXTRAS), structuredClone(PANEL)] })
}

describe('backfillReservationAddonsFromBreakdown (#269)', () => {
  it('1.ª corrida: crea upsell + child_amenity sólo en la reserva del motor con extras', async () => {
    const { orm, tables } = seed()
    const summary = await backfillReservationAddonsFromBreakdown(orm)

    expect(summary).toEqual({ scanned: 2, created: 2, skipped: 1 })
    expect(tables.ReservationAddons).toHaveLength(2)
    expect(tables.ReservationAddons.every((a) => a.reservationId === 'res-motor-1')).toBe(true)

    const transfer = tables.ReservationAddons.find((a) => a.kind === 'upsell')
    expect(transfer).toMatchObject({
      hotelId: 'h1', description: 'Transfer', quantity: 1, amount: 30, unitPrice: 30,
      taxRate: 18, source: 'booking_engine', status: 'pending',
    })
    const cuna = tables.ReservationAddons.find((a) => a.kind === 'child_amenity')
    expect(cuna).toMatchObject({
      hotelId: 'h1', description: 'Cuna', quantity: 1, amount: 10, unitPrice: 10,
      taxRate: 18, source: 'booking_engine', status: 'pending',
    })
    expect(typeof transfer!.id).toBe('string')
    expect(transfer!.id).not.toBe(cuna!.id)
  })

  it('2.ª corrida: created 0 y siguen las mismas 2 filas', async () => {
    const { orm, tables } = seed()
    await backfillReservationAddonsFromBreakdown(orm)
    const ids = tables.ReservationAddons.map((a) => a.id).sort()

    const second = await backfillReservationAddonsFromBreakdown(orm)
    expect(second).toEqual({ scanned: 2, created: 0, skipped: 2 })
    expect(tables.ReservationAddons).toHaveLength(2)
    expect(tables.ReservationAddons.map((a) => a.id).sort()).toEqual(ids)
  })

  it('dry-run: cuenta sin escribir', async () => {
    const { orm, tables } = seed()
    const summary = await backfillReservationAddonsFromBreakdown(orm, { dryRun: true })
    expect(summary).toEqual({ scanned: 2, created: 0, skipped: 1 })
    expect(tables.ReservationAddons).toHaveLength(0)
  })

  it('no toca reservas que ya tienen addons booking_engine ni pisa las manuales', async () => {
    const { orm, tables } = makeDb({
      reservations: [structuredClone(MOTOR_CON_EXTRAS)],
      addons: [
        { id: 'ad-prev', reservationId: 'res-motor-1', hotelId: 'h1', kind: 'upsell', description: 'Transfer', quantity: 1, amount: 30, source: 'booking_engine', status: 'pending' },
        { id: 'ad-manual', reservationId: 'res-motor-1', hotelId: 'h1', kind: 'service', description: 'Lavandería', quantity: 1, amount: 25, source: 'manual', status: 'pending' },
      ],
    })
    const summary = await backfillReservationAddonsFromBreakdown(orm)
    expect(summary).toEqual({ scanned: 1, created: 0, skipped: 1 })
    expect(tables.ReservationAddons.map((a) => a.id)).toEqual(['ad-prev', 'ad-manual'])
  })

  it('tolera priceBreakdown/childAmenities como texto JSON y toma roomAmenities', async () => {
    const { orm, tables } = makeDb({
      reservations: [{
        id: 'res-txt', hotelId: 'h1', accessToken: 'tok-3', notes: null,
        childAmenities: JSON.stringify([{ key: 'crib', name: 'Cuna', price: 10, quantity: 2, total: 20 }]),
        roomAmenities: [{ key: 'custom:vino', name: 'Botella de vino', price: 15, quantity: 1, total: 15 }],
        priceBreakdown: JSON.stringify({ upsellsTotal: 0, childAmenitiesTotal: 20, roomAmenitiesTotal: 15, taxBreakdown: [] }),
      }],
    })
    const summary = await backfillReservationAddonsFromBreakdown(orm)
    expect(summary).toEqual({ scanned: 1, created: 2, skipped: 0 })
    expect(tables.ReservationAddons.map((a) => [a.kind, a.description, a.amount, a.quantity, a.taxRate])).toEqual([
      ['child_amenity', 'Cuna', 10, 2, 0],
      ['room_amenity', 'Botella de vino', 15, 1, 0],
    ])
  })
})

describe('parseUpsellSummary', () => {
  it('nombre×qty=total → unitario = total/qty; "id×qty" sin "=" se ignora', () => {
    expect(parseUpsellSummary('Upsells: Transfer×1=30.00, Late checkout×2=40.00, abc×1')).toEqual([
      { name: 'Transfer', quantity: 1, unitPrice: 30 },
      { name: 'Late checkout', quantity: 2, unitPrice: 20 },
    ])
  })

  it('corta en el separador " | " de notesParts y devuelve [] sin fragmento', () => {
    expect(parseUpsellSummary('Solicitud: cama extra | Upsells: Transfer×1=30.00 | Amenidades habitación: Vino=15.00')).toEqual([
      { name: 'Transfer', quantity: 1, unitPrice: 30 },
    ])
    expect(parseUpsellSummary('Reserva online')).toEqual([])
    expect(parseUpsellSummary(null)).toEqual([])
  })
})
