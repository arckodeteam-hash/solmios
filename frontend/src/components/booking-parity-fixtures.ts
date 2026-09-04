// components/booking-parity-fixtures.ts — Requerimiento 15 (Unificación de las dos entradas
// públicas de reserva, 2026-09-04).
//
// El widget embebible (RoomsStep.vue, /book/:slug) y la landing (BookingModal.vue, /h/:slug)
// tenían suites de test "espejo" — RoomsStep.occupancies.test.ts / BookingModal.occupancies.test.ts
// — con `describe`/`it` de títulos calcados a mano, pero CADA archivo armaba su propio fixture por
// separado. Eso prueba que cada componente se comporta bien EN AISLAMIENTO, pero no que las DOS
// superficies produzcan el mismo resultado ante la MISMA entrada: si alguien edita un fixture en
// un archivo y no en el otro, nada falla — los dos test suites pueden divergir en silencio.
//
// Este módulo es el fixture ÚNICO que consume `booking-wizard-landing-parity.test.ts` para montar
// AMBOS componentes con los mismos datos y comparar `store.cart` byte a byte al final.
import type { PublicRatesResponse, RoomOccupancyRate } from '@/types/booking'
import type { ChildPolicy } from '@/utils/child-composition'

export const PARITY_CHECK_IN = '2026-08-18'
export const PARITY_CHECK_OUT = '2026-08-21'

/** Misma política en ambas superficies: acepta niños, libres hasta 3, niños hasta 12. */
export const PARITY_CHILD_POLICY: ChildPolicy = { acceptChildren: true, maxChildAge: 12, maxFreeAge: 3 }

/** Ocupación 3 habilitada (a diferencia del fixture de cada archivo individual) para poder agregar
 *  la Habitación 2 del escenario ("1 adulto + niños de 6 y 10" → 3 ocupantes con plaza). */
export function parityOccupancies(): RoomOccupancyRate[] {
  const tax = (total: number) => [{ name: 'ITBIS', rate: 18, amount: Math.round(total * 0.18 * 100) / 100 }]
  return [
    { occupancy: 1, price: 210, pricePerNight: 70, available: true, unavailableReason: null, taxBreakdown: tax(210) },
    { occupancy: 2, price: 300, pricePerNight: 100, available: true, unavailableReason: null, taxBreakdown: tax(300) },
    { occupancy: 3, price: 400, pricePerNight: 133.33, available: true, unavailableReason: null, taxBreakdown: tax(400) },
  ]
}

export function parityRatesResponse(): PublicRatesResponse {
  return {
    currency: 'USD',
    chargeCurrency: 'USD',
    nights: 3,
    checkIn: PARITY_CHECK_IN,
    checkOut: PARITY_CHECK_OUT,
    taxes: [{ name: 'ITBIS', rate: 18 }],
    cancellationPolicy: null,
    cancellationSummary: null,
    roomTypes: [
      {
        id: 'familiar',
        name: 'familiar',
        fromPrice: 210,
        availableCount: 5,
        capacity: 6,
        maxAdults: null,
        maxChildren: null,
        surfaceArea: 32,
        taxBreakdown: [{ name: 'ITBIS', rate: 18, amount: 37.8 }],
        photoUrl: null,
        occupancies: parityOccupancies(),
      },
    ],
  }
}
