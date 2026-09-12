// bookingengine/usecases/public-booking.ts — Flujo unificado de reserva pública.
//
// Crea la reserva pending en `Reservations` (NO en `public_bookings`) + guest + (F0 0.16)
// dispara el createCheckoutSession de Stripe. El widget recibe `{reservationId, accessToken,
// checkoutUrl}` y redirige a la URL de Stripe (off-site).
//
// F2 2.5 — Materialización del hook de F0 0.16:
//   - `promoCode`: se valida vía `promo-codes/usecases/promo-validate.ts` (NO incrementa uses
//     ahí). Si es válido, aplica descuento sobre el subtotal. El incremento atómico de `uses`
//     ocurre DENTRO de `orm.transaction`, después de crear la reserva, re-leyendo el promo
//     para detectar una race concurrente. Si la tx falla, NO se incrementa (rollback).
//   - `upsells`: se validan ids contra `Upsells` (deben pertenecer al hotel + estar activos).
//     MR-10 (#275): la matemática vive en `upsell-pricing.ts#resolveUpsellLines` y SÍ mira el
//     `kind` (per_room/per_person/per_stay/per_night/per_person_per_night) con tope de cantidad
//     por kind → 400 `upsell_quantity_out_of_range` (antes era price × qty para todo y cualquier
//     qty ≥ 1 pasaba).
//   - `totalBreakdown`: { subtotal, promoDiscount, upsellsTotal, upsells[], childAmenitiesTotal,
//     taxes, total } se devuelve en la respuesta para que el widget muestre el detalle y Stripe
//     cobre el `total`.
//   - `childAmenities` (REQ-01 #233): ids del catálogo `child_amenities` elegidos para ESTA
//     habitación. Se gatean por composición (al menos un menor declarado + acceptChildren), se
//     validan contra el catálogo activo del hotel, se suman al subtotal y se persisten como
//     snapshot con precio en `Reservations.childAmenities` + `childAmenitiesTotal`.
//   - `roomAmenities` (REQ-01 #290): keys `custom:*` de las amenidades PERSONALIZADAS de la
//     habitación (filas `RoomAmenities` con name/price). Mismo patrón que childAmenities, pero
//     el catálogo es POR HABITACIÓN FÍSICA: se prefiere la unidad del tipo que las ofrece y se
//     cobra el precio real de la asignada (nunca el del body). Ver `public-room-amenities.ts`.
//
// Robustez F0 (pagos en prod, spec booking-unification §"PRECAUCIÓN CRÍTICA"):
//   Si `gw.createCharge` falla (hotel sin Stripe configurado, gateway caído, error de red,
//   secret inválido), la reserva SE CREA igual con status='pending' y se devuelve 201 con
//   `checkoutUrl: null` + `paymentError: <mensaje>`. El huésped al menos tiene su reserva; el
//   panel la muestra como "pendiente de pago". NO tirar 500: rompería la creación de reserva
//   por un problema de Stripe, que es una dependencia opcional por hotel.
//
// FIX 2026-07-30 (bug 404 "Habitación no encontrada" en el 100% de los intentos) — Resolución
// de habitación por `roomType`:
//   Root cause: `public-rates.ts` no tiene entidad RoomType propia — el `id` que devuelve por
//   tipo de habitación ES el string `room.type` ("double"), NO un UUID de `Rooms`. El widget
//   lo mandaba tal cual como `roomId`, y la búsqueda por id en `Rooms` con ese string nunca
//   matcheaba → siempre 404.
//   Decisión de diseño: el guest elige un TIPO, no una unidad física concreta. La asignación
//   de la habitación física pasa a ser responsabilidad del BACKEND, en el momento de crear la
//   reserva (no en la cotización), para minimizar la ventana de carrera:
//     - Si el body trae `roomId` Y resuelve a una fila real de `Rooms` → se usa esa habitación
//       tal cual (compat con callers/integradores viejos que ya mandan un id real).
//     - Si no, y trae `roomType` → se buscan las `Rooms` de `hotelId` con ese `type`, status
//       disponible, sin solape con `Reservations` para el rango pedido, y se elige la de menor
//       `basePrice` (criterio simple y determinístico — la más barata disponible).
//     - El check de solape final (antes de crear la reserva) se mantiene como red de seguridad
//       para el caso borde de que el tipo se agote justo entre la cotización y el submit → 409.
//     - Tipo inexistente en el hotel → 404. Tipo existente pero sin unidades libres → 409 (no
//       404: el tipo SÍ existe, solo no hay disponibilidad para esas fechas).

import { safeParse } from '../../../shared/utils/safe-parse'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import { findOrCreateGuest, guestsOnTx } from '../../../shared/usecases/find-or-create-guest'
import type { RepositoryAdapter } from 'arckode-framework'
import { readHotelTaxes, taxLinesOn, sumTaxLines, type TaxLine } from './hotel-taxes'
import { validate as validatePromoCode } from '../../promo-codes/usecases/promo-validate'
import { blockedRoomIds, closedRoomTypes, isRoomTypeClosed, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate, sumStayPriceForComposition } from './rate-resolution'
import { MAX_STAY_NIGHTS } from '../validators/schema'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'
import { DEFAULT_PENDING_TTL_MINUTES } from './config'
import { resolveChildPolicy, resolveChildComposition, fitsRoomCapacity, freeChildrenLimitError } from '../../../shared/usecases/child-composition'
import { resolveRoomTypeCapacityMap, effectiveRoomCapacity } from '../../../shared/usecases/room-type-capacity'
import { normalizeRoomAmenityKeys, loadRoomAmenitiesFor, preferRoomsOffering, resolveRoomAmenityLines, type RoomAmenityLine } from './public-room-amenities'
import { resolveMealPlanLine, ROOM_ONLY_CODE, type MealPlanLine } from './public-meal-plan-lines'
import { buildBookingEngineAddons, totalTaxRateOf, type BookingEngineUpsellInput, type BookingEngineMealPlanInput } from '../../../shared/usecases/booking-engine-addons'
import { resolveUpsellLines, type UpsellPricedLine } from './upsell-pricing'

const MS_PER_DAY = 86_400_000

/** MR-03 (#268) — etiqueta ES del régimen para `notes` (vistazo rápido del recepcionista). Se
 *  reusa desde public-booking-group.ts. Un código desconocido cae al código crudo. */
export const MEAL_PLAN_LABEL: Record<string, string> = {
  breakfast: 'Desayuno',
  half_board: 'Media pensión',
  all_inclusive: 'Todo incluido',
}

/** MR-03 (#268) — la línea de régimen resuelta como input de `buildBookingEngineAddons` (fila
 *  `reservation_addons` kind `meal_plan`, #269). `units` = unidades físicas con ese régimen
 *  (1 en el flujo individual; `quantity` de la línea en el grupo). */
export function mealPlanAddonInput(line: MealPlanLine, units = 1): BookingEngineMealPlanInput {
  return {
    label: MEAL_PLAN_LABEL[line.code] ?? line.code,
    unitPrice: line.unitPrice,
    persons: line.persons,
    nights: line.nights,
    units,
  }
}

/** MR-03 (#268) — texto de `notes` para una línea de régimen resuelta (nunca `room_only`). */
export function mealPlanNote(line: MealPlanLine): string {
  const label = MEAL_PLAN_LABEL[line.code] ?? line.code
  return `Régimen: ${label}${line.total > 0 ? ` (${line.persons} pers × ${line.nights} noches = ${line.total.toFixed(2)})` : ' (incluido)'}`
}

export interface UpsellItem {
  id: string
  quantity: number
}

/**
 * REQ-01 (#233) — Línea del snapshot de amenidades infantiles que se persiste en
 * `Reservations.childAmenities`. Precio CONGELADO al momento de reservar (si el hotel cambia el
 * catálogo después, la reserva sigue mostrando lo que se cotizó). `quantity` es cuántas unidades
 * físicas llevan esta amenidad (1 por reserva individual; en un grupo, la línea la lleva ×
 * `line.quantity` pero cada fila física persiste su propio snapshot con quantity 1).
 */
export interface ChildAmenityLine {
  id: string
  name: string
  price: number
  quantity: number
  total: number
}

/**
 * REQ-01 (#233) — Normaliza los ids de amenidades infantiles que manda el widget POR HABITACIÓN
 * (`[{id}]`, o strings sueltos por tolerancia). Devuelve ids únicos, sin vacíos.
 */
export function normalizeChildAmenityIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const id = typeof item === 'string' ? item : (item && typeof item.id === 'string' ? item.id : '')
    const trimmed = id.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/**
 * REQ-01 (#233) — Resuelve los ids pedidos contra el catálogo `child_amenities` del hotel. Mismo
 * criterio que los upsells: un id inexistente, inactivo o de otro hotel se IGNORA (no fail-fast —
 * el huésped no tiene la culpa de un id stale en el frontend; mejor crear la reserva sin ese
 * extra), pero se deja constancia con `logger.warn` para diagnosticar. Precio 0 es válido (una
 * amenidad gratuita también se registra en el snapshot, con total 0).
 *
 * @param quantity cuántas unidades físicas llevan cada amenidad (1 en el flujo de 1 habitación).
 */
export function resolveChildAmenityLines(
  catalog: any[],
  ids: string[],
  hotelId: string,
  quantity: number,
  logger?: PublicBookingLogger,
): { lines: ChildAmenityLine[]; total: number } {
  const byId = new Map<string, any>((catalog ?? []).map((a: any) => [a.id, a]))
  const lines: ChildAmenityLine[] = []
  let total = 0
  for (const id of ids) {
    const found = byId.get(id)
    if (!found || !found.active || found.hotelId !== hotelId) {
      logger?.warn('Amenidad infantil ignorada: id desconocido, inactivo o de otro hotel', { hotelId, childAmenityId: id })
      continue
    }
    const price = round2(Math.max(0, Number(found.price) || 0))
    const lineTotal = round2(price * quantity)
    lines.push({ id: found.id, name: String(found.name ?? ''), price, quantity, total: lineTotal })
    total += lineTotal
  }
  return { lines, total: round2(total) }
}

