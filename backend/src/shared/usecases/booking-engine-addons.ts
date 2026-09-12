// shared/usecases/booking-engine-addons.ts — Los extras que el huésped pagó online, como filas
// de `reservation_addons`.
//
// Por qué (#269): el motor público cobra upsells, amenidades infantiles y amenidades de la
// habitación junto con la noche, pero hasta ahora solo quedaban como TEXTO en `notes` y como
// snapshot en `priceBreakdown` / `childAmenities` / `roomAmenities`. Nada de eso es un cargo:
// al check-in el folio nace con la habitación sola, el prepago (que incluye los extras) se cruza
// contra ese folio incompleto y al checkout aparece un "saldo a favor" del huésped que no existe.
// Con una fila por extra, el check-in / night audit pueden postear cada uno al folio (MR-04 #269,
// subtareas 3 y 4) y el panel puede listarlos sin parsear `notes`.
//
// Semántica de la fila (ver `shared/models.ts` ReservationAddons): `amount` es el importe UNITARIO
// y la línea vale `amount × quantity`; `unitPrice` repite el unitario (informativo); `taxRate` es
// el % total aplicado al reservar (Σ de los impuestos activos del hotel); `source:'booking_engine'`
// marca que el importe YA está dentro de `reservations.totalAmount`, así que queda fuera del total
// cobrable (`shared/utils/reservation-balance.ts`).
//
// Helper PURO: sin I/O. Quien lo llama (public-booking / public-booking-group) inserta las filas
// dentro de la MISMA transacción que crea la reserva. El régimen (meal plan) queda para MR-03
// (#268): se agrega como un `kind` más, sin tocar el resto.

import { round2 } from '../utils/money'

/** `kind` de cada extra del motor. El régimen (#268) se suma acá cuando llegue. */
export const BOOKING_ENGINE_ADDON_KINDS = {
  upsell: 'upsell',
  childAmenity: 'child_amenity',
  roomAmenity: 'room_amenity',
} as const

export type BookingEngineAddonKind = (typeof BOOKING_ENGINE_ADDON_KINDS)[keyof typeof BOOKING_ENGINE_ADDON_KINDS]

/** Valor de `source` que identifica los extras materializados por el motor público. */
export const BOOKING_ENGINE_ADDON_SOURCE = 'booking_engine' as const

/** Fila lista para `tx.create('ReservationAddons', row)`. */
export interface BookingEngineAddonRow {
  id: string
  reservationId: string
  hotelId: string
  kind: BookingEngineAddonKind
  description: string
  quantity: number
  /** Importe UNITARIO (la línea vale `amount × quantity`). */
  amount: number
  /** Mismo valor que `amount` (informativo). */
  unitPrice: number
  /** % total aplicado al reservar (18 = 18 %). */
  taxRate: number
  source: typeof BOOKING_ENGINE_ADDON_SOURCE
  status: 'pending'
}

/** Upsell ya resuelto contra el catálogo del hotel (nombre y precio del catálogo, nunca del body). */
export interface BookingEngineUpsellInput {
  name: string
  quantity: number
  unitPrice: number
}

/** Amenidad (infantil o de habitación) ya resuelta: mismo shape que el snapshot persistido. */
export interface BookingEngineAmenityInput {
  name: string
  price: number
  quantity: number
}

export interface BuildBookingEngineAddonsInput {
  reservationId: string
  hotelId: string
  taxRate: number
  upsells?: BookingEngineUpsellInput[]
  childAmenities?: BookingEngineAmenityInput[]
  roomAmenities?: BookingEngineAmenityInput[]
}

function normalizeQuantity(q: unknown): number {
  const n = Math.floor(Number(q) || 0)
  return n >= 1 ? n : 1
}

function normalizeMoney(n: unknown): number {
  return round2(Math.max(0, Number(n) || 0))
}

function buildRow(
  base: { reservationId: string; hotelId: string; taxRate: number },
  kind: BookingEngineAddonKind,
  name: string,
  quantity: unknown,
  unitPrice: unknown,
): BookingEngineAddonRow {
  const amount = normalizeMoney(unitPrice)
  return {
    id: crypto.randomUUID(),
    reservationId: base.reservationId,
    hotelId: base.hotelId,
    kind,
    description: String(name ?? '').trim() || kind,
    quantity: normalizeQuantity(quantity),
    amount,
    unitPrice: amount,
    taxRate: round2(Math.max(0, Number(base.taxRate) || 0)),
    source: BOOKING_ENGINE_ADDON_SOURCE,
    status: 'pending',
  }
}

/**
 * Una fila por extra pagado online. Orden estable: upsells, amenidades infantiles, amenidades de
 * habitación (el mismo en que se listan en `notes`). Un extra con precio 0 también se materializa:
 * el huésped lo pidió y recepción tiene que verlo, aunque no genere cargo.
 */
export function buildBookingEngineAddons(input: BuildBookingEngineAddonsInput): BookingEngineAddonRow[] {
  const base = { reservationId: input.reservationId, hotelId: input.hotelId, taxRate: input.taxRate }
  const rows: BookingEngineAddonRow[] = []
  for (const u of input.upsells ?? []) {
    rows.push(buildRow(base, BOOKING_ENGINE_ADDON_KINDS.upsell, u.name, u.quantity, u.unitPrice))
  }
  for (const a of input.childAmenities ?? []) {
    rows.push(buildRow(base, BOOKING_ENGINE_ADDON_KINDS.childAmenity, a.name, a.quantity, a.price))
  }
  for (const a of input.roomAmenities ?? []) {
    rows.push(buildRow(base, BOOKING_ENGINE_ADDON_KINDS.roomAmenity, a.name, a.quantity, a.price))
  }
  return rows
}

/** % total aplicado: Σ de las tasas activas (`readHotelTaxes` ya aplicó el fallback `hotels.taxRate`). */
export function totalTaxRateOf(taxes: ReadonlyArray<{ rate: number }>): number {
  return round2(taxes.reduce((s, t) => s + (Number(t.rate) || 0), 0))
}
