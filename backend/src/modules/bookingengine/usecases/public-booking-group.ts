// bookingengine/usecases/public-booking-group.ts — Reserva pública de VARIAS habitaciones
// (mismo tipo ×N o tipos distintos combinados) en una sola operación.
//
// Tarea 10 (QA 2026-08-20, ampliada 2026-08-21 por decisión explícita del producto: también
// soporta combinar tipos distintos, resolviendo la "DECISIÓN PENDIENTE" de
// `specs/booking-availability-pricing/spec.md`).
//
// ─── Por qué un archivo aparte, no una rama dentro de `createPublicBookingDirect` ───────────
// `createPublicBookingDirect` (public-booking.ts) es la ruta de 1 habitación, muy usada,
// endurecida contra varios bugs reales (race de doble-venta, promo concurrente, precio que no
// coincide con lo publicado). Bifurcar esa función con un `if (Array.isArray(body.rooms))`
// la hace más difícil de leer y más riesgosa de tocar. Este archivo reusa sus MISMOS helpers
// (`stay-restrictions.ts`, `rate-resolution.ts`, `promo-validate.ts`) para no duplicar la lógica
// de disponibilidad/precio — solo la orquestación de "una habitación" pasa a "N habitaciones,
// todas o ninguna" cambia.
//
// ─── Modelo de datos: reusa `Groups` (YA EXISTE, módulo `grupos`) ───────────────────────────
// `Reservations.groupId` ya apunta a la tabla `groups` (usada hoy por el panel para reservas de
// agencia/corporativas armadas a mano). Se reusa EXACTAMENTE ese mecanismo: 1 fila en `Groups`
// (name, leadGuestId, totalRooms, checkIn/checkOut, status, totalAmount) + 1 fila en
// `Reservations` POR CADA unidad física reservada, todas con el mismo `groupId`. Cero migración
// nueva, cero tocar folios/check-in/housekeeping/planning — todos siguen viendo reservas
// individuales, exactamente como ya sabían operar.
//
// ─── Pago: UNA sola Stripe Checkout Session, sobre la reserva LÍDER ─────────────────────────
// `createReservationCheckout` toma un solo `reservationId`. Se arma la sesión sobre la PRIMERA
// reserva creada (líder) por el TOTAL COMBINADO del grupo; las demás llevan su propio
// `totalAmount` individual (para que folios/reportes las sumen bien), pero el cobro real es uno
// solo. El webhook (`stripe.ts handleWebhook`) cascada la confirmación de pago a las hermanas
// del mismo `groupId` — ver el fix ahí.
//
// ─── Anti-overbooking del grupo COMPLETO ─────────────────────────────────────────────────────
// Mismo patrón que `createPublicBookingDirect` (UPDATE condicional que toma el lock de fila +
// re-chequeo de solape DENTRO de la tx) pero aplicado a TODAS las unidades del grupo dentro de
// LA MISMA transacción: si una sola habitación se vende concurrentemente, se aborta el grupo
// ENTERO (todo o nada) — no puede quedar una reserva de grupo a medias.
import type { RepositoryAdapter } from 'arckode-framework'
import { readHotelTaxes, taxLinesOn, sumTaxLines } from './hotel-taxes'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import { validate as validatePromoCode } from '../../promo-codes/usecases/promo-validate'
import { blockedRoomIds, closedRoomTypes, isRoomTypeClosed, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate, sumStayPriceForComposition } from './rate-resolution'
import { MAX_STAY_NIGHTS } from '../validators/schema'
import type { PublicBookingExtraDeps, PublicBookingLogger, PublicBookingStripeDeps, TotalBreakdown, UpsellItem, ChildAmenityLine } from './public-booking'
import { normalizeChildAmenityIds, resolveChildAmenityLines, mealPlanNote } from './public-booking'
import { resolveMealPlanLine, ROOM_ONLY_CODE, type MealPlanLine } from './public-meal-plan-lines'
import { normalizeRoomAmenityKeys, loadRoomAmenitiesFor, preferRoomsOffering, resolveRoomAmenityLines, type RoomAmenityLine } from './public-room-amenities'
import { resolveChildPolicy, resolveChildComposition, fitsRoomCapacity, freeChildrenLimitError } from '../../../shared/usecases/child-composition'
import { resolveRoomTypeCapacityMap, effectiveRoomCapacity } from '../../../shared/usecases/room-type-capacity'

const MS_PER_DAY = 86_400_000

/** Techo defensivo: una ruta pública sin auth no puede aceptar "reservá 500 habitaciones" en un
 *  solo POST. 10 unidades cubre cualquier grupo familiar/pequeña agencia real; una reserva más
 *  grande la arma el hotel a mano en el panel (donde `Groups` ya se usa para eso). */
export const MAX_GROUP_UNITS = 10