/**
 * F2 2.5 — Deps opcionales para procesar `promoCode` y `upsells`. Si no se pasan, el usecase
 * funciona como antes (F0 0.16: persiste los campos sin validarlos). El controller los cablea
 * desde index.ts; los tests legacy que llaman con 2 args siguen funcionando (sin promo procesing).
 */
export interface PublicBookingExtraDeps {
  /** Repo de `promo_codes` para validar + incrementar uses. */
  promoCodes?: RepositoryAdapter<any>
  /** Repo de `upsells` para validar ids + computar upsellsTotal. */
  upsells?: RepositoryAdapter<any>
  /** REQ-01 (#233) — Repo de `child_amenities` para validar los ids por habitación + computar
   *  `childAmenitiesTotal`. Opcional (compat callers/tests viejos): sin él, los ids se ignoran
   *  con warn y no se suma nada (mismo criterio que `upsells` sin repo). */
  childAmenities?: RepositoryAdapter<any>
  /** MR-03 (#268) — Repo de `MealPlans` (tabla `meal_plans`) para resolver el `mealPlan` del body
   *  contra el catálogo activo del hotel + computar `mealPlanTotal`. A diferencia de
   *  `childAmenities`, sin repo cableado un `mealPlan` distinto de `room_only` se RECHAZA
   *  (`meal_plan_unavailable`): no se puede validar y cambia el precio que el huésped vio. */
  mealPlans?: RepositoryAdapter<any>
  /** Repo de `Configuration` para leer la tasa de impuesto del hotel (configuration('taxes')). */
  config?: RepositoryAdapter<any>
  /** FIX 2026-07-31 — Repo de `BookingConfig` (booking_config). Defensa en profundidad: si
   *  `/rates` bloquea por `enabled=false` un guest normal nunca llega acá, pero un caller
   *  directo del POST sí podría — mismo gate acá. Opcional (compat callers/tests viejos). */
  bookingConfig?: RepositoryAdapter<any>
  /** #276 (MR-11) — Repo de `hotels`. Con él el POST pasa por el MISMO `isEngineOpen` que los
   *  GET (`hotels.onlineBookingStatus` + `booking_config.enabled`). Opcional (compat callers/
   *  tests viejos): sin él, sólo se mira `booking_config.enabled`, como antes. */
  hotels?: RepositoryAdapter<any>
}

/**
 * F2 2.5 — Desglose del total que el widget muestra en el step Pay y que Stripe cobra.
 * Todos los importes en `hotels.currency` (multi-moneda es display only — el cobro es en base).
 */
export interface TotalBreakdown {
  /** room.basePrice × nights + upsellsTotal + childAmenitiesTotal + roomAmenitiesTotal + mealPlanTotal (antes de promo e impuestos). */
  subtotal: number
  /** Descuento del promo (0 si no hay promo). Siempre >= 0. */
  promoDiscount: number
  /** Σ `upsells[].total` (extras genéricos, cotizados por `kind` — ver `upsell-pricing.ts`). */
  upsellsTotal: number
  /** MR-10 (#275) — cada upsell por línea: `kind`, `unitPrice`, `quantity`, `nights`, `persons`
   *  (solo ppn) y `total`, para que la confirmación pública y el modal del panel puedan mostrar
   *  "Desayuno × 2 personas × 3 noches = 60" y no solo un `upsellsTotal` opaco. Opcional porque
   *  `priceBreakdown` de reservas anteriores a esta feature no lo trae (y `/booking/group` lo
   *  incorpora en su propia subtarea). */
  upsells?: UpsellPricedLine[]
  /** REQ-01 (#233) — Σ amenidad.price × unidades (amenidades para niños/bebés, por habitación).
   *  0 si no se pidió ninguna o si la reserva no tiene menores. Ya incluido en `subtotal`. */
  childAmenitiesTotal: number
  /** REQ-01 (#290) — Σ amenidad.price × unidades de las amenidades PERSONALIZADAS de la
   *  habitación asignada (`RoomAmenities` custom). 0 si no se pidió ninguna. Ya incluido en
   *  `subtotal`. */
  roomAmenitiesTotal: number
  /** MR-03 (#268) — régimen: unitPrice × (adultos + niños con plaza) × noches (0 si `room_only`
   *  o `included`). En un grupo, Σ de las líneas (cada una × su quantity). Ya incluido en `subtotal`. */
  mealPlanTotal: number
  /** Σ impuestos (ITBIS + otros) sobre (subtotal - promoDiscount). Es la suma de `taxBreakdown`. */
  taxes: number
  /** Tarea 24 (#88): cada impuesto con nombre, % e importe. `taxes` es su suma exacta. */
  taxBreakdown: TaxLine[]
  /** (subtotal - promoDiscount) + taxes. Es lo que Stripe cobra. */
  total: number
}

/**
 * Error centinela para abortar la transacción cuando el promo se agotó concurrentemente
 * (alguien más lo usó entre la validación upfront y el commit). No se relanza — se atrapa
 * afuera de la tx y se devuelve 409 con `promoReason: 'max_uses_reached'`.
 */
/**
 * Error centinela para abortar cuando la habitación se vendió entre nuestro chequeo de solape y
 * el insert. Mismo mecanismo que el del promo: se atrapa afuera de la tx y devuelve 409.
 */
class RoomTakenConcurrentlyError extends Error {
  constructor() { super('room_taken_concurrently'); this.name = 'RoomTakenConcurrentlyError' }
}

class PromoUsesExhaustedError extends Error {
  constructor() { super('promo_uses_exhausted_concurrently'); this.name = 'PromoUsesExhaustedError' }
}

/**
 * Contrato mínimo del service que necesita el usecase. Es una interfaz (NO la clase concreta)
 * para que los tests puedan mockearlo sin instanciar el `BookingengineService` real.
 */
export interface PublicBookingStripeDeps {
  /**
   * Crea la Checkout Session sobre `Reservations`. Lanza si la reserva no existe o el hotel
   * no tiene pasarela. El usecase atrapa para degradar graceful (ver robustez F0).
   */
  createReservationCheckout(
    reservationId: string,
    amount: number,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ id: string; url: string; payment_status: string }>
}

export interface PublicBookingLogger {
  warn(msg: string, meta?: any): void
  error(msg: string, meta?: any): void
}

export async function getPublicBookingBySlug(orm: any, slug: string, query: any): Promise<any> {
  // M1 fix (audit solmi-direct-booking) — Resuelve por la columna física `slug` (semilla F0),
  // NO por slugify(hotel.name) on-the-fly: dos hoteles con el mismo nombre reciben sufijos
  // anti-colisión (`name-<hash>`) que el slugify runtime no reproducía → 404 espurios.
  // Fallback a `id === slug` solo si llega un id (compat con callers viejos que usaban id).
  const hotel = await orm.findOne('Hotels', { slug }) as any
    ?? (slug && /^[0-9a-f-]{36}$/i.test(slug) ? await orm.findById('Hotels', slug) as any : null)
  if (!hotel) return { status: 404, body: { error: 'Hotel no encontrado' } }
  const effectiveSlug: string = hotel.slug || String(slug)

  const rooms = await orm.findMany('Rooms', { hotelId: hotel.id }) as any[]
  let available = rooms.filter((r: any) => isRoomSellable(r.status))

  if (query.checkIn && query.checkOut) {
    const hotelRes = await orm.findMany('Reservations', { hotelId: hotel.id }) as any[]
    const overlap = new Set(hotelRes
      .filter((r: any) => r.status !== 'cancelled' && r.status !== 'no_show' && r.checkIn < query.checkOut && r.checkOut > query.checkIn)
      .map((r: any) => r.roomId))
    available = available.filter((r: any) => !overlap.has(r.id))
  }

  const roomIds = new Set(rooms.map((r: any) => r.id))
  const amsRaw = ((await orm.findMany('RoomAmenities', {})) as any[]).filter((a: any) => roomIds.has(a.roomId) && a.isActive !== false)
  const amsByRoom = new Map<string, string[]>()
  for (const a of amsRaw) {
    if (!amsByRoom.has(a.roomId)) amsByRoom.set(a.roomId, [])
    amsByRoom.get(a.roomId)!.push(a.amenityKey)
  }

  const byType = new Map<string, any[]>()
  for (const r of available) {
    const key = r.type || 'standard'
    if (!byType.has(key)) byType.set(key, [])
    byType.get(key)!.push({ id: r.id, number: r.number, name: r.name, basePrice: r.basePrice, capacity: r.capacity })
  }
  const roomTypes = Array.from(byType.entries()).map(([type, items]) => ({
    type, count: items.length, price: items[0].basePrice, rooms: items,
    amenities: amsByRoom.get(items[0].id) || [],
  }))
  return { status: 200, body: { hotel: { id: hotel.id, name: hotel.name, slug: effectiveSlug }, roomTypes } }
}

/**
 * Crea la reserva pública y dispara el createCheckoutSession.
 *
 * @param orm            ORM del framework (mockeable en tests).
 * @param body           Body del POST `/api/public/booking`. Requiere `hotelId` + `roomId` O
 *                       `roomType` (al menos uno) + datos del guest + fechas. `roomId` real
 *                       (fila existente de `Rooms`) tiene prioridad; si no resuelve, se usa
 *                       `roomType` para que el backend elija la unidad libre más barata (ver
 *                       cabecera del archivo, FIX 2026-07-30).
 * @param pushAvailability Callback opcional para invalidar cache de disponibilidad.
 * @param auth           Wrapper de auth (solo para assertOwnership del room).
 * @param stripe         (F0 0.16) Servicio que crea la Checkout Session. Si no se pasa, la
 *                       reserva se crea igual sin intentar cobro (compat con callers viejos
 *                       como `reservas/tests/ownership.test.ts` que no pasan este arg).
 * @param logger         (F0 0.16) Logger para avisar si Stripe falla (no rompe el flujo).
 * @param stripeUrls     (F0 0.16) URLs de success/cancel. Si no se pasan, no se intenta cobro.
 *                       El controller las arma desde el referer/host del request en F0 wiring.
 */
