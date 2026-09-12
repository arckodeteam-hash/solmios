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
//   - `totalBreakdown`: { subtotal, promoDiscount, upsellsTotal, upsells[], roomAmenitiesTotal,
//     taxes, total } se devuelve en la respuesta para que el widget muestre el detalle y Stripe
//     cobre el `total`.
//   - `roomAmenities` (REQ-01 #290): keys `custom:*` de las amenidades PERSONALIZADAS de la
//     habitación (filas `RoomAmenities` con name/price). El catálogo es POR HABITACIÓN FÍSICA,
//     pero la reserva nace sin unidad (REQ-HAC-05): se resuelve contra la UNIÓN de las unidades
//     vendibles del tipo y se cobra el precio real de esa fila — el más barato si dos la ofrecen
//     (nunca el del body). Ver `public-room-amenities.ts`.
//   - `needsCrib` (#292): la cuna ES la amenidad personalizada `custom:cuna` de la habitación
//     (`CRIB_AMENITY_KEY`). Sí/No; sólo cuenta si la composición tiene un bebé Y alguna unidad
//     del tipo la publica. "Sí" fuerza esa key en `roomAmenities` (y se cobra SU precio); "No" la
//     quita aunque el body la mande. `needsCrib`/`cribCount` (1/0) se persisten como espejo EXACTO
//     de esa línea: `needsCrib === (roomAmenities tiene custom:cuna)`, decidido después de resolverla.
//   - `childAmenities` en el body se IGNORA (#292: el catálogo global `child_amenities` se dio de
//     baja). `Reservations.childAmenities`/`childAmenitiesTotal` y `priceBreakdown.
//     childAmenitiesTotal` se siguen escribiendo como `[]`/`0` para que los lectores de reservas
//     históricas (panel, housekeeping, folio) no tengan que distinguir épocas.
//
// Robustez F0 (pagos en prod, spec booking-unification §"PRECAUCIÓN CRÍTICA"):
//   Si `gw.createCharge` falla (hotel sin Stripe configurado, gateway caído, error de red,
//   secret inválido), la reserva SE CREA igual con status='pending' y se devuelve 201 con
//   `checkoutUrl: null` + `paymentError: <mensaje>`. El huésped al menos tiene su reserva; el
//   panel la muestra como "pendiente de pago". NO tirar 500: rompería la creación de reserva
//   por un problema de Stripe, que es una dependencia opcional por hotel.
//
// REQ-HAC-05 (#260) — La reserva del widget nace POR TIPO, sin unidad (`roomId: null`):
//   Antecedente (FIX 2026-07-30): `public-rates.ts` no tiene entidad RoomType propia — el `id`
//   que publica por tipo ES el string `room.type` ("double"), y el widget lo mandaba como
//   `roomId` → 404 siempre. Desde entonces el guest elige un TIPO y el backend resolvía la
//   unidad física al crear. Con HAC-01/02 (#256/#257) la habitación se asigna al check-in
//   (`reservas/usecases/assign-room.ts`) y la disponibilidad se cuenta por tipo, así que elegir
//   unidad acá era trabajo de más y la fuente del overbooking cruzado con las OTAs (una unidad
//   "elegida" acá que la ingesta también asignaba).
//   Decisión de diseño: el widget NO asigna habitación. La fila se crea con `roomType` (string
//   = `rooms.type`) y `roomId: null`; la unidad la elige recepción después.
//     - Entrada: `roomType`. Compat: si el body trae `roomId` y resuelve a una fila real de
//       `Rooms`, se deriva `roomType = room.type` (y se valida que sea del hotel) — pero la
//       reserva IGUAL nace sin unidad. Sin tipo resoluble → 404 "Habitación no encontrada";
//       tipo sin inventario en el hotel → 404 "Tipo de habitación no encontrado".
//     - Venta: SOLO `availableOfType` (`shared/usecases/type-availability.ts`): `rooms − booked`
//       por noche contando reservas del tipo asignadas O sin asignar, más los bloqueos de sus
//       unidades. `available < 1` → 409. Un tipo con la tarifa cerrada (stop-sell) → 409.
//     - Capacidad: se valida contra el "perfil del tipo" — el máximo `capacity`/`maxAdults`/
//       `maxChildren` entre las unidades vendibles (o la política `room_type_capacity` si el
//       hotel la configuró). Si no entra en ninguna unidad del tipo → 409.
//     - Precio: la tarifa sale por tipo (`baseRates`/`pickRate`), con fallback al MÍNIMO
//       `basePrice` entre las unidades vendibles — lo mismo que `/rates` publica como "desde".
//     - Amenidades de habitación (#290) y cuna (#292): el catálogo es la UNIÓN de `RoomAmenities`
//       de las unidades vendibles del tipo (misma key → la más barata). `cribUnavailable` = ninguna
//       unidad del tipo ofrece la cuna.
//     - Concurrencia: dentro de la tx se lockean las unidades del tipo (UPDATE sobre
//       `Rooms {hotelId, type}`) y se REPITE `availableOfType` con el lock tomado; si ya no entra
//       → 409 y rollback.
//     - Push a las OTAs por TIPO (`pushAvailabilityByType`), no por unidad.

