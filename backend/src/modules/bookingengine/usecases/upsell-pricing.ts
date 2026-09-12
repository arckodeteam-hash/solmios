// bookingengine/usecases/upsell-pricing.ts — Matemática de upsells por `kind`, en UN solo lugar.
//
// MR-10 (#275): el widget, POST /booking y POST /booking/group cotizaban los upsells cada uno por
// su lado con `price × qty` sin mirar el `kind`, y el stepper del widget dejaba pedir 20 desayunos
// para 2 huéspedes. Este helper es PURO (sin ORM, sin deps): recibe el catálogo ya leído del hotel
// y devuelve las líneas cotizadas o un error tipado que el caller traduce a 400
// `upsell_quantity_out_of_range`.
//
// Reglas:
//  - Ids inexistentes, inactivos o de otro hotel se IGNORAN (mismo criterio que tenía
//    `public-booking.ts`: el huésped no tiene la culpa de un id stale en el frontend; mejor crear
//    la reserva sin ese extra que rechazarla).
//  - `per_room`   → price × qty, qty ≤ habitaciones de la reserva.
//  - `per_person` → price × qty, qty ≤ personas (adultos + niños con plaza + niños libres; los
//                   bebés no cuentan porque no consumen desayuno ni transfer).
//  - `per_stay`   → price × 1; qty > 1 es error (no se silencia: un qty:2 en un late-checkout es
//                   un bug del cliente o un intento de cobrar de más al huésped).
//  - `per_night`  → price × noches; qty se fuerza a 1 (el "×" lo pone la estadía, no el huésped).
//  - `per_person_per_night` → price × personas × noches; qty forzado a 1.
//  - Fuera de rango → `{ ok: false, error: 'upsell_quantity_out_of_range', ... }` con el tope, para
//    que el 400 le diga al widget cuánto es lo máximo y pueda clampear.
//
// Reproducibilidad: en cada línea `unitPrice × quantity × nights × (persons ?? 1) === total`
// (redondeado). Para los kinds sin noche `nights` queda en 1; `persons` solo aparece en ppn.
import type { UpsellKind } from '../types'
import { round2 } from '../../../shared/utils/money'

/** Contexto de la reserva necesario para cotizar y acotar cada kind. */
export interface UpsellPricingContext {
  /** Noches de la estadía (checkOut − checkIn). */
  nights: number
  /** Habitaciones de la reserva (1 en POST /booking; N en /booking/group). */
  rooms: number
  /** Personas que consumen el extra: adultos + niños con plaza + niños libres. Sin bebés. */
  persons: number
}

/** Línea de upsell cotizada; va tal cual al `priceBreakdown.upsells[]` de la reserva. */
export interface UpsellPricedLine {
  id: string
  name: string
  kind: UpsellKind
  /** Precio unitario del catálogo (moneda del hotel). */
  unitPrice: number
  /** Cantidad efectiva: la pedida para per_room/per_person, 1 para per_stay/per_night/ppn. */
  quantity: number
  /** Noches por las que se multiplica: `ctx.nights` en per_night/ppn, 1 en el resto. */
  nights: number
  /** Personas por las que se multiplica — solo presente en `per_person_per_night`. */
  persons?: number
  total: number
}

export interface UpsellQuantityOutOfRange {
  ok: false
  error: 'upsell_quantity_out_of_range'
  upsellId: string
  name: string
  kind: UpsellKind
  /** Cantidad pedida por el cliente. */
  quantity: number
  /** Tope permitido para ese kind en este contexto. */
  max: number
}

export type UpsellPricingResult =
  | { ok: true; lines: UpsellPricedLine[]; total: number }
  | UpsellQuantityOutOfRange

/** Un ítem del body (`upsells[]`) tal como lo manda el widget. */
export interface UpsellRequestItem {
  id: string
  quantity?: number | null
}

/** Enum cerrado — cualquier otro string del catálogo (row legacy corrupta) se cotiza como `per_stay`. */
const KINDS: readonly UpsellKind[] = ['per_room', 'per_person', 'per_stay', 'per_night', 'per_person_per_night']