export async function createPublicBookingDirect(
  orm: any,
  body: any,
  pushAvailability?: (hotelId: string, roomId: string) => void,
  auth?: any,
  stripe?: PublicBookingStripeDeps,
  logger?: PublicBookingLogger,
  stripeUrls?: { successUrl: string; cancelUrl: string },
  // F2 2.5 — Deps para procesar promo + upsells. Opcional para no romper tests legacy
  // (que llaman con 2 args) ni callers viejos que todavía no cablean estos repos.
  extraDeps?: PublicBookingExtraDeps,
): Promise<any> {
  const {
    hotelId, roomId, roomType, guestName, guestEmail, guestPhone,
    checkIn, checkOut, adults, children: kids,
    // Feature adultos+niños+edades (2026-09-02). Lo manda el widget nuevo. MR-10 (#275): un
    // caller que solo manda `children` como contador plano YA NO se queda afuera del motor de
    // niños — se le sintetizan edades a `maxChildAge` (Opción A, ver más abajo).
    childrenAges: rawChildrenAges,
    // F2 2.5 — promoCode + upsells ahora se PROCESAN (F0 0.16 solo los persistía).
    promoCode,
    upsells,
    // REQ-01 (#233) — amenidades para niños/bebés elegidas para ESTA habitación: `[{id}]`. Se
    // validan contra el catálogo del hotel y se gatean por composición (ver más abajo).
    childAmenities: rawChildAmenities,
    // REQ-01 (#290) — amenidades personalizadas de la habitación: `[{key: 'custom:<slug>'}]`. Se
    // resuelven contra las filas `RoomAmenities` de la unidad asignada (precio del server).
    roomAmenities: rawRoomAmenities,
    // MR-03 (#268) — código del régimen elegido para ESTA habitación. Se resuelve contra
    // `meal_plans` del hotel (precio del server) después de conocer la composición y las noches.
    mealPlan: rawMealPlan,
    // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09) — Sí/No únicamente; solo tiene efecto
    // si la composición tiene al menos un bebé (Tarea 21) Y el hotel habilitó la cuna; ver el
    // gateo más abajo, después de calcular `childComposition`.
    needsCrib: rawNeedsCrib,
    // Tarea 3.1 — hora de llegada estructurada + pedidos especiales en texto libre. Antes
    // de este cambio ninguno de los dos llegaba acá: el schema no los declaraba y
    // validateSchema los descartaba en el controller en silencio.
    estimatedArrival,
    specialRequests,
    // #266 — clave de idempotencia del widget (opcional). Ver `normalizeIdempotencyKey`.
    idempotencyKey: rawIdempotencyKey,
  } = body

  if (!hotelId || (!roomId && !roomType) || !guestName || !guestEmail || !checkIn || !checkOut) {
    return { status: 400, body: { error: 'Campos requeridos: hotelId, guestName, guestEmail, checkIn, checkOut, y roomId o roomType' } }
  }
  if (checkIn >= checkOut) return { status: 400, body: { error: 'checkIn debe ser anterior a checkOut' } }

  // ─── #266 — Idempotencia: la MISMA key en el MISMO hotel devuelve la reserva ya creada ─────
  // Un reintento del widget (doble click, red que cortó la respuesta, F5 sobre el POST) no puede
  // crear dos reservas pending sobre dos habitaciones. Se busca ANTES de cualquier lectura
  // pesada y de la tx: si ya existe, no se crea nada y se responde 200 con la misma
  // reservationId/accessToken (ver `replayPublicBooking`). La carrera entre dos POST simultáneos
  // con la misma key la cierra el índice único (hotelId, idempotencyKey) — ver el catch de la tx.
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey)
  if (idempotencyKey) {
    const existing = await orm.findOne('Reservations', { hotelId, idempotencyKey })
    if (existing) return replayPublicBooking(orm, existing, stripe, logger, stripeUrls)
  }

  // Techo DURO de noches, igual que `/rates` (ver `MAX_STAY_NIGHTS`). Va acá arriba, ANTES de
  // `stayNights` y de las tres lecturas de abajo: todo lo que sigue —bloqueos por noche,
  // stop-sell por noche y ahora también el precio noche a noche— es lineal en el rango, y esta
  // ruta es pública sin auth. Sin el techo, el POST reabre por su cuenta la misma amplificación
  // de CPU que el GET ya cerró.
  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / MS_PER_DAY))
  if (nights > MAX_STAY_NIGHTS) {
    return { status: 400, body: { error: `La estadía no puede superar ${MAX_STAY_NIGHTS} noches` } }
  }

  // FIX 2026-07-31 — defensa en profundidad del toggle "Activo/Inactivo": `/rates` ya bloquea
  // antes de esto para un guest normal, pero un POST directo (integrador, replay) podía
  // saltearlo. Mismo criterio: el hotel/tipo "no existe" en vez de revelar que está pausado.
  // Hoisted (no scoped al if): Tarea 3.4 (corrección 2026-08-25) reusa este mismo fetch más
  // abajo para decidir `approvalStatus` sin pedir booking_config dos veces.
  let bookingConfig: any = null
  if (extraDeps?.bookingConfig) {
    bookingConfig = await extraDeps.bookingConfig.findOne({ hotelId })
  }
  // #276 (MR-11) — un solo interruptor del motor público (`shared/usecases/booking-engine-gate.ts`):
  // el POST recibe `hotelId` (no slug), así que el hotel se carga por id vía `extraDeps.hotels` y
  // se pasa por el MISMO `isEngineOpen` que los GET (plataforma + hotel) con el MISMO 404 body.
  // Compat: sin `hotels` cableado (callers/tests viejos con orm fake sin `Hotels`) se conserva
  // el chequeo sólo por `booking_config.enabled`, que era el comportamiento anterior.
  const hotel = extraDeps?.hotels ? await extraDeps.hotels.findOne({ id: hotelId }) : null
  if (extraDeps?.hotels ? !isEngineOpen(hotel, bookingConfig) : bookingConfig?.enabled === false) {
    return engineClosed()
  }

  // ─── FIX (room_blocks + stop-sell) — paridad con AvailabilityUseCase y /calendar ──────
  // El motor ya no OFRECE una habitación bloqueada ni un tipo con la tarifa cerrada; el POST
  // tampoco la ACEPTA. Sin esto el gate sería puramente cosmético: un integrador (o un submit
  // con datos stale) podía crear la reserva igual sobre inventario que el hotel cerró.
  // Las tres lecturas son sobre modelos COMPARTIDOS (`shared/models.ts`) — mismo criterio de
  // acceso que `Rooms`/`Reservations` acá arriba, sin import cross-module.
  const stayNightDates = stayNights(checkIn, checkOut)
  const [rawBlocks, rawRates, rawAssignments, rawOverrides, rawSeasons] = await Promise.all([
    orm.findMany('RoomBlocks', { hotelId }) as Promise<any[]>,
    orm.findMany('RoomRates', { hotelId }) as Promise<any[]>,
    orm.findMany('SeasonAssignments', { hotelId }) as Promise<any[]>,
    // Tarifas por fecha: la capa que pisa a la temporada. Sin esto la web propia cobraría el
    // precio de temporada por una noche que el hotel ya re-tarifó (y publicó a las OTAs).
    orm.findMany('RateOverrides', { hotelId }) as Promise<any[]>,
    // Catálogo de temporadas: su RANGO también asigna temporada, no solo los días pintados.
    orm.findMany('Seasons', { hotelId }) as Promise<any[]>,
  ])
  // Feature adultos+niños+edades (2026-09-02) + MR-10 (#275, Opción A): el motor de niños se
  // activa con CUALQUIER niño declarado, venga como `childrenAges` (widget nuevo) o como `children`
  // contador plano (BookingModal.vue viejo, integradores, API pública). Hasta MR-10 el caller
  // plano cotizaba por adultos únicamente (los niños nunca movían el precio) y el mismo pedido daba
  // dos totales según la puerta de entrada. Ahora, sin edades, cada niño se SINTETIZA a
  // `childPolicy.maxChildAge` — el caso más caro de la política: es "niño con plaza" (cuenta para
  // precio y capacidad, nunca bebé ni libre), así que quien no declara edades no obtiene ningún
  // descuento por edad; SÍ obtiene el % de niños con plaza (`childrenRatePercent`) si el hotel lo
  // habilitó, porque esa regla no depende de la edad sino de que el niño consuma plaza. Con eso el
  // resto del flujo (composición, `maxFreeChildrenPerRoom`, capacidad/`maxChildren`, % niños,
  // persistencia de `childrenAges`/`childrenAgesAsOf`) es EXACTAMENTE el mismo que para un caller
  // con edades — una sola regla de precio para todos los puntos de entrada. Sin niños (children 0
  // y sin edades) nada de esto corre.
  //
  // Nota: si `maxFreeAge === maxChildAge` (el hotel decidió que TODO niño viaja sin plaza), la
  // edad sintetizada cae en "libre" — correcto, es la política del hotel, no una decisión nuestra.
  const declaredChildrenAges: unknown[] = Array.isArray(rawChildrenAges) ? rawChildrenAges : []
  const plainChildrenCount = Math.max(0, Math.floor(Number(kids)) || 0)
  const hasAnyChildren = declaredChildrenAges.length > 0 || plainChildrenCount > 0
  const childPolicy = hasAnyChildren ? await resolveChildPolicy(extraDeps?.config, hotelId) : null
  // Con Opción A un caller con `children` plano en un hotel que no acepta niños también recibe
  // este 400 — antes pasaba en silencio cotizando por adultos.
  if (hasAnyChildren && childPolicy && !childPolicy.acceptChildren) {
    return { status: 400, body: { error: 'Este hotel no acepta niños en la reserva' } }
  }
  const childrenAgesInput: unknown[] = declaredChildrenAges.length > 0
    ? declaredChildrenAges
    : (childPolicy ? Array.from({ length: plainChildrenCount }, () => childPolicy.maxChildAge) : [])
  const hasChildrenAges = childrenAgesInput.length > 0
  // FIX (encontrado en revisión Requerimiento 2, 2026-09-03): un caller legacy (sin
  // `childrenAges`) armaba acá `chargeableOccupancy: adultos únicamente`, y ESE número es el que
  // `fitsRoomCapacity` compara contra `capacity` más abajo — los niños del contador plano
  // (`children`) quedaban afuera del chequeo de capacidad por completo (una reserva de 2 adultos
  // + 3 niños pasaba contra una habitación de capacity=2). Con MR-10 ese caller ya entra por
  // `resolveChildComposition` con las edades sintetizadas; el `else` de abajo queda solo para
  // `children: 0` sin edades (composición trivial de adultos).
  const childComposition = hasChildrenAges && childPolicy
    ? resolveChildComposition(adults, childrenAgesInput, childPolicy)
    : {
        effectiveAdults: Math.max(1, Number(adults) || 1),
        payingChildren: 0,
        freeChildren: 0,
        babies: 0,
        chargeableOccupancy: Math.max(1, Number(adults) || 1),
      }
  // REQ-03 (#235) — tope de niños que NO consumen plaza por habitación (`maxFreeChildrenPerRoom`,
  // null = sin límite). Es una regla del HOTEL, no de la unidad física: se decide acá, ANTES de
  // resolver habitación/capacidad. No toca `fitsRoomCapacity`. (Con edades sintetizadas a
  // `maxChildAge` solo puede disparar si la política deja a ese tope como "libre".)
  if (hasChildrenAges && childPolicy) {
    const freeLimitError = freeChildrenLimitError(childPolicy, childComposition)
    if (freeLimitError) return { status: 409, body: { error: freeLimitError } }
  }
  // Ocupación para CAPACIDAD (cuántas plazas físicas ocupa): adultos + niños con plaza + niños
  // sin plaza — un niño "libre" no cuenta para el precio pero sigue siendo una persona física en
  // el cuarto.
  const capacityGuests = childComposition.effectiveAdults + childComposition.payingChildren + childComposition.freeChildren
  // Ocupación para PRECIO: adultos + niños que consumen plaza (el niño libre no cotiza).
  const pricingOccupancy = childComposition.chargeableOccupancy

  // ─── Cuna (Tarea 22, simplificada 2026-09-09) — gateo por bebé Y por config del hotel ───────
  // El composer del frontend ya oculta "¿Necesita cuna?" sin un bebé en la composición o sin que
  // el hotel la haya habilitado, pero el servidor NUNCA confía en lo que mande el cliente (mismo
  // criterio que cualquier otro campo de esta reserva): sin al menos un bebé clasificado
  // (Tarea 21) Y `childPolicy.cribAvailable`, se fuerza a "no pedida" sin importar el body.
  // Simplificación (2026-09-09): "¿Necesita cuna?" es SOLO Sí/No — no existe cantidad de cunas
  // configurable (antes se podía pedir hasta 1 por bebé; el pedido corrigió eso explícitamente:
  // "no preguntar si desea una, dos o más cunas"). `cribCount` queda como 1/0 espejo de
  // `needsCrib`, no como un valor independiente que el cliente pueda variar.
  const babiesCount = childComposition.babies
  const needsCrib = babiesCount > 0 && childPolicy?.cribAvailable === true && rawNeedsCrib === true
  const cribCount = needsCrib ? 1 : 0

  // ─── REQ-01 (#233) — Amenidades para niños/bebés: gateo por menores Y por política ────────
  // Mismo criterio de defensa en profundidad que la cuna: el widget solo muestra el checklist
  // si la habitación tiene menores, pero el servidor NUNCA confía en el body. Sin al menos un
  // menor en la composición (niño con plaza, niño libre o bebé — declarados con edades, que es
  // lo único que resuelve `childPolicy`) Y `childPolicy.acceptChildren`, los ids se descartan.
  // La validación contra el catálogo y la suma van más abajo, junto a los upsells.
  const childAmenityIds = normalizeChildAmenityIds(rawChildAmenities)
  const minorsCount = childComposition.payingChildren + childComposition.freeChildren
  const childAmenitiesAllowed = childPolicy?.acceptChildren === true && minorsCount > 0
  const requestedChildAmenityIds = childAmenitiesAllowed ? childAmenityIds : []
  if (childAmenityIds.length > 0 && !childAmenitiesAllowed) {
    logger?.warn('createPublicBookingDirect: childAmenities ignoradas — la reserva no tiene menores declarados o el hotel no acepta niños', { hotelId })
  }

  // ─── MR-03 (#268) — Régimen: resolver contra el catálogo del hotel, precio del server ────
  // persons = adultos efectivos + niños CON plaza (bebés y niños libres no pagan régimen), mismo
  // criterio que el precio de la habitación. Va ANTES de la promo (su subtotal lo incluye) y
  // ANTES de tocar la DB. Sin repo cableado no se puede validar → se rechaza (no se ignora en
  // silencio como las amenidades: el huésped eligió el régimen y vio su precio).
  const mealPlanCode = typeof rawMealPlan === 'string' ? rawMealPlan.trim().slice(0, 40) : ''
  const mealPlanPersons = childComposition.effectiveAdults + childComposition.payingChildren
  let mealPlanLine: MealPlanLine | null = null
  if (mealPlanCode && mealPlanCode !== ROOM_ONLY_CODE) {
    if (!extraDeps?.mealPlans) {
      logger?.warn('createPublicBookingDirect: mealPlan en el body sin extraDeps.mealPlans cableado — se rechaza (no se puede validar ni cotizar)', { hotelId, mealPlan: mealPlanCode })
      return { status: 400, body: { error: 'meal_plan_unavailable', mealPlan: mealPlanCode } }
    }
    const resolved = resolveMealPlanLine(
      ((await extraDeps.mealPlans.findMany({ hotelId })) as any[]) ?? [], mealPlanCode, hotelId, mealPlanPersons, nights,
    )
    if (!resolved.ok) return { status: 400, body: { error: 'meal_plan_unavailable', mealPlan: mealPlanCode } }
    mealPlanLine = resolved.line
  }
  const mealPlanTotal = mealPlanLine?.total ?? 0

  // Requerimiento 2 (2026-09-03) — capacidad/maxAdults/maxChildren por TIPO de habitación,
  // configurable en Configuración (`room_type_capacity`). Se resuelve SIEMPRE (no solo cuando hay
  // `childrenAges`): reemplaza el fallback por habitación física para cualquier tipo que el hotel
  // haya configurado, incluida la reserva sin niños. Sin config para ese tipo, cae a los campos
  // de la habitación física (comportamiento actual intacto).
  const roomTypeCapacityMap = await resolveRoomTypeCapacityMap(extraDeps?.config, hotelId)

  const blockedIds = blockedRoomIds(rawBlocks ?? [], stayNightDates)
  const closedTypes = closedRoomTypes(rawRates ?? [], rawAssignments ?? [], stayNightDates, pricingOccupancy)

  // Ocupación FÍSICA total: la matriz de `/rates` deshabilita `over_capacity` contra este mismo
  // número (`occupancy-matrix.ts`). La UI ya no deja elegir una fila que no entra, pero un POST
  // directo (integrador, replay, o `roomId` explícito que se salta la resolución por tipo) nunca
  // pasaba por esa matriz — sin este número acá se podía crear una reserva de 6 huéspedes en una
  // habitación para 2.
  const totalGuests = capacityGuests

  // REQ-01 (#290) — keys `custom:*` pedidas. Sin keys, NADA de lo que sigue lee `RoomAmenities`
  // (cero cambio de comportamiento para un caller que no las manda).
  const roomAmenityKeys = normalizeRoomAmenityKeys(rawRoomAmenities)
  let amenitiesByRoom = new Map<string, any[]>()

  // ─── Resolución de la habitación (FIX 2026-07-30, ver cabecera del archivo) ────────
  // 1) `roomId` real (compat callers viejos): si resuelve a una fila de `Rooms`, se usa tal
  //    cual — comportamiento intacto.
  // 2) Si no, `roomType`: el backend elige la unidad concreta acá, no en la cotización.
  let room: any = roomId ? await orm.findById('Rooms', roomId) as any : null
  if (!room) {
    if (!roomType) return { status: 404, body: { error: 'Habitación no encontrada' } }

    const roomsOfType = (await orm.findMany('Rooms', { hotelId, type: roomType })) as any[]
    if (roomsOfType.length === 0) {
      // El tipo no existe en absoluto para este hotel — 404 (no es un problema de fechas).
      return { status: 404, body: { error: 'Tipo de habitación no encontrado' } }
    }

    const availableOfType = roomsOfType.filter((r: any) => isRoomSellable(r.status))
    const hotelReservations = (await orm.findMany('Reservations', { hotelId })) as any[]
    const busyRoomIds = new Set(
      hotelReservations
        .filter((r: any) => r.status !== 'cancelled' && r.status !== 'no_show' && r.checkIn < checkOut && r.checkOut > checkIn)
        .map((r: any) => r.roomId),
    )
    // Criterio de selección entre las libres: menor `basePrice` primero (determinístico y
    // favorece al huésped — misma tarifa que se le cotizó en `public-rates.ts`, que también
    // usa el precio más bajo del type). Capacidad ANTES que precio: dentro del mismo tipo puede
    // haber unidades de capacidad distinta (`public-rates-occupancy-integrity.test.ts` cubre un
    // tipo "familiar" con unidades de capacidad 2 y 4 a la vez).
    let freeOfType = availableOfType
      // `room_blocks` descuenta unidades igual que una reserva: la habitación puede no tener
      // reservas y aun así estar cerrada por mantenimiento para ese rango.
      .filter((r: any) => !busyRoomIds.has(r.id) && !blockedIds.has(r.id))
      .filter((r: any) => fitsRoomCapacity(effectiveRoomCapacity(roomTypeCapacityMap, { type: r.type, capacity: Number(r.capacity ?? totalGuests), maxAdults: r.maxAdults, maxChildren: r.maxChildren }), childComposition))
      .sort((a: any, b: any) => (Number(a.basePrice) || 0) - (Number(b.basePrice) || 0))
    if (freeOfType.length === 0) {
      // El tipo existe pero no hay unidades libres (o con capacidad suficiente) para esas
      // fechas — 409, no 404.
      return { status: 409, body: { error: 'No hay habitaciones de este tipo disponibles para esas fechas' } }
    }
    // REQ-01 (#290) — entre las libres, PRIMERO las que ofrecen todas las amenidades pedidas
    // (orden estable: dentro de cada grupo sigue mandando el precio). El catálogo público mostró
    // la unión del tipo; acá se intenta honrarla con una unidad que realmente la tenga.
    if (roomAmenityKeys.length > 0) {
      amenitiesByRoom = await loadRoomAmenitiesFor(orm, freeOfType.map((r: any) => r.id))
      freeOfType = preferRoomsOffering(freeOfType, amenitiesByRoom, roomAmenityKeys)
    }
    room = freeOfType[0]
  }
  const resolvedRoomId: string = room.id

  // ─── REQ-01 (#290) — Amenidades de la habitación: validar contra las filas de ESA unidad ──
  // Cubre los dos paths (`roomType` resuelto arriba y `roomId` explícito): key no ofrecida o
  // inactiva en la asignada → se ignora con warn; el precio SIEMPRE sale de `RoomAmenities`.
  let roomAmenityLines: RoomAmenityLine[] = []
  let roomAmenitiesTotal = 0
  if (roomAmenityKeys.length > 0) {
    if (!amenitiesByRoom.has(resolvedRoomId)) amenitiesByRoom = await loadRoomAmenitiesFor(orm, [resolvedRoomId])
    const resolved = resolveRoomAmenityLines(amenitiesByRoom.get(resolvedRoomId) ?? [], roomAmenityKeys, 1, logger)
    roomAmenityLines = resolved.lines
    roomAmenitiesTotal = resolved.total
  }
  const roomAmenitiesSummary = roomAmenityLines.map((l) => `${l.name}=${l.total.toFixed(2)}`)

  // Red de seguridad final: cubre el path de `roomId` explícito (arriba nunca filtró por
  // capacidad porque no pasa por la resolución de `roomType`) y actúa como defensa en
  // profundidad del filtro de arriba.
  const roomCapacity = effectiveRoomCapacity(roomTypeCapacityMap, { type: room.type, capacity: Number(room.capacity ?? totalGuests), maxAdults: room.maxAdults, maxChildren: room.maxChildren })
  if (!fitsRoomCapacity(roomCapacity, childComposition)) {
    return { status: 409, body: { error: `Esta habitación admite hasta ${roomCapacity.capacity} huésped(es); pediste ${totalGuests}` } }
  }

  // No hay usuario: el motor es público. La habitación tiene que ser del hotel del formulario.
  // Iba `assertOwnership(room, { hotelId })` — dos objetos, `===` siempre false: toda reserva daba 403.
  if (auth) auth.assertOwnership(room.hotelId, hotelId)

  // Red de seguridad final (ver cabecera): aunque ya filtramos por solape arriba en el path de
  // `roomType`, repetimos el check acá para (a) el path de `roomId` real (que no lo hizo antes)
  // y (b) cubrir la ventana de carrera entre la resolución de arriba y este punto.
  const overlapping = (await orm.findMany('Reservations', { roomId: resolvedRoomId })) as any[]
  const hasOverlap = overlapping.some((r: any) =>
    r.status !== 'cancelled' && r.status !== 'no_show' && r.checkIn < checkOut && r.checkOut > checkIn)
  if (hasOverlap) return { status: 409, body: { error: 'Habitación no disponible en esas fechas' } }

  // Misma red de seguridad para los dos cierres del hotel. En el path de `roomType` ya están
  // filtrados arriba; acá cubren el path de `roomId` real (que no pasa por esa resolución).
  // 409 y no 404: la habitación/tipo EXISTE, lo que no hay es disponibilidad en esas fechas.
  if (blockedIds.has(resolvedRoomId)) {
    return { status: 409, body: { error: 'Habitación no disponible en esas fechas' } }
  }
  if (isRoomTypeClosed(closedTypes, room.type)) {
    return { status: 409, body: { error: 'No hay habitaciones de este tipo disponibles para esas fechas' } }
  }

  // ─── FIX — el precio que se COBRA es el mismo que se PUBLICÓ ───────────────────────────────
  // Antes acá decía `(room.basePrice || 0) * nights`: ignoraba la temporada Y la ocupación. La
  // matriz de `/rates` publica "para 1 $70 / para 2 $90 / para 4 $150" y el checkout cobraba lo
  // mismo en las tres; un hotel con temporadas anunciaba un precio en la landing y cobraba otro.
  // Ahora cotiza con el MISMO resolver que `/rates` y `/calendar` (`sumStayPrice`), con la
  // ocupación de la reserva — la que el widget mandó como `adults`, el mismo número con el que
  // consultó la matriz.
  //
  // CERO REGRESIÓN para un hotel sin temporadas ni tarifas (el caso de casi todos): sin
  // `season_assignments`, `pickRate` devuelve `null` en cada noche y cada una cae al fallback
  // `room.basePrice` → la suma es idénticamente `basePrice × nights`.
  //
  // `fallbackNightly` sale de la habitación YA RESUELTA (la libre más barata del tipo), que es la
  // misma que se le cotizó al huésped: `/rates` publica el `min(basePrice)` del tipo.
  const baseRates = baseRatesOnly(rawRates ?? [])
  const seasonByDate = buildSeasonByDate(rawAssignments ?? [], rawSeasons ?? [], stayNightDates)
  // Misma ocupación que el `closedRoomTypes` de arriba (`pricingOccupancy` — adultos + niños con
  // plaza, sean edades declaradas o sintetizadas por MR-10).
  const fallbackNightly = Number(room.basePrice) || 0
  // Tarea "Cobro % niños" (2026-09-09) — aplica a todo niño con plaza. MR-10 (#275): también al
  // caller con `children` plano, porque sus niños ya se sintetizaron a `maxChildAge` (con plaza)
  // y el % no depende de la edad exacta sino de consumir plaza.
  const childrenDiscountEnabled = hasChildrenAges && childPolicy?.childrenDiscountEnabled === true
  // Auditoría (AC "el porcentaje utilizado debe conservarse... para mantener consistencia con el
  // precio calculado"): el % vigente en `configuration` puede cambiar después — sin anclar el que
  // REALMENTE se usó en esta reserva, un repricing futuro (o solo mirar la reserva) no podría
  // reproducir el total ya cobrado. `null` cuando la regla no aplicó a esta reserva (deshabilitada
  // o sin niños con plaza), nunca un valor "por si acaso".
  const childrenRatePercentApplied = childrenDiscountEnabled && childComposition.payingChildren > 0
    ? childPolicy!.childrenRatePercent
    : null
  const roomSubtotal = stayNightDates.length > 0
    ? sumStayPriceForComposition(
        stayNightDates, baseRates, String(room.type ?? ''), seasonByDate,
        childComposition.effectiveAdults, childComposition.payingChildren,
        childrenDiscountEnabled, childPolicy?.childrenRatePercent ?? 0,
        fallbackNightly, rawOverrides ?? [],
      )
    // Defensa: `checkOut > checkIn` ya se validó, pero si las fechas no se pudieran parsear no se
    // puede cobrar 0 en silencio (mismo criterio que `public-rates.ts`). Caso borde no alcanzable
    // en uso normal — no vale la pena replicar el split de niños acá.
    : round2(fallbackNightly * nights)

  // ─── F2 2.5 — Upsells: validar ids contra el hotel y computar upsellsTotal ──────────
  // Defensa: si extraDeps.upsells no está cableado (compat F0 0.16 / callers viejos), no podemos
  // validar ids ni sumar precios, pero sí dejamos constancia en `notes` para el recepcionista
  // (HOOK F0 0.16 que se mantiene — los tests de checkout lo verifican). Cuando extraDeps SÍ está,
  // procesamos para valer: validamos ids, sumamos precios, y el summary lleva el total por línea.
  const upsellItems = Array.isArray(upsells) ? upsells.filter((u: any) => u && typeof u.id === 'string') : []
  let upsellsTotal = 0
  const upsellSummary: string[] = []
  // MR-10 (#275) — líneas cotizadas por `kind` (van tal cual a `priceBreakdown.upsells[]`).
  let upsellPricedLines: UpsellPricedLine[] = []
  // #269 — líneas resueltas (nombre, qty, unitario del catálogo) para materializarlas como
  // `ReservationAddons` en la tx de abajo.
  const upsellLines: BookingEngineUpsellInput[] = []
  if (upsellItems.length > 0 && extraDeps?.upsells) {
    const hotelUpsells = await extraDeps.upsells.findMany({ hotelId })
    // MR-10 (#275) — la matemática y los topes por `kind` viven en `resolveUpsellLines` (mismo
    // helper que `/booking/group`). Ids inexistentes/inactivos/de otro hotel se siguen ignorando
    // ahí adentro (no fail-fast). `persons` = quienes consumen el extra: adultos + niños con plaza
    // + niños libres, SIN bebés (un bebé no desayuna ni ocupa asiento en el transfer).
    const persons = childComposition.effectiveAdults + childComposition.payingChildren
      + (childComposition.freeChildren - childComposition.babies)
    const resolved = resolveUpsellLines(hotelUpsells, upsellItems as UpsellItem[], hotelId, { nights, rooms: 1, persons })
    if (!resolved.ok) {
      // Cantidad fuera del tope del kind → 400 tipado (mismo molde que `promo_invalid`): es
      // dinero que el huésped vio en pantalla, no se silencia clampeando. `max` le dice al widget
      // hasta cuánto puede pedir.
      return {
        status: 400,
        body: {
          error: resolved.error, upsellId: resolved.upsellId, name: resolved.name, kind: resolved.kind,
          quantity: resolved.quantity, max: resolved.max,
          message: `La cantidad de "${resolved.name}" (${resolved.quantity}) supera el máximo permitido (${resolved.max})`,
        },
      }
    }
    upsellPricedLines = resolved.lines
    upsellsTotal = resolved.total
    for (const line of upsellPricedLines) {
      // Texto para `notes`: "Desayuno×2p×3n=60.00" (ppn), "Parking×3n=45.00" (per_night),
      // "Transfer×2=30.00" (el resto) — el detalle estructurado va en `priceBreakdown.upsells`.
      const factor = line.persons !== undefined
        ? `×${line.persons}p×${line.nights}n`
        : line.kind === 'per_night' ? `×${line.nights}n` : `×${line.quantity}`
      upsellSummary.push(`${line.name}${factor}=${line.total.toFixed(2)}`)
      // #269 — `BookingEngineUpsellInput` solo conoce `{name, quantity, unitPrice}` y el folio
      // asienta `quantity × unitPrice`. Para que el cargo cuadre con lo cobrado SIN tocar
      // `booking-engine-addons.ts`, `quantity` lleva el multiplicador completo del kind
      // (cantidad × noches × personas) y `unitPrice` sigue siendo el unitario del catálogo:
      // desayuno ppn 10 × 2 personas × 3 noches → quantity 6, unitPrice 10, cargo 60.
      upsellLines.push({
        name: line.name,
        quantity: line.quantity * line.nights * (line.persons ?? 1),
        unitPrice: line.unitPrice,
      })
    }
  } else if (upsellItems.length > 0 && !extraDeps?.upsells) {
    // F0 0.16 — Sin repo de upsells, dejamos el resumen crudo (id×qty) para que el recepcionista
    // al menos vea qué pidió el huésped. No sumamos precios (no sabemos los values).
    logger?.warn('createPublicBookingDirect: upsells en el body sin extraDeps.upsells cableado — se persisten en notes sin precios', { hotelId })
    for (const item of upsellItems as UpsellItem[]) {
      upsellSummary.push(`${item.id}×${Math.max(1, Math.floor(Number(item.quantity) || 1))}`)
    }
  }

  // ─── REQ-01 (#233) — Amenidades infantiles: validar ids contra el catálogo y sumar ──────
  // Mismo criterio que los upsells de arriba: ids inexistentes/inactivos/de otro hotel se
  // ignoran (con warn); sin repo cableado no se puede validar ni sumar, así que se descartan.
  // quantity 1: esta reserva es UNA habitación. El snapshot congela el precio cotizado.
  let childAmenityLines: ChildAmenityLine[] = []
  let childAmenitiesTotal = 0
  if (requestedChildAmenityIds.length > 0 && extraDeps?.childAmenities) {
    const catalog = (await extraDeps.childAmenities.findMany({ hotelId })) as any[]
    const resolved = resolveChildAmenityLines(catalog ?? [], requestedChildAmenityIds, hotelId, 1, logger)
    childAmenityLines = resolved.lines
    childAmenitiesTotal = resolved.total
  } else if (requestedChildAmenityIds.length > 0 && !extraDeps?.childAmenities) {
    logger?.warn('createPublicBookingDirect: childAmenities en el body sin extraDeps.childAmenities cableado — se ignoran (no se puede validar ni cotizar)', { hotelId })
  }
  const childAmenitiesSummary = childAmenityLines.map((l) => `${l.name}=${l.total.toFixed(2)}`)

  // ─── F2 2.5 — Promo: validar upfront (read-only) ───────────────────────────────────
  // Si extraDeps.promoCodes no está, no procesamos (F0 0.16 behavior: persistimos el string
  // sin validarlo). Si está, validamos; si inválido, 400 con reason; si válido, descuento.
  let promoDiscount = 0
  let promoRecord: any = null
  let promoReason: string | undefined
  if (promoCode && extraDeps?.promoCodes) {
    const subtotal = roomSubtotal + upsellsTotal + childAmenitiesTotal + roomAmenitiesTotal + mealPlanTotal
    const result = await validatePromoCode(
      { promoCodes: extraDeps.promoCodes }, hotelId, String(promoCode), subtotal,
    )
    if (!result.valid) {
      return {
        status: 400,
        body: { error: 'promo_invalid', promoReason: result.reason ?? 'not_found' },
      }
    }
    promoDiscount = Number(result.discount) || 0
    // Re-lectura para tener id + uses + maxUses frescos (el increment atómico va en la tx).
    // result.code viene en upper-case (normalizado por validate).
    promoRecord = await extraDeps.promoCodes.findOne({ hotelId, code: result.code })
    // promoRecord podría ser null si el promo fue borrado entre validate y findOne (race
    // muy fina). Tratamos como "ya no aplica" — descuento 0 pero la reserva sigue.
    if (!promoRecord) {
      promoDiscount = 0
      promoReason = 'not_found'
    }
  }

  // ─── F2 2.5 — Cálculo del total con impuestos ──────────────────────────────────────
  // Orden: subtotal (room + upsells + amenidades niños + amenidades habitación + régimen) - promoDiscount = base imponible; taxes sobre base;
  // total = base + taxes. Mismo fallback que folios/facturas: configuration('taxes') y si
  // está vacío, hotels.taxRate.
  // Tarea 24 (#88): impuesto por impuesto (nombre, %, importe), con el MISMO lector y la MISMA
  // cuenta que `/rates` y que el widget: cada línea redondeada aparte, `taxes` = suma de líneas.
  // Así lo que el huésped ve fila por fila antes de pagar es exactamente lo que cobra Stripe.
  const subtotalBeforeDiscount = roomSubtotal + upsellsTotal + childAmenitiesTotal + roomAmenitiesTotal + mealPlanTotal
  const taxableBase = round2(Math.max(0, subtotalBeforeDiscount - promoDiscount))
  const hotelTaxes = extraDeps?.config
    ? await readHotelTaxes(extraDeps.config, hotelId, () => orm.findById('Hotels', hotelId))
    : []
  const taxBreakdown = taxLinesOn(taxableBase, hotelTaxes)
  const taxes = sumTaxLines(taxBreakdown)
  const totalAmount = round2(taxableBase + taxes)
  const totalBreakdown: TotalBreakdown = {
    subtotal: round2(subtotalBeforeDiscount),
    promoDiscount: round2(promoDiscount),
    upsellsTotal: round2(upsellsTotal),
    // MR-10 (#275) — por línea; se persiste en `priceBreakdown` y sale en la confirmación pública.
    upsells: upsellPricedLines,
    childAmenitiesTotal: round2(childAmenitiesTotal),
    roomAmenitiesTotal: round2(roomAmenitiesTotal),
    mealPlanTotal: round2(mealPlanTotal),
    taxes,
    taxBreakdown,
    total: totalAmount,
  }

  // Notas enriquecidas con el detalle de promo/upsells para el recepcionista (F0 0.16 + F2 2.5).
  const notesParts: string[] = ['Reserva desde widget público']
  if (typeof estimatedArrival === 'string' && estimatedArrival.trim()) {
    notesParts.push(`Llegada estimada: ${estimatedArrival.trim()}`)
  }
  // Tarea 3.1 (corrección 2026-08-22) — pedido especial del huésped, en texto libre.
  // Va PRIMERO entre los detalles (después de la llegada) a propósito: es lo único que el
  // recepcionista tiene que leer con atención antes de preparar la habitación; el resto de
  // `notesParts` (promo/upsells/total) es contabilidad, no una petición humana.
  if (typeof specialRequests === 'string' && specialRequests.trim()) {
    notesParts.push(`Pedido especial: ${specialRequests.trim()}`)
  }
  if (promoCode) notesParts.push(`Promo: ${promoCode}${promoReason ? ` (${promoReason})` : ''}`)
  if (upsellSummary.length > 0) notesParts.push(`Upsells: ${upsellSummary.join(', ')}`)
  // REQ-01 (#233) — el detalle estructurado vive en `childAmenities` (snapshot json); acá queda
  // el vistazo rápido para el recepcionista, igual que los upsells.
  if (childAmenitiesSummary.length > 0) notesParts.push(`Amenidades niños: ${childAmenitiesSummary.join(', ')}`)
  // REQ-01 (#290) — ídem para las amenidades personalizadas de la habitación (snapshot en
  // `roomAmenities`; acá solo el vistazo rápido).
  if (roomAmenitiesSummary.length > 0) notesParts.push(`Amenidades habitación: ${roomAmenitiesSummary.join(', ')}`)
  // MR-03 (#268) — el snapshot vive en `mealPlan*` (columnas propias); acá el vistazo rápido.
  if (mealPlanLine) notesParts.push(mealPlanNote(mealPlanLine))
  // Tarea 22 — el detalle estructurado vive en needsCrib/cribCount (columnas propias, ver
  // reservas/model.ts), pero también queda acá para que el recepcionista lo vea de un vistazo en
  // las notas, igual que el resto de los extras de esta reserva. Sí/No únicamente (2026-09-09) —
  // sin cantidad, `cribCount` es siempre 1 cuando `needsCrib` es true.
  if (needsCrib) notesParts.push('Cuna: solicitada')
  notesParts.push(`Total: ${totalAmount.toFixed(2)} (subtotal ${subtotalBeforeDiscount.toFixed(2)}` +
    `${promoDiscount > 0 ? ` - promo ${promoDiscount.toFixed(2)}` : ''} + tax ${taxes.toFixed(2)})`)

  // ─── Transacción: guest + reservation + (promo uses++) ─────────────────────────────
  // Atomicidad (spec F2 2.5): si la creación de la reserva falla, NO se incrementa uses.
  // El incremento va AL FINAL de la tx, después de crear la reserva. Race concurrente
  // (dos widgets con el mismo promo maxUses=1): la re-lectura dentro de la tx detecta si
  // uses ya alcanzó maxUses y aborta con PromoUsesExhaustedError → 409 para el segundo.
  let reservation: any
  let guest: any
  try {
    await orm.transaction(async (tx: any) => {
      // ─── Anti-overbooking ────────────────────────────────────────────────────────────────
      // El chequeo de solape de arriba pasa FUERA de la transacción, y entre ese chequeo y este
      // insert hay una ventana: dos huéspedes que aprietan "Pagar" a la vez pasan los dos y se
      // crean DOS reservas sobre la misma habitación y fechas (reproducido con un harness que
      // congela al primero justo después de su chequeo: ambos devolvían 201).
      //
      // Se cierra con el MISMO patrón que ya usaba el promo unas líneas más abajo: un UPDATE
      // condicional sobre la fila de la habitación. En Postgres READ COMMITTED ese UPDATE toma
      // el lock de fila, así que la segunda transacción se bloquea hasta que la primera
      // commitea y entonces su filtro por `updatedAt` ya no matchea → `affected = 0` → aborta.
      // Es lo que serializa a los dos compradores por habitación; una re-lectura sola no
      // alcanza (en READ COMMITTED ninguna de las dos ve la fila no commiteada de la otra).
      //
      // Sin `updateMany` (mocks viejos, ORMs sin soporte) se degrada a la re-lectura: no cubre
      // la carrera real pero mantiene el comportamiento previo en lugar de romper al caller.
      // El UPDATE es para SERIALIZAR, no para juzgar: toma el lock de la fila y hace esperar a
      // la otra transacción. Quien decide es la re-lectura de abajo. Si acá abortáramos por
      // `affected === 0` daríamos falsos positivos (basta que alguien haya editado la
      // habitación por otro motivo para que el sello ya no matchee y rechacemos una venta
      // legítima).
      if (typeof tx.updateMany === 'function') {
        await tx.updateMany('Rooms', { id: resolvedRoomId }, { updatedAt: new Date().toISOString() })
          .catch(() => 0)
      }
      // Con el lock tomado, re-leer el solape: acá sí vemos lo que commiteó quien llegó primero.
      const freshOverlap = (await tx.findMany?.('Reservations', { roomId: resolvedRoomId }).catch(() => [])) ?? []
      const takenNow = (freshOverlap as any[]).some((r: any) =>
        r.status !== 'cancelled' && r.status !== 'no_show' && r.checkIn < checkOut && r.checkOut > checkIn)
      if (takenNow) throw new RoomTakenConcurrentlyError()

      // MR-08 (#273) — un huésped = una ficha: se busca por email/teléfono normalizados y solo se
      // crea si no existe. El lock de fila `Hotels` que toma el helper y la búsqueda van DENTRO de
      // esta misma tx. Orden de locks: siempre Rooms (arriba) → Hotels (acá); nadie hace el inverso.
      const guestMatch = await findOrCreateGuest(
        { guests: guestsOnTx(tx), lockTx: tx },
        { hotelId, name: guestName, email: guestEmail, phone: guestPhone },
      )
      guest = guestMatch.guest
      // F0 0.13 — AccessToken público (UUID). Solo el flujo público lo setea; las reservas
      // creadas desde `/api/panel/reservas` NO lo reciben → `accessToken=null` → 404 en el
      // endpoint público (anti-enumeración IDOR, spec booking-unification D4).
      // REQ-RWP-04 — `source: 'web'` distingue la reserva del widget web de la carga en recepción
      // (`/api/panel/reservas` deja el default 'direct'); `channel` sigue 'direct' porque los
      // reportes de directas cuentan por `channel` (reservas/usecases/booking-engine.ts).
      reservation = await tx.create('Reservations', {
        id: crypto.randomUUID(), hotelId, roomId: resolvedRoomId, guestId: guest.id,
        checkIn, checkOut, status: 'pending', source: 'web', channel: 'direct',
        adults: childComposition.effectiveAdults,
        children: hasChildrenAges ? childComposition.payingChildren + childComposition.freeChildren : (kids || 0),
        // MR-10 (#275): con `children` plano acá van las edades SINTETIZADAS a `maxChildAge` — se
        // persisten a propósito, porque son la base del precio que el huésped pagó: sin ellas un
        // reagendado/repricing (`composeFromPersistedReservation`) volvería a cotizar por adultos y
        // reabriría la diferencia de totales que MR-10 cierra.
        childrenAges: hasChildrenAges ? childrenAgesInput : [],
        // Requerimiento 12 (edad de referencia, 2026-09-03) — ancla temporal de `childrenAges`:
        // el check-in VIGENTE al declarar las edades. Sin esto no hay forma de proyectar la edad
        // a un check-in futuro tras un reagendado (ver `child-composition.ts#projectAge`).
        childrenAgesAsOf: hasChildrenAges ? checkIn : undefined,
        // Tarea "Cobro % niños" — el % REALMENTE usado para cotizar esta reserva (o `null` si la
        // regla no aplicó), independiente de lo que diga `configuration` de acá en más.
        childrenRatePercentApplied,
        // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — ya gateados/validados
        // arriba contra `childComposition.babies` y `childPolicy.cribAvailable`; acá solo persisten.
        needsCrib, cribCount,
        // REQ-01 (#233) — snapshot con precio congelado de las amenidades infantiles de ESTA
        // habitación (ya validadas/gateadas arriba) + su total, que ya está dentro de `totalAmount`.
        childAmenities: childAmenityLines,
        childAmenitiesTotal: round2(childAmenitiesTotal),
        // REQ-01 (#290) — snapshot con precio congelado de las amenidades personalizadas de la
        // habitación ASIGNADA (validadas arriba contra sus filas `RoomAmenities`) + su total.
        roomAmenities: roomAmenityLines,
        roomAmenitiesTotal: round2(roomAmenitiesTotal),
        // MR-03 (#268) — snapshot congelado del régimen (precio releído del catálogo arriba) +
        // su total, ya dentro de `totalAmount`. `regime` lleva el mismo código para que el
        // modal/listado del panel (campo manual preexistente) lo muestren sin cambios.
        mealPlan: mealPlanLine?.code ?? ROOM_ONLY_CODE,
        mealPlanPriceMode: mealPlanLine?.priceMode ?? null,
        mealPlanUnitPrice: mealPlanLine?.unitPrice ?? 0,
        mealPlanTotal: round2(mealPlanTotal),
        regime: mealPlanLine?.code ?? ROOM_ONLY_CODE,
        totalAmount, deposit: 0,
        // Tarea 24 (#88): el desglose que el huésped vio y aceptó se guarda con la reserva, para
        // que la confirmación (y cualquier pantalla posterior) muestre lo mismo que el paso de
        // pago — no un total pelado que nadie puede reconstruir.
        priceBreakdown: totalBreakdown,
        notes: notesParts.join(' | '),
        accessToken: crypto.randomUUID(),
        // F2 2.5 — persistimos el promoCode validado (upper-case). Upsells van en `notes`
        // (no hay tabla puente reservation_upsells en este cambio).
        promoCode: promoCode ? String(promoCode).trim().toUpperCase() : undefined,
        // Tarea 3.4 (corrección 2026-08-25) — "Confirmación instantánea" apagada: la reserva
        // pública igual se paga y ocupa la habitación (status/overlap sin cambios — el cuarto
        // está bloqueado), pero queda pendiente de que el hotel la revise antes de darla por
        // buena. Eje INDEPENDIENTE de `status`: a propósito, para no tocar ningún chequeo de
        // solape/ocupación/reportes que ya filtra por `status`. Solo aplica a reservas
        // públicas — una reserva cargada a mano por el hotel no necesita que el hotel se
        // apruebe a sí mismo (ver `reservas/usecases/create.ts`, sin tocar).
        approvalStatus: bookingConfig?.instantConfirmation === false ? 'pending' : undefined,
        // #266 — Límite para pagar: ahora + booking_config.pendingTtlMinutes (default 60). El cron
        // `shared/usecases/pending-payment-expiry.ts` cancela con `payment_timeout` lo que siga
        // pending pasado este instante; `null` (reservas del panel) nunca vence.
        paymentDeadlineAt: resolvePaymentDeadlineAt(bookingConfig),
        // #266 — Clave de idempotencia del widget (única por hotel, ver migrate-db.ts).
        idempotencyKey: idempotencyKey ?? undefined,
      })

      // #269 — Cada extra pagado online queda como fila `ReservationAddons` (source
      // booking_engine, fuera del total cobrable: su importe YA está en `totalAmount`). Misma tx
      // que la reserva: o se crean todas o ninguna. `notes`/`priceBreakdown` no cambian.
      // MR-03 (#268) — el régimen también: sin su fila el folio nacía sin lo que Stripe cobró.
      const addonRows = buildBookingEngineAddons({
        reservationId: reservation.id, hotelId, taxRate: totalTaxRateOf(hotelTaxes),
        upsells: upsellLines, childAmenities: childAmenityLines, roomAmenities: roomAmenityLines,
        mealPlans: mealPlanLine ? [mealPlanAddonInput(mealPlanLine)] : [],
      })
      for (const row of addonRows) await tx.create('ReservationAddons', row)

      // F2 2.5 — Incremento atómico de promo.uses DENTRO de la tx. Re-lectura para detectar
      // races concurrentes. Si se agotó entre validate y commit, aborta (rollback de guest +
      // reservation, no se incrementa). El caller atrapa el centinela y devuelve 409.
      //
      // B2 fix (audit solmi-direct-booking) — Optimistic locking: el UPDATE condicional filtra
      // por `id AND uses=freshUses`. Si otra tx concurrente ya incrementó `uses` entre nuestra
      // re-lectura (findOne arriba) y este UPDATE, el filter no matchea → affected=0 → aborta
      // con el centinela (rollback total). En SQLite las tx son seriales (WAL), pero en
      // Postgres READ COMMITTED este filter es lo que previene la race TOCTOU real: 2 tx que
      // leyeron uses=0, solo 1 logra `UPDATE WHERE uses=0`; la otra ve affected=0 y aborta.
      // `tx.updateMany` devuelve `result.changes` (filas afectadas); fallback a `update` para
      // mocks/ORMs viejos sin updateMany (en ese caso no se detecta la race, equivalente al
      // comportamiento pre-fix en tests que usan mocks simples).
      if (promoRecord) {
        const fresh = await tx.findOne?.('PromoCodes', { id: promoRecord.id }).catch(() => null) ?? promoRecord
        const freshUses = Number(fresh?.uses ?? promoRecord.uses ?? 0)
        const maxUses = fresh?.maxUses ?? promoRecord.maxUses
        if (typeof maxUses === 'number' && Number.isFinite(maxUses) && freshUses >= maxUses) {
          throw new PromoUsesExhaustedError()
        }
        const newUses = freshUses + 1
        const optimisticFilter: Record<string, unknown> = { id: promoRecord.id, uses: freshUses }
        const affected = typeof tx.updateMany === 'function'
          ? await tx.updateMany('PromoCodes', optimisticFilter, { uses: newUses })
          : (await tx.update('PromoCodes', promoRecord.id, { uses: newUses }) ? 1 : 0)
        if (affected === 0) throw new PromoUsesExhaustedError()
      }
    })
  } catch (e: any) {
    if (e instanceof RoomTakenConcurrentlyError) {
      logger?.warn(`Habitación ${resolvedRoomId} tomada concurrentemente — reserva abortada`, { hotelId })
      return { status: 409, body: { error: 'Habitación no disponible en esas fechas' } }
    }
    if (e instanceof PromoUsesExhaustedError) {
      logger?.warn(`Promo ${promoCode} agotado concurrentemente para hotel ${hotelId}`, { reservationId: reservation?.id })
      return { status: 409, body: { error: 'promo_invalid', promoReason: 'max_uses_reached' } }
    }
    // #266 — Dos POST simultáneos con la misma key: el primero commiteó entre nuestra búsqueda
    // inicial y este insert, y el índice único (hotelId, idempotencyKey) rechazó al segundo.
    // No es un error del huésped: se relee la fila ganadora y se responde el mismo replay 200.
    if (idempotencyKey && isUniqueViolation(e)) {
      const existing = await orm.findOne('Reservations', { hotelId, idempotencyKey })
      if (existing) {
        logger?.warn('Reserva pública duplicada por idempotencyKey concurrente — replay', { hotelId, reservationId: existing.id })
        return replayPublicBooking(orm, existing, stripe, logger, stripeUrls)
      }
    }
    // Otros errores de la tx: relanzar como antes (el controller pasa a 500 si no se atrapa).
    throw e
  }

  pushAvailability?.(hotelId, resolvedRoomId)

  // F0 0.16 — Cableo del checkoutUrl. ROBUSTEZ: si Stripe falla (no configurado, gateway
  // caído), la reserva SE CREÓ igual. Devolvemos 201 con checkoutUrl:null + paymentError.
  // El huésped al menos tiene su reserva; el panel la ve como "pending".
  const { checkoutUrl, paymentError } = await createCheckoutSafely(
    stripe, stripeUrls, reservation.id, totalAmount, hotelId, logger,
  )

  return publicBookingResponse(201, reservation, guest, checkoutUrl, totalBreakdown, paymentError)
}