import { safeParse } from '../../../shared/utils/safe-parse'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import { availableOfType, typeAvailabilityPortFromOrm } from '../../../shared/usecases/type-availability'
import { findOrCreateGuest, guestsOnTx } from '../../../shared/usecases/find-or-create-guest'
import type { RepositoryAdapter } from 'arckode-framework'
import { readHotelTaxes, taxLinesOn, sumTaxLines, type TaxLine } from './hotel-taxes'
import { validate as validatePromoCode } from '../../promo-codes/usecases/promo-validate'
import { closedRoomTypes, isRoomTypeClosed, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate, sumStayPriceForComposition } from './rate-resolution'
import { MAX_STAY_NIGHTS } from '../validators/schema'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'
import { DEFAULT_PENDING_TTL_MINUTES } from './config'
import { resolveChildPolicy, resolveChildComposition, fitsRoomCapacity, freeChildrenLimitError } from '../../../shared/usecases/child-composition'
import { resolveRoomTypeCapacityMap, effectiveRoomCapacity } from '../../../shared/usecases/room-type-capacity'
import { CRIB_AMENITY_KEY, customRoomAmenities, hasCribLine, normalizeRoomAmenityKeys, loadRoomAmenitiesFor, resolveRoomAmenityLines, type RoomAmenityLine } from './public-room-amenities'
import { isCribAmenityKey } from '../../../shared/usecases/crib-amenity'
import { round2 } from '../../../shared/utils/money'
import { resolveMealPlanLine, ROOM_ONLY_CODE, type MealPlanLine } from './public-meal-plan-lines'
import { MEAL_PLAN_LABELS } from '../../../shared/usecases/meal-plan-labels'
import { buildBookingEngineAddons, totalTaxRateOf, type BookingEngineUpsellInput, type BookingEngineMealPlanInput } from '../../../shared/usecases/booking-engine-addons'
import { resolveUpsellLines, type UpsellPricedLine } from './upsell-pricing'

const MS_PER_DAY = 86_400_000

/** MR-03 (#268) — etiqueta ES del régimen para `notes` (vistazo rápido del recepcionista). Se
 *  reusa desde public-booking-group.ts. Un código desconocido cae al código crudo. */
export const MEAL_PLAN_LABEL: Record<string, string> = MEAL_PLAN_LABELS.es

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
 * F2 2.5 — Deps opcionales para procesar `promoCode` y `upsells`. Si no se pasan, el usecase
 * funciona como antes (F0 0.16: persiste los campos sin validarlos). El controller los cablea
 * desde index.ts; los tests legacy que llaman con 2 args siguen funcionando (sin promo procesing).
 */
