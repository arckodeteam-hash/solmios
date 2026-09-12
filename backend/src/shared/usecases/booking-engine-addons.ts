// shared/usecases/booking-engine-addons.ts — Los extras que el huésped pagó online, como filas
// de `reservation_addons`.
//
// Por qué (#269): el motor público cobra upsells, amenidades infantiles y amenidades de la
// habitación junto con la noche, pero hasta ahora solo quedaban como TEXTO en `notes` y como
// snapshot en `priceBreakdown` / `childAmenities` / `roomAmenities`. Nada de eso es un cargo:
// (#292: el catálogo global de amenidades infantiles se dio de baja; `childAmenities` se sigue
// aceptando como entrada por el snapshot HISTÓRICO de reservas ya creadas — backfill — y
// `kind:'child_amenity'` queda como valor legado en `reservation_addons`.)
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
// dentro de la MISMA transacción que crea la reserva. El régimen (meal plan, MR-03 #268) es un
// `kind` más (`meal_plan`): sin su fila el folio nacía sin el régimen que Stripe SÍ cobró y al
// checkout aparecía un saldo a favor inexistente — el mismo bug que #269 corrigió para el resto.

import { round2 } from '../utils/money'

/** `kind` de cada extra del motor. */
export const BOOKING_ENGINE_ADDON_KINDS = {
  upsell: 'upsell',
  childAmenity: 'child_amenity',
  roomAmenity: 'room_amenity',
  mealPlan: 'meal_plan',
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

/**
 * MR-03 (#268) — Régimen ya resuelto contra `meal_plans` (precio del catálogo, nunca del body).
 * Mismo criterio que los upsells `per_person_per_night`: `unitPrice` es el unitario por persona y
 * noche y la `quantity` de la fila lleva el multiplicador completo (`persons × nights × units`),
 * así el folio asienta `amount × quantity` = exactamente lo que se cobró. Un régimen `included`
 * (unitario 0) también se materializa: recepción tiene que verlo aunque no genere cargo.
 */
export interface BookingEngineMealPlanInput {
  /** Etiqueta ya resuelta (p. ej. "Desayuno"); cae al código si no hay etiqueta. */
  label: string
  /** Precio por persona y noche (0 si `included`). */
  unitPrice: number
  /** Personas que pagan el régimen (adultos + niños con plaza). */
  persons: number
  nights: number
  /** Unidades físicas con este régimen (grupo: `quantity` de la línea). Default 1. */
  units?: number
}

export interface BuildBookingEngineAddonsInput {
  reservationId: string
  hotelId: string
  taxRate: number
  upsells?: BookingEngineUpsellInput[]
  childAmenities?: BookingEngineAmenityInput[]
  roomAmenities?: BookingEngineAmenityInput[]
  mealPlans?: BookingEngineMealPlanInput[]
}

/** Prefijo de `description` de las filas `meal_plan` (lo que ve recepción y el folio). */
export const MEAL_PLAN_ADDON_DESCRIPTION_PREFIX = 'Régimen: '

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
 * habitación, régimen (el mismo en que se listan en `notes`). Un extra con precio 0 también se
 * materializa: el huésped lo pidió y recepción tiene que verlo, aunque no genere cargo.
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
  for (const m of input.mealPlans ?? []) {
    const persons = Math.max(0, Math.floor(Number(m.persons) || 0))
    const nights = Math.max(0, Math.floor(Number(m.nights) || 0))
    const units = Math.max(1, Math.floor(Number(m.units) || 1))
    // Multiplicador 0 (sin personas o sin noches) → la línea vale 0: `quantity` cae a 1 por la
    // normalización, así que el unitario se anula para no asentar un cargo que no se cobró.
    const multiplier = persons * nights * units
    rows.push(buildRow(
      base, BOOKING_ENGINE_ADDON_KINDS.mealPlan,
      `${MEAL_PLAN_ADDON_DESCRIPTION_PREFIX}${String(m.label ?? '').trim() || 'régimen'}`,
      Math.max(1, multiplier), multiplier > 0 ? m.unitPrice : 0,
    ))
  }
  return rows
}

/** % total aplicado: Σ de las tasas activas (`readHotelTaxes` ya aplicó el fallback `hotels.taxRate`). */
export function totalTaxRateOf(taxes: ReadonlyArray<{ rate: number }>): number {
  return round2(taxes.reduce((s, t) => s + (Number(t.rate) || 0), 0))
}