/**
 * F0 0.16 — Crea la Checkout Session sin dejar que un fallo de Stripe tumbe la respuesta: la
 * reserva YA existe; lo peor que podemos hacer es tirar 500 y que el huésped crea que no se hizo.
 * Devuelve `checkoutUrl: null` + `paymentError` cuando la pasarela falla o no está cableada.
 */
async function createCheckoutSafely(
  stripe: PublicBookingStripeDeps | undefined,
  stripeUrls: { successUrl: string; cancelUrl: string } | undefined,
  reservationId: string,
  amount: number,
  hotelId: string,
  logger?: PublicBookingLogger,
): Promise<{ checkoutUrl: string | null; paymentError: string | null }> {
  if (!stripe || !stripeUrls) return { checkoutUrl: null, paymentError: null }
  try {
    const session = await stripe.createReservationCheckout(reservationId, amount, stripeUrls.successUrl, stripeUrls.cancelUrl)
    return { checkoutUrl: session.url || null, paymentError: null }
  } catch (e: any) {
    // NO relanzar — robustez F0.
    const paymentError: string = e?.message || 'payment_gateway_unavailable'
    logger?.warn(
      `Reserva ${reservationId} creada pero Stripe falló — checkoutUrl null, paymentError="${paymentError}"`,
      { hotelId, reservationId },
    )
    return { checkoutUrl: null, paymentError }
  }
}