function normalizeKind(k: unknown): UpsellKind {
  return KINDS.includes(k as UpsellKind) ? (k as UpsellKind) : 'per_stay'
}

/** Entero ≥ 0 (NaN/negativo → 0), para que un `ctx` mal armado no habilite topes negativos. */
function nonNegInt(n: unknown): number {
  const v = Math.floor(Number(n))
  return Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Tope de cantidad para un `kind` en este contexto. `null` = sin tope. Los kinds de cantidad fija
 * (per_stay/per_night/ppn) devuelven 1. Es la MISMA función que espeja el store del widget
 * (`useBooking#upsellMaxQty`) para que el stepper nunca deje pedir lo que el backend va a rechazar.
 */
export function upsellMaxQuantity(kind: UpsellKind, ctx: UpsellPricingContext): number | null {
  switch (kind) {
    case 'per_room': return nonNegInt(ctx.rooms)
    case 'per_person': return nonNegInt(ctx.persons)
    case 'per_stay':
    case 'per_night':
    case 'per_person_per_night':
      return 1
    default:
      return null
  }
}

/**
 * Cotiza los `items` contra el `catalog` del hotel y devuelve las líneas + total, o el primer
 * error de cantidad (no se acumulan: el widget corrige uno a uno).
 *
 * @param catalog  Filas de `upsells` del hotel (lo que devuelve `upsells.findMany({ hotelId })`).
 * @param items    `upsells[]` del body: `{ id, quantity? }`.
 * @param hotelId  Hotel de la reserva — defensa extra contra ids de otro hotel en el catálogo.
 * @param ctx      Noches / habitaciones / personas de la reserva.
 */
export function resolveUpsellLines(
  catalog: any[],
  items: UpsellRequestItem[],
  hotelId: string,
  ctx: UpsellPricingContext,
): UpsellPricingResult {
  const byId = new Map<string, any>((Array.isArray(catalog) ? catalog : []).map((u) => [String(u?.id), u]))
  const nights = Math.max(1, nonNegInt(ctx.nights))
  const lines: UpsellPricedLine[] = []
  let total = 0

  // Un mismo id repetido en el body se CONSOLIDA en una sola línea (Σ cantidades) antes de validar
  // el tope: si no, `[{id, quantity: 2}, {id, quantity: 2}]` pasaría el máximo de 2 por línea y
  // cobraría 4 (encontrado en revisión de tests, 2026-09-12). El orden de aparición se conserva.
  const merged = new Map<string, number>()
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.id !== 'string') continue
    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
    merged.set(item.id, (merged.get(item.id) ?? 0) + qty)
  }

  for (const [id, requested] of merged) {
    const found = byId.get(id)
    // Inexistente / inactivo / de otro hotel → se ignora (ver cabecera).
    if (!found || !found.active || found.hotelId !== hotelId) continue

    const kind = normalizeKind(found.kind)
    const unitPrice = round2(Number(found.price) || 0)
    const name = String(found.name ?? '')

    let quantity = 1
    let lineNights = 1
    let persons: number | undefined
    switch (kind) {
      case 'per_room':
      case 'per_person':
      case 'per_stay': {
        const max = upsellMaxQuantity(kind, ctx)
        if (max !== null && requested > max) {
          return { ok: false, error: 'upsell_quantity_out_of_range', upsellId: String(found.id), name, kind, quantity: requested, max }
        }
        quantity = requested
        break
      }
      case 'per_night':
        // qty del cliente se ignora a propósito (no es error): el multiplicador es la estadía.
        lineNights = nights
        break
      case 'per_person_per_night':
        lineNights = nights
        persons = nonNegInt(ctx.persons)
        break
    }

    const lineTotal = round2(unitPrice * quantity * lineNights * (persons ?? 1))
    total += lineTotal
    const line: UpsellPricedLine = { id: String(found.id), name, kind, unitPrice, quantity, nights: lineNights, total: lineTotal }
    if (persons !== undefined) line.persons = persons
    lines.push(line)
  }

  return { ok: true, lines, total: round2(total) }
}