export interface RoomLineInput {
  roomType: string
  /** Ocupación de ESTA línea (el "para N" que el huésped eligió en la matriz de ese tipo). */
  adults: number
  children?: number
  /** Unidades de este tipo+ocupación a reservar. */
  quantity: number
  /** Feature adultos+niños+edades (2026-09-02): edades declaradas para ESTA línea/habitación —
   *  cada habitación del grupo puede llevar niños distintos. Si viene, `adults`/`children` de
   *  arriba se RECALCULAN acá contra la política del hotel (mismo criterio que public-booking.ts,
   *  el caller legacy que solo manda `adults`/`children` como contadores sigue igual). */
  childrenAges?: number[]
  /** Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — a diferencia de `upsells`
   *  (global al carrito, ver public-booking.ts), esto SÍ es por línea: cada habitación del grupo
   *  pide su propia cuna para SU bebé, no la del grupo entero. Gateado server-side contra los
   *  bebés de ESTA línea Y `childPolicy.cribAvailable`, igual que el flujo de 1 habitación. */
  needsCrib?: boolean
  /** REQ-01 (#233) — amenidades para niños/bebés de ESTA línea (`[{id}]` del catálogo
   *  `child_amenities`). Por línea, igual que la cuna: cada habitación elige las suyas para SUS
   *  menores. Gateado server-side contra los menores de ESTA línea Y `childPolicy.acceptChildren`;
   *  cada unidad física de la línea las lleva (Σ price × quantity de la línea). */
  childAmenities?: Array<{ id: string }>
  /** REQ-01 (#290) — amenidades PERSONALIZADAS de la habitación (`[{key: 'custom:<slug>'}]`),
   *  por línea. Se prefieren las unidades del tipo que las ofrecen y cada unidad física elegida
   *  resuelve precio contra SUS filas `RoomAmenities` (snapshot propio por fila). */
  roomAmenities?: Array<{ key: string }>
  /** MR-03 (#268) — código del régimen de ESTA línea (cada habitación del grupo elige el suyo).
   *  Se resuelve contra `meal_plans` del hotel (precio del server) con las personas de la línea;
   *  cada unidad física de la línea lo lleva (total de la línea = unitario × quantity). */
  mealPlan?: string
}

class RoomTakenConcurrentlyError extends Error {
  constructor(public readonly roomType: string) { super('room_taken_concurrently'); this.name = 'RoomTakenConcurrentlyError' }
}
class PromoUsesExhaustedError extends Error {
  constructor() { super('promo_uses_exhausted_concurrently'); this.name = 'PromoUsesExhaustedError' }
}

/** Normaliza+valida el array `rooms` del body. `null` si no hay al menos 1 línea con quantity >= 1.
 *  El framework de validators no soporta arrays de objetos (mismo motivo que `upsells` en el
 *  usecase de 1 habitación) — se valida acá a mano, no en el schema. */
function normalizeRoomLines(raw: any): RoomLineInput[] | null {
  if (!Array.isArray(raw)) return null
  const out: RoomLineInput[] = []
  for (const r of raw) {
    const roomType = typeof r?.roomType === 'string' ? r.roomType.trim() : ''
    const adults = Math.max(1, Math.floor(Number(r?.adults) || 1))
    const children = Math.max(0, Math.floor(Number(r?.children) || 0))
    const quantity = Math.max(1, Math.floor(Number(r?.quantity) || 1))
    const childrenAges = Array.isArray(r?.childrenAges)
      ? r.childrenAges.map((a: unknown) => Number(a)).filter((a: number) => Number.isFinite(a) && a >= 0)
      : []
    // Tarea 22 — se normaliza acá igual que el resto; el gateo por bebé (¿esta línea tiene
    // alguno?) Y por `childPolicy.cribAvailable` pasa más abajo, cuando ya se conoce la
    // composición de CADA línea.
    const needsCrib = r?.needsCrib === true
    // REQ-01 (#233) — se conservan los ids únicos; el gateo por menores de la línea y la
    // validación contra el catálogo pasan más abajo, cuando se conoce la composición.
    const childAmenities = normalizeChildAmenityIds(r?.childAmenities).map((id) => ({ id }))
    // REQ-01 (#290) — solo keys `custom:*` únicas; la resolución contra cada unidad va más abajo.
    const roomAmenities = normalizeRoomAmenityKeys(r?.roomAmenities).map((key) => ({ key }))
    // MR-03 (#268) — escalar por línea (mismo `max: 40` que el schema del flujo de 1 habitación);
    // la resolución contra el catálogo va más abajo, con la composición de la línea.
    const mealPlan = typeof r?.mealPlan === 'string' ? r.mealPlan.trim().slice(0, 40) : ''
    if (!roomType) continue
    out.push({
      roomType, adults, children, quantity, ...(childrenAges.length > 0 ? { childrenAges } : {}),
      ...(needsCrib ? { needsCrib } : {}),
      ...(childAmenities.length > 0 ? { childAmenities } : {}),
      ...(roomAmenities.length > 0 ? { roomAmenities } : {}),
      ...(mealPlan ? { mealPlan } : {}),
    })
  }
  return out.length > 0 ? out : null
}