/**
 * #266 — Replay idempotente: la reserva ya existe para esta (hotelId, idempotencyKey). No se crea
 * nada; se devuelve la MISMA forma que el 201 con `status: 200` y `replayed: true`, para que el
 * widget siga su flujo normal (guardar reservationId/accessToken y redirigir a `checkoutUrl`).
 *
 * `checkoutUrl` se vuelve a pedir a Stripe con el mismo reservationId: `createReservationCheckout`
 * manda `Idempotency-Key: reservationId`, así que Stripe devuelve la MISMA sesión del primer POST
 * (no cobra dos veces). Si esa sesión ya expiró en Stripe, no hay forma de forzar una nueva sin
 * variar la key (el service no lo admite hoy): el cron vence la reserva por `paymentDeadlineAt`
 * y el huésped vuelve a reservar. Una reserva ya `cancelled` (vencida por el cron o por
 * `checkout.session.expired`) no se "revive": 409 `reservation_expired`.
 */
async function replayPublicBooking(
  orm: any,
  existing: any,
  stripe?: PublicBookingStripeDeps,
  logger?: PublicBookingLogger,
  stripeUrls?: { successUrl: string; cancelUrl: string },
): Promise<any> {
  if (existing.status === 'cancelled') return { status: 409, body: { error: 'reservation_expired' } }
  const guest = existing.guestId
    ? await Promise.resolve(orm.findById?.('Guests', existing.guestId)).catch(() => null) ?? null
    : null
  const { checkoutUrl, paymentError } = await createCheckoutSafely(
    stripe, stripeUrls, existing.id, Number(existing.totalAmount) || 0, String(existing.hotelId ?? ''), logger,
  )
  const totalBreakdown = safeParse(existing.priceBreakdown) ?? null
  return publicBookingResponse(200, existing, guest, checkoutUrl, totalBreakdown, paymentError, true)
}