export interface PublicBookingExtraDeps {
  /** Repo de `promo_codes` para validar + incrementar uses. */
  promoCodes?: RepositoryAdapter<any>
  /** Repo de `upsells` para validar ids + computar upsellsTotal. */
  upsells?: RepositoryAdapter<any>
  /** MR-03 (#268) — Repo de `MealPlans` (tabla `meal_plans`) para resolver el `mealPlan` del body
   *  contra el catálogo activo del hotel + computar `mealPlanTotal`. Sin repo cableado un
   *  `mealPlan` distinto de `room_only` se RECHAZA (`meal_plan_unavailable`): no se puede
   *  validar y cambia el precio que el huésped vio. */
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
  /** room.basePrice × nights + upsellsTotal + roomAmenitiesTotal + mealPlanTotal (antes de promo e impuestos). */
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
  /** #292 — SIEMPRE 0 en reservas nuevas: el catálogo global de amenidades infantiles (REQ-01
   *  #233) se dio de baja. Se conserva en el tipo porque `priceBreakdown` de reservas anteriores
   *  lo trae con importe y los lectores (confirmación pública, modal del panel) lo suman. */
  childAmenitiesTotal: number
  /** REQ-01 (#290) — Σ amenidad.price × unidades de las amenidades PERSONALIZADAS del tipo
   *  vendido (`RoomAmenities` custom de sus unidades), INCLUIDA la cuna (`custom:cuna`, #292) cuando
   *  `needsCrib`. 0 si no se pidió ninguna. Ya incluido en `subtotal`. */
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
 * Error centinela para abortar cuando el TIPO se agotó entre nuestro `availableOfType` de afuera y
 * el insert (REQ-HAC-05). Mismo mecanismo que el del promo: se atrapa afuera de la tx y devuelve 409.
 */
class RoomTypeSoldOutConcurrentlyError extends Error {
  constructor() { super('room_type_sold_out_concurrently'); this.name = 'RoomTypeSoldOutConcurrentlyError' }
}

/**
 * Error centinela para abortar la transacción cuando el promo se agotó concurrentemente
 * (alguien más lo usó entre la validación upfront y el commit). No se relanza — se atrapa
 * afuera de la tx y se devuelve 409 con `promoReason: 'max_uses_reached'`.
 */
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
 *                       `roomType` (al menos uno) + datos del guest + fechas. REQ-HAC-05 (#260):
 *                       la reserva nace por TIPO sin unidad; un `roomId` real (fila existente de
 *                       `Rooms`) sólo sirve para derivar el tipo (compat, ver cabecera).
 * @param pushAvailability (Legado) Push de disponibilidad POR UNIDAD. Desde REQ-HAC-05 la reserva
 *                       nace sin unidad, así que acá NO se invoca; se conserva en la firma para no
 *                       romper a los callers (controller/tests) que lo pasan posicionalmente.
 * @param auth           Wrapper de auth (solo para assertOwnership del room en el path `roomId`).
 * @param stripe         (F0 0.16) Servicio que crea la Checkout Session. Si no se pasa, la
 *                       reserva se crea igual sin intentar cobro (compat con callers viejos
 *                       como `reservas/tests/ownership.test.ts` que no pasan este arg).
 * @param logger         (F0 0.16) Logger para avisar si Stripe falla (no rompe el flujo).
 * @param stripeUrls     (F0 0.16) URLs de success/cancel. Si no se pasan, no se intenta cobro.
 *                       El controller las arma desde el referer/host del request en F0 wiring.
 * @param extraDeps      (F2 2.5) Repos para promo/upsells/régimen/config. Ver `PublicBookingExtraDeps`.
 * @param pushAvailabilityByType REQ-HAC-05 — push de disponibilidad a las OTAs POR TIPO
 *                       (`canales.pushAvailabilityByRoomType`). Es el que se invoca al crear.
 */
export async function createPublicBookingDirect(
  orm: any,
  body: any,
  _pushAvailability?: (hotelId: string, roomId: string) => void,
  auth?: any,
  stripe?: PublicBookingStripeDeps,
  logger?: PublicBookingLogger,
  stripeUrls?: { successUrl: string; cancelUrl: string },
  // F2 2.5 — Deps para procesar promo + upsells. Opcional para no romper tests legacy
  // (que llaman con 2 args) ni callers viejos que todavía no cablean estos repos.
  extraDeps?: PublicBookingExtraDeps,
  pushAvailabilityByType?: (hotelId: string, roomType: string) => void,
): Promise<any> {
  const {
    hotelId, roomId, roomType: rawRoomType, guestName, guestEmail, guestPhone,
    checkIn, checkOut, adults, children: kids,
    // Feature adultos+niños+edades (2026-09-02). Lo manda el widget nuevo. MR-10 (#275): un
    // caller que solo manda `children` como contador plano YA NO se queda afuera del motor de
    // niños — se le sintetizan edades a `maxChildAge` (Opción A, ver más abajo).
    childrenAges: rawChildrenAges,
    // F2 2.5 — promoCode + upsells ahora se PROCESAN (F0 0.16 solo los persistía).
    promoCode,
    upsells,
    // REQ-01 (#290) — amenidades personalizadas de la habitación: `[{key: 'custom:<slug>'}]`. Se
    // resuelven contra la UNIÓN de filas `RoomAmenities` de las unidades del tipo (precio del server).
    // (#292: `childAmenities` en el body ya no se lee — el catálogo global se dio de baja.)
    roomAmenities: rawRoomAmenities,
    // MR-03 (#268) — código del régimen elegido para ESTA habitación. Se resuelve contra
    // `meal_plans` del hotel (precio del server) después de conocer la composición y las noches.
    mealPlan: rawMealPlan,
    // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09) — Sí/No únicamente; solo tiene efecto
    // si la composición tiene al menos un bebé (Tarea 21) Y el tipo ofrece `custom:cuna` (#292);
    // ver el gateo más abajo, cuando ya se conocen las unidades vendibles del tipo.
    needsCrib: rawNeedsCrib,
    // Tarea 3.1 — hora de llegada estructurada + pedidos especiales en texto libre. Antes
    // de este cambio ninguno de los dos llegaba acá: el schema no los declaraba y
    // validateSchema los descartaba en el controller en silencio.
    estimatedArrival,
    specialRequests,
    // #266 — clave de idempotencia del widget (opcional). Ver `normalizeIdempotencyKey`.
    idempotencyKey: rawIdempotencyKey,
  } = body

  if (!hotelId || (!roomId && !rawRoomType) || !guestName || !guestEmail || !checkIn || !checkOut) {
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

  // ─── FIX (stop-sell) — paridad con AvailabilityUseCase y /calendar ───────────────────
  // El motor ya no OFRECE un tipo con la tarifa cerrada; el POST tampoco lo ACEPTA. Sin esto el
  // gate sería puramente cosmético: un integrador (o un submit con datos stale) podía crear la
  // reserva igual sobre inventario que el hotel cerró. Los bloqueos (`room_blocks`) los descuenta
  // `availableOfType` por tipo (REQ-HAC-02) — acá ya no se leen aparte.
  // Las lecturas son sobre modelos COMPARTIDOS (`shared/models.ts`) — mismo criterio de
  // acceso que `Rooms`/`Reservations` acá arriba, sin import cross-module.
  const stayNightDates = stayNights(checkIn, checkOut)
  const [rawRates, rawAssignments, rawOverrides, rawSeasons] = await Promise.all([
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

  // ─── Cuna (Tarea 22, simplificada 2026-09-09; por habitación desde #292) — gateo por bebé ──
  // El composer del frontend ya oculta "¿Necesita cuna?" sin un bebé en la composición o si el
  // tipo no publica `custom:cuna`, pero el servidor NUNCA confía en lo que mande el cliente
  // (mismo criterio que cualquier otro campo de esta reserva): sin al menos un bebé clasificado
  // (Tarea 21) se fuerza a "no pedida" sin importar el body. La segunda mitad del gate — ¿alguna
  // unidad del TIPO ofrece `custom:cuna`? — se resuelve más abajo, DESPUÉS de
  // `resolveRoomAmenityLines` contra la unión del tipo (`needsCrib` definitivo = quedó la línea).
  // Simplificación (2026-09-09): "¿Necesita cuna?" es SOLO Sí/No — no existe cantidad de cunas
  // configurable ("no preguntar si desea una, dos o más cunas"). `cribCount` queda como 1/0
  // espejo de `needsCrib`, no como un valor independiente que el cliente pueda variar.
  const babiesCount = childComposition.babies
  const cribRequested = babiesCount > 0 && rawNeedsCrib === true

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

  // Stop-sell por tipo: guard aparte de `availableOfType` (que sólo cuenta inventario), abajo.
  const closedTypes = closedRoomTypes(rawRates ?? [], rawAssignments ?? [], stayNightDates, pricingOccupancy)

  // Ocupación FÍSICA total: la matriz de `/rates` deshabilita `over_capacity` contra este mismo
  // número (`occupancy-matrix.ts`). La UI ya no deja elegir una fila que no entra, pero un POST
  // directo (integrador, replay) nunca pasaba por esa matriz — sin este número acá se podía
  // crear una reserva de 6 huéspedes en un tipo cuyas unidades admiten 2.
  const totalGuests = capacityGuests

  // REQ-01 (#290) — keys `custom:*` pedidas. Sin keys (ni cuna pedida), NADA de lo que sigue lee
  // `RoomAmenities` (cero cambio de comportamiento para un caller que no las manda).
  // #292 — la cuna NO entra por el body: toda key que `isCribAmenityKey` reconozca (`custom:cuna`,
  // `custom:crib`, `custom:cuna_para_bebe`…) se saca de las keys y se vuelve a poner — como la key
  // canónica — sólo si la pidió el gate de bebé (`cribRequested`). Que quede o no en el snapshot
  // lo decide `resolveRoomAmenityLines` contra la unión del tipo (acepta cualquier fila cuna de
  // alguna unidad), y `needsCrib` se lee de AHÍ (más abajo): la línea de cuna existe si y sólo si
  // `needsCrib`, nunca por una key suelta ni por un "sí" que ninguna unidad del tipo puede cumplir.
  const roomAmenityKeys = normalizeRoomAmenityKeys(rawRoomAmenities).filter((k) => !isCribAmenityKey(k))
  if (cribRequested) roomAmenityKeys.push(CRIB_AMENITY_KEY)
  const needsRoomAmenityCatalog = roomAmenityKeys.length > 0

  // ─── Resolución del TIPO (REQ-HAC-05 #260, ver cabecera del archivo) ─────────────────
  // 1) `roomId` real (compat callers viejos): si resuelve a una fila de `Rooms`, sólo sirve para
  //    derivar el tipo — la reserva IGUAL nace sin unidad. Tiene que ser del hotel del formulario
  //    (iba `assertOwnership(room, { hotelId })` — dos objetos, `===` siempre false: toda reserva
  //    daba 403).
  // 2) Si no, `roomType` tal cual lo mandó el widget (el `id` que publica `/rates` por tipo).
  const room: any = roomId ? await orm.findById('Rooms', roomId) as any : null
  if (room && auth) auth.assertOwnership(room.hotelId, hotelId)
  const roomType: string = room ? String(room.type ?? '') : String(rawRoomType ?? '')
  if (!roomType) return { status: 404, body: { error: 'Habitación no encontrada' } }

  const roomsOfTypeRows = (await orm.findMany('Rooms', { hotelId, type: roomType })) as any[]
  if ((roomsOfTypeRows ?? []).length === 0) {
    // El tipo no existe en absoluto para este hotel — 404 (no es un problema de fechas).
    return { status: 404, body: { error: 'Tipo de habitación no encontrado' } }
  }

  // REQ-HAC-02 (#257) — la venta se decide por TIPO: `rooms − booked` por noche, contando las
  // reservas del tipo asignadas O sin asignar (una `confirmed` sin `roomId` también consume
  // una unidad) más los bloqueos de sus unidades. No se elige unidad: eso queda sólo en
  // `reservas/usecases/assign-room.ts`, al asignar. 409 y no 404: el tipo SÍ existe, lo que no
  // hay es disponibilidad para esas fechas.
  const typeAvail = await availableOfType(typeAvailabilityPortFromOrm(orm), hotelId, roomType, checkIn, checkOut)
  if (typeAvail.available < 1) {
    return { status: 409, body: { error: 'No hay habitaciones de este tipo disponibles para esas fechas' } }
  }
  // Stop-sell por tipo (tarifa cerrada para alguna noche): el motor no lo OFRECE, el POST tampoco
  // lo ACEPTA — sin esto el gate sería cosmético (un integrador o un submit stale lo crearía igual).
  if (isRoomTypeClosed(closedTypes, roomType)) {
    return { status: 409, body: { error: 'No hay habitaciones de este tipo disponibles para esas fechas' } }
  }

  // Perfil del tipo (a partir de sus unidades VENDIBLES): capacidad = la MAYOR entre ellas (la
  // reserva entra si entra en alguna; recepción elige cuál al asignar), `maxAdults`/`maxChildren`
  // ídem, y el precio de fallback = el MÍNIMO `basePrice` — mismo agregado que `/rates`
  // (`availability.ts#groupByType`). La política `room_type_capacity` del hotel, si existe, pisa
  // los tres campos de capacidad (`effectiveRoomCapacity`).
  const typeProfile = roomTypeProfile(roomType, typeAvail.sellableRooms, totalGuests)
  const roomCapacity = effectiveRoomCapacity(roomTypeCapacityMap, typeProfile)
  if (!fitsRoomCapacity(roomCapacity, childComposition)) {
    return { status: 409, body: { error: `Esta habitación admite hasta ${roomCapacity.capacity} huésped(es); pediste ${totalGuests}` } }
  }

  // ─── REQ-01 (#290) — Amenidades de la habitación: validar contra la UNIÓN del tipo ──────
  // Sin unidad asignada no hay "sus filas": el catálogo es la unión de `RoomAmenities` de las
  // unidades vendibles del tipo (misma key en dos unidades → la más barata, como publica el
  // catálogo público). Key que ninguna ofrece o inactiva → se ignora con warn; el precio SIEMPRE
  // sale de `RoomAmenities`. Con `cribRequested`, `custom:cuna` ya está en las keys: su línea sale
  // de acá como cualquier otra. Sin keys, NADA de esto lee `RoomAmenities`.
  let roomAmenityLines: RoomAmenityLine[] = []
  let roomAmenitiesTotal = 0
  if (needsRoomAmenityCatalog) {
    const amenitiesByRoom = await loadRoomAmenitiesFor(orm, typeAvail.sellableRooms.map((r: any) => r.id))
    const resolved = resolveRoomAmenityLines(unionRoomAmenities(amenitiesByRoom), roomAmenityKeys, 1, logger)
    roomAmenityLines = resolved.lines
    roomAmenitiesTotal = resolved.total
  }
  const roomAmenitiesSummary = roomAmenityLines.map((l) => `${l.name}=${l.total.toFixed(2)}`)

  // #292 — `needsCrib` definitivo: true si y sólo si la línea `custom:cuna` quedó resuelta en el
  // snapshot (`hasCribLine`); así `needsCrib === (roomAmenities tiene custom:cuna)` siempre, y
  // `cribCount` es su espejo 1/0. Si se pidió y NINGUNA unidad del tipo la ofrece, se crea sin
  // cuna con un warn claro.
  const needsCrib = cribRequested && hasCribLine(roomAmenityLines)
  const cribCount = needsCrib ? 1 : 0
  // Revisión #292 — si se pidió y NO se pudo cumplir, no alcanza con un warn en el log: queda
  // escrito en `notes` (lo lee el recepcionista), persistido en `cribUnavailable` y expuesto en la
  // respuesta pública para que el widget se lo diga al huésped.
  const cribUnavailable = cribRequested && !needsCrib
  if (cribUnavailable) {
    logger?.warn('createPublicBookingDirect: cuna pedida pero ninguna unidad del tipo la ofrece — se crea sin cuna', { hotelId, roomType })
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
  // `fallbackNightly` = el MÍNIMO `basePrice` entre las unidades vendibles del tipo (REQ-HAC-05: ya
  // no hay unidad resuelta), que es lo que se le cotizó al huésped: `/rates` publica el
  // `min(basePrice)` del tipo.
  const baseRates = baseRatesOnly(rawRates ?? [])
  const seasonByDate = buildSeasonByDate(rawAssignments ?? [], rawSeasons ?? [], stayNightDates)
  // Misma ocupación que el `closedRoomTypes` de arriba (`pricingOccupancy` — adultos + niños con
  // plaza, sean edades declaradas o sintetizadas por MR-10).
  const fallbackNightly = typeProfile.minBasePrice
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
        stayNightDates, baseRates, roomType, seasonByDate,
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

  // ─── F2 2.5 — Promo: validar upfront (read-only) ───────────────────────────────────
  // Si extraDeps.promoCodes no está, no procesamos (F0 0.16 behavior: persistimos el string
  // sin validarlo). Si está, validamos; si inválido, 400 con reason; si válido, descuento.
  let promoDiscount = 0
  let promoRecord: any = null
  let promoReason: string | undefined
  if (promoCode && extraDeps?.promoCodes) {
    const subtotal = roomSubtotal + upsellsTotal + roomAmenitiesTotal + mealPlanTotal
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
  // Orden: subtotal (room + upsells + amenidades habitación + régimen) - promoDiscount = base imponible; taxes sobre base;
  // total = base + taxes. Mismo fallback que folios/facturas: configuration('taxes') y si
  // está vacío, hotels.taxRate.
  // Tarea 24 (#88): impuesto por impuesto (nombre, %, importe), con el MISMO lector y la MISMA
  // cuenta que `/rates` y que el widget: cada línea redondeada aparte, `taxes` = suma de líneas.
  // Así lo que el huésped ve fila por fila antes de pagar es exactamente lo que cobra Stripe.
  const subtotalBeforeDiscount = roomSubtotal + upsellsTotal + roomAmenitiesTotal + mealPlanTotal
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
    // #292 — siempre 0 (ver `TotalBreakdown.childAmenitiesTotal`).
    childAmenitiesTotal: 0,
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
  // REQ-01 (#290) — vistazo rápido de las amenidades personalizadas de la habitación (snapshot
  // en `roomAmenities`), igual que los upsells. La cuna (#292) aparece acá con su precio.
  if (roomAmenitiesSummary.length > 0) notesParts.push(`Amenidades habitación: ${roomAmenitiesSummary.join(', ')}`)
  // MR-03 (#268) — el snapshot vive en `mealPlan*` (columnas propias); acá el vistazo rápido.
  if (mealPlanLine) notesParts.push(mealPlanNote(mealPlanLine))
  // Tarea 22 — el detalle estructurado vive en needsCrib/cribCount (columnas propias, ver
  // reservas/model.ts), pero también queda acá para que el recepcionista lo vea de un vistazo en
  // las notas, igual que el resto de los extras de esta reserva. Sí/No únicamente (2026-09-09) —
  // sin cantidad, `cribCount` es siempre 1 cuando `needsCrib` es true.
  if (needsCrib) notesParts.push('Cuna: solicitada')
  if (cribUnavailable) notesParts.push(CRIB_UNAVAILABLE_NOTE)
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
      // ─── Anti-overbooking (por TIPO desde REQ-HAC-05) ─────────────────────────────────────
      // El `availableOfType` de arriba pasa FUERA de la transacción, y entre ese chequeo y este
      // insert hay una ventana: dos huéspedes que aprietan "Pagar" a la vez pasan los dos y se
      // crean DOS reservas sobre la última unidad del tipo (reproducido con un harness que
      // congela al primero justo después de su chequeo: ambos devolvían 201).
      //
      // Se cierra con el MISMO patrón que ya usaba el promo unas líneas más abajo: un UPDATE
      // sobre las filas de las unidades del tipo. En Postgres READ COMMITTED ese UPDATE toma
      // el lock de fila, así que la segunda transacción se bloquea hasta que la primera
      // commitea. Es lo que serializa a los dos compradores por tipo; una re-lectura sola no
      // alcanza (en READ COMMITTED ninguna de las dos ve la fila no commiteada de la otra).
      //
      // El UPDATE es para SERIALIZAR, no para juzgar: quien decide es el RE-CHEQUEO por tipo de
      // abajo, con el lock tomado (acá sí vemos lo que commiteó quien llegó primero). Sin
      // `updateMany`/`findMany` en la tx (mocks viejos, ORMs sin soporte) se degrada: no cubre
      // la carrera real pero mantiene el comportamiento previo en lugar de romper al caller.
      if (typeof tx.updateMany === 'function') {
        await tx.updateMany('Rooms', { hotelId, type: roomType }, { updatedAt: new Date().toISOString() })
          .catch(() => 0)
      }
      if (typeof tx.findMany === 'function') {
        const fresh = await availableOfType(typeAvailabilityPortFromOrm(tx), hotelId, roomType, checkIn, checkOut)
        if (fresh.available < 1) throw new RoomTypeSoldOutConcurrentlyError()
      }

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
        // REQ-HAC-05 (#260): lo vendido es el TIPO y la fila nace SIN unidad — `roomId: null`.
        // La habitación la asigna recepción (assign-room.ts), que valida contra `roomType`; la
        // disponibilidad la cuenta sin unidad (`reservationOccupiesType`).
        id: crypto.randomUUID(), hotelId, roomId: null, roomType, guestId: guest.id,
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
        // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No; #292 por habitación) — ya
        // gateados arriba contra `childComposition.babies` y la oferta de `custom:cuna` del tipo;
        // acá solo persisten como espejo de la línea de cuna en `roomAmenities`.
        needsCrib, cribCount,
        // Revisión #292 — cuna pedida que ninguna unidad del tipo ofrece (ver `cribUnavailable` arriba).
        cribUnavailable,
        // #292 — el catálogo global de amenidades infantiles se dio de baja: las columnas quedan
        // (reservas históricas + lectores) pero una reserva nueva siempre las escribe vacías.
        childAmenities: [],
        childAmenitiesTotal: 0,
        // REQ-01 (#290) — snapshot con precio congelado de las amenidades personalizadas del
        // tipo (validadas arriba contra la unión de filas `RoomAmenities` de sus unidades) + su total.
        roomAmenities: roomAmenityLines,
        roomAmenitiesTotal: round2(roomAmenitiesTotal),
        // MR-03 (#268) — snapshot congelado del régimen (precio releído del catálogo arriba) +
        // su total, ya dentro de `totalAmount`. `regime` lleva el mismo código para que el
        // modal/listado del panel (campo manual preexistente) lo muestren sin cambios.
        mealPlan: mealPlanLine?.code ?? ROOM_ONLY_CODE,
        mealPlanPriceMode: mealPlanLine?.priceMode ?? null,
        mealPlanUnitPrice: mealPlanLine?.unitPrice ?? 0,
        mealPlanTotal: round2(mealPlanTotal),
        mealPlanPersons: mealPlanLine?.persons ?? null,
        regime: mealPlanLine?.code ?? ROOM_ONLY_CODE,
        totalAmount, deposit: 0,
        // Tarea 24 (#88): el desglose que el huésped vio y aceptó se guarda con la reserva, para
        // que la confirmación (y cualquier pantalla posterior) muestre lo mismo que el paso de
        // pago — no un total pelado que nadie puede reconstruir.
        priceBreakdown: totalBreakdown,
        notes: notesParts.join(' | '),
        // #270 — además del texto en `notes` (que no cambia), la llegada estimada y el pedido
        // especial se guardan estructurados para el correo de confirmación y el recibo.
        estimatedArrival: typeof estimatedArrival === 'string' && estimatedArrival.trim() ? estimatedArrival.trim() : undefined,
        specialRequests: typeof specialRequests === 'string' && specialRequests.trim() ? specialRequests.trim() : undefined,
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
        upsells: upsellLines, roomAmenities: roomAmenityLines,
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
    if (e instanceof RoomTypeSoldOutConcurrentlyError) {
      logger?.warn(`Tipo ${roomType} agotado concurrentemente — reserva abortada`, { hotelId, roomType })
      return { status: 409, body: { error: 'No hay habitaciones de este tipo disponibles para esas fechas' } }
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

  // REQ-HAC-05 — sin unidad no hay push por habitación: se empuja el TIPO vendido a las OTAs.
  pushAvailabilityByType?.(hotelId, roomType)

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
      // (roomType vendido, promoCode persistido, etc.) — nada interno sale.
      reservation: {
        id: reservation.id,
        accessToken: reservation.accessToken,
        // REQ-HAC-05 (#260): `roomId` es null en las reservas nuevas (se asigna al check-in); lo
        // vendido es `roomType`. `roomId` se conserva para el replay de filas viejas y los lectores.
        roomId: reservation.roomId ?? null,
        roomType: reservation.roomType ?? null,
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
      // Revisión #292 — sólo cuando se pidió cuna y ninguna unidad del tipo la ofrece: el widget lo
      // muestra ("el hotel se pondrá en contacto"). Sale de la fila para que el replay también lo traiga.
      ...(isOn(reservation.cribUnavailable) ? { cribUnavailable: true } : {}),
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

/** REQ-HAC-05 — "perfil" de un tipo a partir de sus unidades VENDIBLES, para validar capacidad y
 *  cotizar sin unidad asignada. Tiene la forma que espera `effectiveRoomCapacity` (type/capacity/
 *  maxAdults/maxChildren) más el precio de fallback. Agregado MÁXIMO para la capacidad (entra si
 *  entra en alguna unidad; `null` en maxAdults/maxChildren = ninguna lo limita) y MÍNIMO para el
 *  precio (`> 0`, como `/rates`). Sin `capacity` en una fila (dato viejo) cuenta `fallbackCapacity`
 *  — mismo criterio que `availability.ts`: un dato incompleto no bloquea. */
export function roomTypeProfile(
  type: string,
  sellableRooms: any[],
  fallbackCapacity: number,
): { type: string; capacity: number; maxAdults: number | null; maxChildren: number | null; minBasePrice: number } {
  let capacity = 0
  let maxAdults: number | null = null
  let maxChildren: number | null = null
  let minBasePrice = 0
  for (const r of sellableRooms ?? []) {
    capacity = Math.max(capacity, Number(r?.capacity ?? fallbackCapacity) || 0)
    const ma = Number(r?.maxAdults)
    if (r?.maxAdults != null && Number.isFinite(ma)) maxAdults = maxAdults == null ? ma : Math.max(maxAdults, ma)
    const mc = Number(r?.maxChildren)
    if (r?.maxChildren != null && Number.isFinite(mc)) maxChildren = maxChildren == null ? mc : Math.max(maxChildren, mc)
    const price = Number(r?.basePrice ?? r?.price ?? 0)
    if (price > 0 && (minBasePrice === 0 || price < minBasePrice)) minBasePrice = price
  }
  return { type, capacity, maxAdults, maxChildren, minBasePrice }
}

/** REQ-HAC-05 — unión de las filas `RoomAmenities` (custom vendibles) de las unidades de un tipo,
 *  una por `amenityKey`: si dos unidades ofrecen la misma, queda la más barata (a igual precio,
 *  la primera). Es el mismo agregado que publica `GET /room-amenities` por tipo, así lo que el
 *  huésped vio como "desde" es lo que se le cobra. */
export function unionRoomAmenities(amenitiesByRoom: Map<string, any[]>): any[] {
  const byKey = new Map<string, any>()
  for (const rows of amenitiesByRoom.values()) {
    for (const a of customRoomAmenities(rows)) {
      const price = Math.max(0, Number(a.price) || 0)
      const prev = byKey.get(a.amenityKey)
      if (!prev || price < Math.max(0, Number(prev.price) || 0)) byKey.set(a.amenityKey, a)
    }
  }
  return Array.from(byKey.values())
}

/** Revisión #292 — línea de `notes` cuando se pidió cuna y ninguna unidad del tipo la ofrece.
 *  Compartida con `public-booking-group.ts` (misma redacción para el recepcionista). */
export const CRIB_UNAVAILABLE_NOTE = '⚠ El huésped pidió cuna y la habitación asignada no la ofrece'

/** Booleano persistido (INTEGER 0/1 en la columna, `true`/`1`/`'1'` según el adapter). */
const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

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