function overlaps(r: any, checkIn: string, checkOut: string): boolean {
  return r.status !== 'cancelled' && r.status !== 'no_show' && r.checkIn < checkOut && r.checkOut > checkIn
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Crea una reserva pública de VARIAS habitaciones (mismo tipo ×N y/o tipos distintos) en una
 * sola operación atómica: todas las unidades se reservan, o ninguna. Mismo contrato de robustez
 * que `createPublicBookingDirect`: si Stripe falla, el grupo queda creado igual (pending).
 */
export async function createPublicBookingGroup(
  orm: any,
  body: any,
  pushAvailability?: (hotelId: string, roomId: string) => void,
  auth?: any,
  stripe?: PublicBookingStripeDeps,
  logger?: PublicBookingLogger,
  stripeUrls?: { successUrl: string; cancelUrl: string },
  extraDeps?: PublicBookingExtraDeps,
): Promise<any> {
  const {
    hotelId, guestName, guestEmail, guestPhone, checkIn, checkOut,
    promoCode, upsells,
    // Tarea 3.1 (solmi-direct-booking-qa-fixes) — mismos campos que public-booking.ts.
    estimatedArrival,
    specialRequests,
  } = body

  if (!hotelId || !guestName || !guestEmail || !checkIn || !checkOut) {
    return { status: 400, body: { error: 'Campos requeridos: hotelId, guestName, guestEmail, checkIn, checkOut, rooms' } }
  }
  if (checkIn >= checkOut) return { status: 400, body: { error: 'checkIn debe ser anterior a checkOut' } }

  const lines = normalizeRoomLines(body.rooms)
  if (!lines) {
    return { status: 400, body: { error: 'rooms debe ser un array con al menos 1 línea {roomType, adults, quantity}' } }
  }
  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0)
  if (totalUnits > MAX_GROUP_UNITS) {
    return { status: 400, body: { error: `No se pueden reservar más de ${MAX_GROUP_UNITS} habitaciones en una sola operación` } }
  }

  // Feature adultos+niños+edades (2026-09-02): UNA lectura de política para todo el grupo (mismo
  // hotel para todas las líneas). Solo se resuelve si AL MENOS una línea declaró edades — un
  // grupo armado por un caller legacy (sin `childrenAges` en ninguna línea) no paga el costo de
  // esta lectura extra y cotiza exactamente como antes.
  const anyLineHasAges = lines.some((l) => (l.childrenAges?.length ?? 0) > 0)
  const childPolicy = anyLineHasAges ? await resolveChildPolicy(extraDeps?.config, hotelId) : null
  if (anyLineHasAges && childPolicy && !childPolicy.acceptChildren) {
    return { status: 400, body: { error: 'Este hotel no acepta niños en la reserva' } }
  }
  // Requerimiento 2 (2026-09-03) — misma política de capacidad por tipo que `public-booking.ts`,
  // SIEMPRE (no solo si hay edades): una línea sin `childrenAges` también tiene que respetar el
  // `maxAdults`/`maxChildren` que el hotel haya configurado para ese tipo.
  const roomTypeCapacityMap = await resolveRoomTypeCapacityMap(extraDeps?.config, hotelId)

  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / MS_PER_DAY))
  if (nights > MAX_STAY_NIGHTS) {
    return { status: 400, body: { error: `La estadía no puede superar ${MAX_STAY_NIGHTS} noches` } }
  }

  // Hoisted (no scoped al if): Tarea 3.4 (corrección 2026-08-25) reusa este fetch más abajo
  // para decidir `approvalStatus` — mismo criterio que public-booking.ts.
  let bookingConfig: any = null
  if (extraDeps?.bookingConfig) {
    bookingConfig = await extraDeps.bookingConfig.findOne({ hotelId })
    if (bookingConfig && bookingConfig.enabled === false) {
      return { status: 404, body: { error: 'Hotel no encontrado' } }
    }
  }

  const stayNightDates = stayNights(checkIn, checkOut)
  const [rawBlocks, rawRates, rawAssignments, hotelReservations, rawOverrides, rawSeasons] = await Promise.all([
    orm.findMany('RoomBlocks', { hotelId }) as Promise<any[]>,
    orm.findMany('RoomRates', { hotelId }) as Promise<any[]>,
    orm.findMany('SeasonAssignments', { hotelId }) as Promise<any[]>,
    orm.findMany('Reservations', { hotelId }) as Promise<any[]>,
    // Ver la nota equivalente en public-booking.ts: el override pisa a la temporada.
    orm.findMany('RateOverrides', { hotelId }) as Promise<any[]>,
    orm.findMany('Seasons', { hotelId }) as Promise<any[]>,
  ])
  const blockedIds = blockedRoomIds(rawBlocks ?? [], stayNightDates)
  const busyRoomIds = new Set(
    (hotelReservations ?? []).filter((r: any) => overlaps(r, checkIn, checkOut)).map((r: any) => r.roomId),
  )
  const baseRates = baseRatesOnly(rawRates ?? [])
  const seasonByDate = buildSeasonByDate(rawAssignments ?? [], rawSeasons ?? [], stayNightDates)

  // ─── Resolver TODAS las líneas ANTES de la tx: qué unidades físicas, a qué precio ─────────
  // `claimedIds` evita que 2 líneas del MISMO POST se lleven la misma unidad física (2 líneas
  // del mismo roomType con distinta ocupación, por ejemplo "Deluxe para 2 ×1 + Deluxe para 4 ×1").
  const claimedIds = new Set<string>()
  interface ResolvedLine {
    roomType: string; adults: number; children: number; childrenAges: number[]; roomIds: string[]; perUnitPrice: number
    // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — por LÍNEA, no por grupo
    // (a diferencia de los upsells genéricos de abajo): cada habitación pide lo suyo para su
    // propio bebé.
    needsCrib: boolean; cribCount: number
    // Tarea "Cobro % niños" — % REALMENTE usado para cotizar ESTA línea (o `null`), por LÍNEA
    // igual que crib: cada habitación puede tener una cantidad de adultos distinta, así que el
    // "valor de un adulto" (y por ende si el % terminó aplicando) es por línea.
    childrenRatePercentApplied: number | null
    // REQ-01 (#233) — snapshot de amenidades infantiles de la LÍNEA (quantity = unidades de la
    // línea) y su total; cada fila física persiste su propio snapshot con quantity 1.
    childAmenities: ChildAmenityLine[]
    childAmenitiesTotal: number
    // REQ-01 (#290) — snapshot de amenidades de habitación POR UNIDAD FÍSICA elegida (cada una
    // cobra el precio de SUS filas `RoomAmenities`); `roomAmenitiesTotal` es la Σ de la línea.
    roomAmenitiesByRoom: Map<string, RoomAmenityLine[]>
    roomAmenitiesTotal: number
    // MR-03 (#268) — régimen de la LÍNEA (`null` = solo alojamiento): `mealPlan.total` es el de
    // UNA unidad (persons de la línea × noches); `mealPlanTotal` es × quantity. Cada fila física
    // persiste el snapshot unitario.
    mealPlan: MealPlanLine | null
    mealPlanTotal: number
  }
  const resolvedLines: ResolvedLine[] = []

  const hotelUpsellsMap = Array.isArray(upsells) && upsells.length > 0 && extraDeps?.upsells
    ? new Map(((await extraDeps.upsells.findMany({ hotelId })) as any[]).map((u) => [u.id, u]))
    : null

  // REQ-01 (#233) — catálogo de amenidades infantiles del hotel, UNA lectura para todo el grupo
  // (fuera del loop de líneas). Solo si alguna línea pidió alguna; sin repo cableado no se puede
  // validar ni cotizar → se ignoran con warn (mismo criterio que `upsells` sin repo).
  const anyLineHasChildAmenities = lines.some((l) => (l.childAmenities?.length ?? 0) > 0)
  let childAmenitiesCatalog: any[] | null = null
  if (anyLineHasChildAmenities && extraDeps?.childAmenities) {
    childAmenitiesCatalog = ((await extraDeps.childAmenities.findMany({ hotelId })) as any[]) ?? []
  } else if (anyLineHasChildAmenities && !extraDeps?.childAmenities) {
    logger?.warn('createPublicBookingGroup: childAmenities en rooms[] sin extraDeps.childAmenities cableado — se ignoran (no se puede validar ni cotizar)', { hotelId })
  }

  // MR-03 (#268) — catálogo de regímenes del hotel, UNA lectura para todo el grupo. Solo si alguna
  // línea pidió uno distinto de `room_only`; sin repo cableado no se puede validar → se rechaza
  // (a diferencia de las amenidades: el régimen cambia el precio que el huésped vio).
  const anyLineHasMealPlan = lines.some((l) => !!l.mealPlan && l.mealPlan !== ROOM_ONLY_CODE)
  let mealPlansCatalog: any[] = []
  if (anyLineHasMealPlan) {
    if (!extraDeps?.mealPlans) {
      logger?.warn('createPublicBookingGroup: mealPlan en rooms[] sin extraDeps.mealPlans cableado — se rechaza (no se puede validar ni cotizar)', { hotelId })
      return { status: 400, body: { error: 'meal_plan_unavailable' } }
    }
    mealPlansCatalog = ((await extraDeps.mealPlans.findMany({ hotelId })) as any[]) ?? []
  }

  for (const [lineIndex, line] of lines.entries()) {
    const hasAges = (line.childrenAges?.length ?? 0) > 0
    // FIX (mismo bug que public-booking.ts, encontrado en revisión Requerimiento 2, 2026-09-03):
    // la composición legacy tiene que contar `line.children` para que `fitsRoomCapacity` (de acá
    // para abajo, unificado con el path de edades) siga validando capacidad física exactamente
    // como el chequeo literal `adults+children >= room.capacity` de antes — y para que
    // `maxChildren`, si el hotel lo configuró, también aplique a una línea sin edades.
    const composition = hasAges && childPolicy
      ? resolveChildComposition(line.adults, line.childrenAges!, childPolicy)
      : {
          effectiveAdults: line.adults,
          payingChildren: Math.max(0, line.children ?? 0),
          freeChildren: 0,
          babies: 0,
          chargeableOccupancy: line.adults + Math.max(0, line.children ?? 0),
        }
    // REQ-03 (#235) — tope de niños que NO consumen plaza POR HABITACIÓN (`maxFreeChildrenPerRoom`,
    // null = sin límite): se aplica a CADA línea por separado, con sus propias edades. Es regla
    // del hotel, no de la unidad física (no toca `fitsRoomCapacity`), así que se corta acá antes
    // de buscar unidades; el mensaje nombra la línea para que el huésped sepa cuál corregir.
    if (hasAges && childPolicy) {
      const freeLimitError = freeChildrenLimitError(childPolicy, composition)
      if (freeLimitError) {
        return {
          status: 409,
          body: { error: `Línea ${lineIndex + 1} ("${line.roomType}"): ${freeLimitError}`, roomType: line.roomType },
        }
      }
    }
    // Ocupación para PRECIO/cierre por ocupación: chargeable (adultos + niños con plaza) si la
    // línea declaró edades, o `line.adults` tal cual para un caller legacy — mismo criterio que
    // `public-booking.ts`.
    const pricingOccupancy = hasAges ? composition.chargeableOccupancy : line.adults

    // ─── MR-03 (#268) — Régimen POR LÍNEA: persons = adultos + niños con plaza (bebés y libres
    // no pagan), mismo criterio que public-booking.ts. Cualquier línea inválida corta ANTES de
    // la tx (todo o nada, igual que el resto del grupo).
    let lineMealPlan: MealPlanLine | null = null
    if (line.mealPlan && line.mealPlan !== ROOM_ONLY_CODE) {
      const resolved = resolveMealPlanLine(
        mealPlansCatalog, line.mealPlan, hotelId, composition.effectiveAdults + composition.payingChildren, nights,
      )
      if (!resolved.ok) {
        return { status: 400, body: { error: 'meal_plan_unavailable', mealPlan: line.mealPlan, roomType: line.roomType } }
      }
      lineMealPlan = resolved.line
    }
    const lineMealPlanTotal = round2((lineMealPlan?.total ?? 0) * line.quantity)

    const closedForOccupancy = closedRoomTypes(rawRates ?? [], rawAssignments ?? [], stayNightDates, pricingOccupancy)
    if (isRoomTypeClosed(closedForOccupancy, line.roomType)) {
      return { status: 409, body: { error: `No hay disponibilidad de "${line.roomType}" para esa ocupación en esas fechas` } }
    }

    const roomsOfType = (await orm.findMany('Rooms', { hotelId, type: line.roomType })) as any[]
    if (roomsOfType.length === 0) {
      return { status: 404, body: { error: `Tipo de habitación "${line.roomType}" no encontrado` } }
    }

    // Ocupación FÍSICA de la línea (para el mensaje de error y el fallback sin `maxAdults`/
    // `maxChildren`): adultos + niños con plaza + niños libres si hay edades, o adults+children
    // tal cual para un caller legacy — mismo criterio que `public-booking.ts`.
    const totalGuestsForLine = hasAges
      ? composition.effectiveAdults + composition.payingChildren + composition.freeChildren
      : Math.max(1, line.adults + Math.max(0, line.children ?? 0))
    let freeOfType = roomsOfType
      .filter((r: any) => isRoomSellable(r.status))
      .filter((r: any) => !busyRoomIds.has(r.id) && !blockedIds.has(r.id) && !claimedIds.has(r.id))
      // Requerimiento 2: unificado con el path de edades — la política de tipo (si el hotel la
      // configuró) reemplaza los campos de la habitación física, en ambas ramas por igual.
      .filter((r: any) => fitsRoomCapacity(effectiveRoomCapacity(roomTypeCapacityMap, { type: r.type, capacity: Number(r.capacity ?? totalGuestsForLine), maxAdults: r.maxAdults, maxChildren: r.maxChildren }), composition))
      .sort((a: any, b: any) => (Number(a.basePrice) || 0) - (Number(b.basePrice) || 0))

    if (freeOfType.length < line.quantity) {
      return {
        status: 409,
        body: {
          error: `Solo hay ${freeOfType.length} habitación(es) de "${line.roomType}" con capacidad para ${totalGuestsForLine} huésped(es) disponibles para esas fechas (pediste ${line.quantity})`,
          available: freeOfType.length,
          roomType: line.roomType,
        },
      }
    }

    // REQ-01 (#290) — entre las libres, PRIMERO las que ofrecen todas las amenidades pedidas por
    // ESTA línea (orden estable, mismo criterio que public-booking.ts). Sin keys no se lee nada.
    const lineRoomAmenityKeys = (line.roomAmenities ?? []).map((a) => a.key)
    let lineAmenitiesByRoom = new Map<string, any[]>()
    if (lineRoomAmenityKeys.length > 0) {
      lineAmenitiesByRoom = await loadRoomAmenitiesFor(orm, freeOfType.map((r: any) => r.id))
      freeOfType = preferRoomsOffering(freeOfType, lineAmenitiesByRoom, lineRoomAmenityKeys)
    }
    const chosen = freeOfType.slice(0, line.quantity)
    for (const r of chosen) claimedIds.add(r.id)

    // REQ-01 (#290) — cada unidad física elegida resuelve contra SUS propias filas (quantity 1,
    // total = price): dos unidades del mismo tipo pueden cobrar la misma key a precio distinto,
    // y una que no la ofrezca la ignora con warn.
    const roomAmenitiesByRoom = new Map<string, RoomAmenityLine[]>()
    let lineRoomAmenitiesTotal = 0
    if (lineRoomAmenityKeys.length > 0) {
      for (const r of chosen) {
        const resolved = resolveRoomAmenityLines(lineAmenitiesByRoom.get(r.id) ?? [], lineRoomAmenityKeys, 1, logger)
        roomAmenitiesByRoom.set(r.id, resolved.lines)
        lineRoomAmenitiesTotal += resolved.total
      }
    }

    const fallbackNightly = Number(chosen[0].basePrice) || 0
    // Tarea "Cobro % niños" (2026-09-09) — POR LÍNEA, mismo criterio que public-booking.ts: solo
    // aplica con edades reales declaradas en ESTA línea (un caller legacy sin `childrenAges` sigue
    // cotizando exactamente como siempre).
    const lineChildrenDiscountEnabled = hasAges && childPolicy?.childrenDiscountEnabled === true
    // Auditoría (mismo motivo que public-booking.ts): el % REALMENTE usado para cotizar esta
    // línea, anclado en la reserva — no lo que diga `configuration` más adelante en el tiempo.
    const lineChildrenRatePercentApplied = lineChildrenDiscountEnabled && composition.payingChildren > 0
      ? childPolicy!.childrenRatePercent
      : null
    const perUnitPrice = stayNightDates.length > 0
      ? sumStayPriceForComposition(
          stayNightDates, baseRates, line.roomType, seasonByDate,
          composition.effectiveAdults, composition.payingChildren,
          lineChildrenDiscountEnabled, childPolicy?.childrenRatePercent ?? 0,
          fallbackNightly, rawOverrides ?? [],
        )
      : round2(fallbackNightly * nights)

    // ─── Cuna (Tarea 22, simplificada 2026-09-09) — gateo por bebé Y por config, POR LÍNEA ─────
    // Mismo criterio de defensa en profundidad que public-booking.ts: sin al menos un bebé en
    // ESTA línea Y `childPolicy.cribAvailable`, se fuerza "no pedida" sin importar el body.
    // Sí/No únicamente — `cribCount` es 1/0 espejo de `needsCrib`, nunca una cantidad elegible.
    const lineBabies = composition.babies
    const lineNeedsCrib = lineBabies > 0 && childPolicy?.cribAvailable === true && line.needsCrib === true
    const lineCribCount = lineNeedsCrib ? 1 : 0

    // ─── REQ-01 (#233) — Amenidades infantiles, POR LÍNEA — gateo por menores Y por política ──
    // Sin al menos un menor declarado en ESTA línea (con edades, que es lo que resuelve la
    // política) Y `childPolicy.acceptChildren`, se descartan sin importar el body. Cada unidad
    // física de la línea lleva las amenidades → Σ price × line.quantity.
    const lineChildAmenityIds = (line.childAmenities ?? []).map((a) => a.id)
    const lineMinors = composition.payingChildren + composition.freeChildren
    const lineChildAmenitiesAllowed = childPolicy?.acceptChildren === true && lineMinors > 0
    let lineChildAmenities: ChildAmenityLine[] = []
    let lineChildAmenitiesTotal = 0
    if (lineChildAmenityIds.length > 0 && !lineChildAmenitiesAllowed) {
      logger?.warn('createPublicBookingGroup: childAmenities ignoradas en una línea sin menores declarados o con niños no aceptados', { hotelId, roomType: line.roomType })
    } else if (lineChildAmenityIds.length > 0 && childAmenitiesCatalog) {
      const resolved = resolveChildAmenityLines(childAmenitiesCatalog, lineChildAmenityIds, hotelId, line.quantity, logger)
      lineChildAmenities = resolved.lines
      lineChildAmenitiesTotal = resolved.total
    }

    resolvedLines.push({
      roomType: line.roomType,
      adults: hasAges ? composition.effectiveAdults : line.adults,
      children: hasAges ? composition.payingChildren + composition.freeChildren : (line.children ?? 0),
      childrenAges: hasAges ? line.childrenAges! : [],
      roomIds: chosen.map((r: any) => r.id), perUnitPrice,
      needsCrib: lineNeedsCrib, cribCount: lineCribCount,
      childrenRatePercentApplied: lineChildrenRatePercentApplied,
      childAmenities: lineChildAmenities, childAmenitiesTotal: lineChildAmenitiesTotal,
      roomAmenitiesByRoom, roomAmenitiesTotal: round2(lineRoomAmenitiesTotal),
      mealPlan: lineMealPlan, mealPlanTotal: lineMealPlanTotal,
    })
  }

  const roomSubtotal = round2(
    resolvedLines.reduce((s, l) => s + l.perUnitPrice * l.roomIds.length, 0),
  )
  // REQ-01 (#233) — Σ de las amenidades infantiles de TODAS las líneas (cada una ya × su quantity).
  const childAmenitiesTotal = round2(resolvedLines.reduce((s, l) => s + l.childAmenitiesTotal, 0))
  // REQ-01 (#290) — Σ de las amenidades de habitación de TODAS las unidades de todas las líneas.
  const roomAmenitiesTotal = round2(resolvedLines.reduce((s, l) => s + l.roomAmenitiesTotal, 0))
  // MR-03 (#268) — Σ del régimen de TODAS las líneas (cada una ya × su quantity).
  const mealPlanTotal = round2(resolvedLines.reduce((s, l) => s + l.mealPlanTotal, 0))

  // ─── Upsells (mismo criterio que el flujo de 1 habitación: Σ price × qty, por GRUPO no por línea) ──
  const upsellItems = Array.isArray(upsells) ? upsells.filter((u: any) => u && typeof u.id === 'string') : []
  let upsellsTotal = 0
  const upsellSummary: string[] = []
  if (upsellItems.length > 0 && hotelUpsellsMap) {
    for (const item of upsellItems as UpsellItem[]) {
      const found = hotelUpsellsMap.get(item.id)
      if (!found || !found.active || found.hotelId !== hotelId) continue
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
      const lineTotal = Number(found.price) * qty
      upsellsTotal += lineTotal
      upsellSummary.push(`${found.name}×${qty}=${lineTotal.toFixed(2)}`)
    }
  } else if (upsellItems.length > 0 && !extraDeps?.upsells) {
    logger?.warn('createPublicBookingGroup: upsells sin extraDeps.upsells cableado — se persisten en notes sin precios', { hotelId })
    for (const item of upsellItems as UpsellItem[]) {
      upsellSummary.push(`${item.id}×${Math.max(1, Math.floor(Number(item.quantity) || 1))}`)
    }
  }

  // ─── Promo: UNA vez sobre el subtotal COMBINADO (no por línea) ────────────────────────────
  let promoDiscount = 0
  let promoRecord: any = null
  let promoReason: string | undefined
  if (promoCode && extraDeps?.promoCodes) {
    const subtotal = roomSubtotal + upsellsTotal + childAmenitiesTotal + roomAmenitiesTotal + mealPlanTotal
    const result = await validatePromoCode({ promoCodes: extraDeps.promoCodes }, hotelId, String(promoCode), subtotal)
    if (!result.valid) {
      return { status: 400, body: { error: 'promo_invalid', promoReason: result.reason ?? 'not_found' } }
    }
    promoDiscount = Number(result.discount) || 0
    promoRecord = await extraDeps.promoCodes.findOne({ hotelId, code: result.code })
    if (!promoRecord) { promoDiscount = 0; promoReason = 'not_found' }
  }

  // Tarea 24 (#88): mismo lector y misma cuenta que public-booking.ts (impuesto por impuesto).
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
    childAmenitiesTotal,
    roomAmenitiesTotal,
    mealPlanTotal,
    taxes,
    taxBreakdown,
    total: totalAmount,
  }

  const roomsSummary = resolvedLines.map((l) => `${l.roomType}×${l.roomIds.length} (para ${l.adults})`).join(', ')
  const notesParts: string[] = ['Reserva de grupo desde widget público', `Habitaciones: ${roomsSummary}`]
  if (typeof estimatedArrival === 'string' && estimatedArrival.trim()) {
    notesParts.push(`Llegada estimada: ${estimatedArrival.trim()}`)
  }
  if (typeof specialRequests === 'string' && specialRequests.trim()) {
    notesParts.push(`Pedido especial: ${specialRequests.trim()}`)
  }
  if (promoCode) notesParts.push(`Promo: ${promoCode}${promoReason ? ` (${promoReason})` : ''}`)
  if (upsellSummary.length > 0) notesParts.push(`Upsells: ${upsellSummary.join(', ')}`)
  // REQ-01 (#233) — vistazo rápido por tipo; el detalle estructurado (snapshot con precio) vive
  // en `childAmenities` de CADA fila.
  const childAmenitiesSummary = resolvedLines
    .filter((l) => l.childAmenities.length > 0)
    .map((l) => `${l.roomType}: ${l.childAmenities.map((a) => `${a.name}=${a.total.toFixed(2)}`).join(', ')}`)
  if (childAmenitiesSummary.length > 0) notesParts.push(`Amenidades niños: ${childAmenitiesSummary.join('; ')}`)
  // REQ-01 (#290) — vistazo rápido por tipo (Σ de la línea); el snapshot por unidad vive en
  // `roomAmenities` de CADA fila.
  const roomAmenitiesSummary = resolvedLines
    .filter((l) => Array.from(l.roomAmenitiesByRoom.values()).some((ls) => ls.length > 0))
    .map((l) => {
      const byKey = new Map<string, number>()
      for (const ls of l.roomAmenitiesByRoom.values()) for (const a of ls) byKey.set(a.name, (byKey.get(a.name) ?? 0) + a.total)
      return `${l.roomType}: ${Array.from(byKey.entries()).map(([name, t]) => `${name}=${t.toFixed(2)}`).join(', ')}`
    })
  if (roomAmenitiesSummary.length > 0) notesParts.push(`Amenidades habitación: ${roomAmenitiesSummary.join('; ')}`)
  // MR-03 (#268) — una entrada por línea con régimen (el snapshot vive en `mealPlan*` de CADA
  // fila); el importe es el UNITARIO de la línea, como el resto del vistazo por tipo.
  for (const l of resolvedLines) {
    if (l.mealPlan) notesParts.push(`${l.roomType}: ${mealPlanNote(l.mealPlan)}`)
  }
  // Tarea 22 — mismo criterio que el resto: el detalle estructurado vive en las columnas propias
  // de CADA fila (needsCrib/cribCount), esto es solo para el vistazo rápido. Sí/No únicamente
  // (2026-09-09) — se lista qué tipos la pidieron, sin cantidad.
  const cribLines = resolvedLines.filter((l) => l.needsCrib).map((l) => l.roomType)
  if (cribLines.length > 0) notesParts.push(`Cuna: ${cribLines.join(', ')}`)
  notesParts.push(`Total grupo: ${totalAmount.toFixed(2)} (subtotal ${subtotalBeforeDiscount.toFixed(2)}` +
    `${promoDiscount > 0 ? ` - promo ${promoDiscount.toFixed(2)}` : ''} + tax ${taxes.toFixed(2)})`)

  // ─── Transacción: todo o nada ────────────────────────────────────────────────────────────
  let group: any = null
  let guest: any = null
  const reservations: any[] = []
  // Un solo token para TODO el grupo: el huésped consulta "su reserva" (todas las habitaciones)
  // con un solo link, no N links distintos.
  const sharedAccessToken = crypto.randomUUID()

  try {
    await orm.transaction(async (tx: any) => {
      // Anti-overbooking del GRUPO COMPLETO: lock + re-chequeo de CADA unidad resuelta. Si
      // cualquiera se vendió concurrentemente, se aborta el grupo entero (todo o nada) — mismo
      // patrón que `createPublicBookingDirect`, aplicado a N habitaciones en la misma tx.
      for (const line of resolvedLines) {
        for (const roomId of line.roomIds) {
          if (typeof tx.updateMany === 'function') {
            await tx.updateMany('Rooms', { id: roomId }, { updatedAt: new Date().toISOString() }).catch(() => 0)
          }
          const freshOverlap = (await tx.findMany?.('Reservations', { roomId }).catch(() => [])) ?? []
          const takenNow = (freshOverlap as any[]).some((r: any) => overlaps(r, checkIn, checkOut))
          if (takenNow) throw new RoomTakenConcurrentlyError(line.roomType)
        }
      }

      guest = await tx.create('Guests', {
        id: crypto.randomUUID(), hotelId, name: guestName, email: guestEmail, phone: guestPhone || '',
        documentType: 'passport', documentNumber: '', nationality: '', address: '',
      })

      // Reusa `Groups` (módulo `grupos`, YA EXISTE) — mismo mecanismo que el panel usa para
      // reservas de agencia armadas a mano. `Reservations.groupId` ya apunta acá.
      group = await tx.create('Groups', {
        id: crypto.randomUUID(), hotelId, name: `Reserva de ${guestName}`, leadGuestId: guest.id,
        totalRooms: totalUnits, checkIn, checkOut, status: 'pending', totalAmount,
        notes: `Creado desde el motor de reservas público · ${roomsSummary}`,
      })

      for (const line of resolvedLines) {
        for (const roomId of line.roomIds) {
          // REQ-RWP-04 — `source: 'web'` distingue la reserva del widget web de la carga en
          // recepción (`/api/panel/reservas` deja el default 'direct'); `channel` sigue 'direct'
          // porque los reportes de directas cuentan por `channel` (reservas/usecases/booking-engine.ts).
          const reservation = await tx.create('Reservations', {
            id: crypto.randomUUID(), hotelId, roomId, guestId: guest.id, groupId: group.id,
            checkIn, checkOut, status: 'pending', source: 'web', channel: 'direct',
            adults: line.adults, children: line.children, childrenAges: line.childrenAges,
            // Requerimiento 12 (edad de referencia, 2026-09-03) — mismo ancla que public-booking.ts:
            // el check-in VIGENTE al declarar las edades, para poder proyectarlas al reagendar.
            childrenAgesAsOf: line.childrenAges.length > 0 ? checkIn : undefined,
            // Tarea "Cobro % niños" — % REALMENTE usado para cotizar ESTA línea (auditoría, mismo
            // criterio que public-booking.ts).
            childrenRatePercentApplied: line.childrenRatePercentApplied,
            // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — ya gateados/
            // validados por línea más arriba; cada unidad física de la línea recibe la MISMA
            // solicitud, igual criterio que `childrenAges` un poco más arriba.
            needsCrib: line.needsCrib, cribCount: line.cribCount,
            // REQ-01 (#233) — cada unidad física lleva SU snapshot (quantity 1, total = price) y
            // SU total: el de la línea es × quantity, el de la fila es el de una habitación.
            childAmenities: line.childAmenities.map((a) => ({ ...a, quantity: 1, total: a.price })),
            childAmenitiesTotal: round2(line.childAmenities.reduce((s, a) => s + a.price, 0)),
            // REQ-01 (#290) — snapshot de ESTA unidad (ya resuelto contra sus filas `RoomAmenities`).
            roomAmenities: line.roomAmenitiesByRoom.get(roomId) ?? [],
            roomAmenitiesTotal: round2((line.roomAmenitiesByRoom.get(roomId) ?? []).reduce((s, a) => s + a.total, 0)),
            // MR-03 (#268) — snapshot UNITARIO del régimen de la línea (persons de ESTA línea,
            // quantity 1) + `regime` con el mismo código para el modal/listado del panel.
            mealPlan: line.mealPlan?.code ?? ROOM_ONLY_CODE,
            mealPlanPriceMode: line.mealPlan?.priceMode ?? null,
            mealPlanUnitPrice: line.mealPlan?.unitPrice ?? 0,
            mealPlanTotal: line.mealPlan?.total ?? 0,
            regime: line.mealPlan?.code ?? ROOM_ONLY_CODE,
            // Cada fila lleva SU propio importe (para que folios/reportes sumen bien) — el
            // COBRO real es uno solo, sobre la líder, por `totalAmount` (ver más abajo).
            totalAmount: line.perUnitPrice, deposit: 0,
            notes: notesParts.join(' | '),
            accessToken: sharedAccessToken,
            promoCode: promoCode ? String(promoCode).trim().toUpperCase() : undefined,
            // Tarea 3.4 (corrección 2026-08-25) — mismo criterio que public-booking.ts:
            // eje independiente de `status`, todas las reservas del grupo quedan pendientes
            // de aprobación por igual si el hotel apagó "Confirmación instantánea".
            approvalStatus: bookingConfig?.instantConfirmation === false ? 'pending' : undefined,
            // Tarea 24 (#88): el desglose del grupo (lo que el huésped vio y paga) va en la
            // LÍDER, la primera creada, que es la que Stripe cobra. Las demás no tienen desglose
            // propio: su `totalAmount` es contable, no lo que se le mostró a nadie.
            priceBreakdown: reservations.length === 0 ? totalBreakdown : undefined,
          })
          reservations.push(reservation)
        }
      }

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
      logger?.warn(`Grupo abortado: "${e.roomType}" se vendió concurrentemente`, { hotelId })
      return { status: 409, body: { error: `"${e.roomType}" ya no está disponible para esas fechas` } }
    }
    if (e instanceof PromoUsesExhaustedError) {
      logger?.warn(`Promo ${promoCode} agotado concurrentemente para hotel ${hotelId}`)
      return { status: 409, body: { error: 'promo_invalid', promoReason: 'max_uses_reached' } }
    }
    throw e
  }

  for (const r of reservations) pushAvailability?.(hotelId, r.roomId)

  // ─── UNA sola Checkout Session, sobre la reserva LÍDER (primera creada), por el total combinado ──
  let checkoutUrl: string | null = null
  let paymentError: string | null = null
  const lead = reservations[0]
  if (stripe && stripeUrls && lead) {
    try {
      const session = await stripe.createReservationCheckout(
        lead.id, totalAmount, stripeUrls.successUrl, stripeUrls.cancelUrl,
      )
      checkoutUrl = session.url || null
    } catch (e: any) {
      paymentError = e?.message || 'payment_gateway_unavailable'
      logger?.warn(`Grupo ${group?.id} creado pero Stripe falló — checkoutUrl null`, { hotelId, groupId: group?.id })
    }
  }

  return {
    status: 201,
    body: {
      group: group ? { id: group.id, totalRooms: group.totalRooms, checkIn: group.checkIn, checkOut: group.checkOut, totalAmount: group.totalAmount } : null,
      // Allow-list estricta, mismo criterio que `createPublicBookingDirect` — nada interno sale.
      reservations: reservations.map((r) => ({
        id: r.id, roomId: r.roomId, roomType: resolvedLines.find((l) => l.roomIds.includes(r.roomId))?.roomType,
        checkIn: r.checkIn, checkOut: r.checkOut, status: r.status, adults: r.adults, children: r.children,
        totalAmount: r.totalAmount,
      })),
      // `accessToken`/`reservationId` LÍDER: el widget usa esto para el link de confirmación/
      // consulta pública, igual que el flujo de 1 habitación (mismo contrato de respuesta).
      reservationId: lead?.id ?? null,
      accessToken: sharedAccessToken,
      guest: guest ? { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone ?? '' } : null,
      checkoutUrl,
      totalBreakdown,
      ...(paymentError !== null ? { paymentError } : {}),
    },
  }
}