function publicBookingResponse(
  status: 200 | 201,
  reservation: any,
  guest: any,
  checkoutUrl: string | null,
  totalBreakdown: TotalBreakdown | null,
  paymentError: string | null,
  replayed = false,
): any {
  return {
    status,
    body: {
      // B-6/H-4 (auditoría 2026-08-19): allow-list estricta — las filas crudas arrastraban
      // campos internos (ownerNotes, otaNotes, card*, snapshot financiero, document del
      // guest). El contrato del widget consume reservation.{id, accessToken} y los tests
      // del módulo verifican comportamiento vía los campos operativos del subset de abajo
      // (roomId resuelto, promoCode persistido, etc.) — nada interno sale.
      reservation: {
        id: reservation.id,
        accessToken: reservation.accessToken,
        roomId: reservation.roomId,
        guestId: reservation.guestId,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        status: reservation.status,
        adults: reservation.adults,
        children: reservation.children,
        totalAmount: reservation.totalAmount,
        currency: reservation.currency,
        promoCode: reservation.promoCode ?? null,
        source: reservation.source ?? null,
      },
      guest: guest ? { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone ?? '' } : null,
      // F0 0.16 — Contrato nuevo (spec booking-unification API). `checkoutUrl` SIEMPRE está:
      // null cuando no se intentó cobro (sin stripe deps / sin URLs) o cuando Stripe falló.
      // `paymentError` solo se incluye si realmente hubo un error de pasarela (para que el
      // frontend pueda mostrarlo al huésped o logearlo).
      checkoutUrl,
      // F2 2.5 — Desglose del total para que el widget muestre el detalle y Stripe cobre el
      // total correcto. Siempre se devuelve (aunque no haya promo/upsells, los importes van
      // en 0) para que el frontend tenga un contrato estable.
      totalBreakdown,
      ...(paymentError !== null ? { paymentError } : {}),
      // #266 — solo en el replay idempotente (misma key, mismo hotel): el widget puede distinguir
      // "te devolví la que ya tenías" de "creé una nueva" sin cambiar el resto del contrato.
      ...(replayed ? { replayed: true } : {}),
    },
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** #266 — Tope de la clave de idempotencia (columna TEXT; el índice único la indexa entera). */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128

/**
 * #266 — Normaliza `body.idempotencyKey`: string no vacía, recortada a 128 chars. Cualquier otra
 * cosa (número, objeto, vacío) se ignora → `null` = la reserva se crea sin key (comportamiento
 * previo: cada POST crea una reserva nueva).
 */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.slice(0, IDEMPOTENCY_KEY_MAX_LENGTH)
}

/**
 * #266 — `paymentDeadlineAt` (ISO) = ahora + `booking_config.pendingTtlMinutes`. Config ausente,
 * `null` o inválida (filas previas a #266, mocks de tests) → `DEFAULT_PENDING_TTL_MINUTES`.
 */
export function resolvePaymentDeadlineAt(bookingConfig: any, now: Date = new Date()): string {
  const raw = Number(bookingConfig?.pendingTtlMinutes)
  const ttl = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PENDING_TTL_MINUTES
  return new Date(now.getTime() + ttl * 60_000).toISOString()
}

/**
 * #266 — Violación del índice único (hotelId, idempotencyKey) en SQLite ("UNIQUE constraint
 * failed") o Postgres (código 23505 / "duplicate key"). Mismo criterio que
 * `folios/usecases/folio-entries.ts#isDuplicateError`.
 */
export function isUniqueViolation(e: unknown): boolean {
  const code = String((e as any)?.code ?? '')
  const msg = String((e as any)?.message ?? e).toLowerCase()
  return code === '23505'
    || msg.includes('unique constraint')
    || msg.includes('duplicate key')
    || msg.includes('idx_reservations_hotel_idempotency')
}
