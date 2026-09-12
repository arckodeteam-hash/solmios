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
import { safeParse } from '../../../shared/utils/safe-parse'
import { readHotelTaxes, taxLinesOn, sumTaxLines } from './hotel-taxes'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import { findOrCreateGuest, guestsOnTx } from '../../../shared/usecases/find-or-create-guest'
import { validate as validatePromoCode } from '../../promo-codes/usecases/promo-validate'
import { blockedRoomIds, closedRoomTypes, isRoomTypeClosed, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate, sumStayPriceForComposition } from './rate-resolution'
import { MAX_STAY_NIGHTS } from '../validators/schema'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'
import type { PublicBookingExtraDeps, PublicBookingLogger, PublicBookingStripeDeps, TotalBreakdown, UpsellItem } from './public-booking'
import { normalizeIdempotencyKey, resolvePaymentDeadlineAt, isUniqueViolation, CRIB_UNAVAILABLE_NOTE } from './public-booking'
import { isCribAmenityKey } from '../../../shared/usecases/crib-amenity'
import { round2 } from '../../../shared/utils/money'
import { CRIB_AMENITY_KEY, hasCribLine, normalizeRoomAmenityKeys, loadRoomAmenitiesFor, preferRoomsOffering, resolveRoomAmenityLines, type RoomAmenityLine } from './public-room-amenities'
import { buildBookingEngineAddons, totalTaxRateOf, type BookingEngineUpsellInput } from '../../../shared/usecases/booking-engine-addons'
import { resolveUpsellLines, type UpsellPricedLine } from './upsell-pricing'
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
   *  arriba se RECALCULAN acá contra la política del hotel (mismo criterio que public-booking.ts).
   *  MR-10 (#275, Opción A): una línea con `children` plano y sin edades YA NO cotiza por adultos
   *  únicamente — se le sintetizan edades a `maxChildAge` y pasa por el mismo motor. */
  childrenAges?: number[]
  /** Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No; #292 por habitación) — a
   *  diferencia de `upsells` (global al carrito, ver public-booking.ts), esto SÍ es por línea:
   *  cada habitación del grupo pide su propia cuna para SU bebé, no la del grupo entero. Gateado
   *  server-side contra los bebés de ESTA línea Y que cada unidad FINALMENTE asignada ofrezca
   *  `custom:cuna` (`CRIB_AMENITY_KEY`), igual que el flujo de 1 habitación. "Sí" fuerza esa key
   *  en `roomAmenities` de la línea (se prefieren unidades con cuna, precio real por unidad) y
   *  `needsCrib` se persiste POR FILA como espejo exacto de su línea de cuna; "No" la quita
   *  aunque venga en el body.
   *  (#292: `childAmenities` por línea ya no se lee — el catálogo global se dio de baja.) */
  needsCrib?: boolean
  /** REQ-01 (#290) — amenidades PERSONALIZADAS de la habitación (`[{key: 'custom:<slug>'}]`),
   *  por línea. Se prefieren las unidades del tipo que las ofrecen y cada unidad física elegida
   *  resuelve precio contra SUS filas `RoomAmenities` (snapshot propio por fila). `custom:cuna`
   *  se filtra acá (la gobierna `needsCrib`, ver arriba). */
  roomAmenities?: Array<{ key: string }>
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
    // alguno?) Y por oferta de `custom:cuna` del tipo (#292) pasa más abajo, cuando ya se conoce
    // la composición de CADA línea y sus unidades libres.
    const needsCrib = r?.needsCrib === true
    // REQ-01 (#290) — solo keys `custom:*` únicas; la resolución contra cada unidad va más abajo.
    // #292 — la cuna (toda key que `isCribAmenityKey` reconozca) NO entra por acá: su única
    // fuente de verdad es `needsCrib`.
    const roomAmenities = normalizeRoomAmenityKeys(r?.roomAmenities)
      .filter((key) => !isCribAmenityKey(key))
      .map((key) => ({ key }))
    if (!roomType) continue
    out.push({
      roomType, adults, children, quantity, ...(childrenAges.length > 0 ? { childrenAges } : {}),
      ...(needsCrib ? { needsCrib } : {}),
      ...(roomAmenities.length > 0 ? { roomAmenities } : {}),
    })
  }
  return out.length > 0 ? out : null
}

/** Booleano persistido (INTEGER 0/1 en la columna, `true`/`1`/`'1'` según el adapter). */
const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

function overlaps(r: any, checkIn: string, checkOut: string): boolean {
  return r.status !== 'cancelled' && r.status !== 'no_show' && r.checkIn < checkOut && r.checkOut > checkIn
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
    // #266 — clave de idempotencia del widget (opcional), mismo criterio que public-booking.ts.
    idempotencyKey: rawIdempotencyKey,
  } = body

  if (!hotelId || !guestName || !guestEmail || !checkIn || !checkOut) {
    return { status: 400, body: { error: 'Campos requeridos: hotelId, guestName, guestEmail, checkIn, checkOut, rooms' } }
  }
  if (checkIn >= checkOut) return { status: 400, body: { error: 'checkIn debe ser anterior a checkOut' } }

  // #266 — Idempotencia del grupo: la key se guarda SOLO en la LÍDER (las hermanas van sin key,
  // si no chocarían entre sí contra el índice único (hotelId, idempotencyKey)). Un reintento con
  // la misma key devuelve el grupo entero ya creado con 200 — ver `replayPublicBookingGroup`.
  const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey)
  if (idempotencyKey) {
    const lead = await orm.findOne('Reservations', { hotelId, idempotencyKey })
    if (lead) return replayPublicBookingGroup(orm, lead, stripe, logger, stripeUrls)
  }

  const lines = normalizeRoomLines(body.rooms)
  if (!lines) {
    return { status: 400, body: { error: 'rooms debe ser un array con al menos 1 línea {roomType, adults, quantity}' } }
  }
  const totalUnits = lines.reduce((s, l) => s + l.quantity, 0)
  if (totalUnits > MAX_GROUP_UNITS) {
    return { status: 400, body: { error: `No se pueden reservar más de ${MAX_GROUP_UNITS} habitaciones en una sola operación` } }
  }

  // Feature adultos+niños+edades (2026-09-02) + MR-10 (#275, Opción A): UNA lectura de política
  // para todo el grupo (mismo hotel para todas las líneas). Se resuelve si AL MENOS una línea
  // declaró niños — con edades (`childrenAges`, widget nuevo) O como contador plano (`children`,
  // BookingModal.vue viejo, integradores). Hasta MR-10 la línea plana cotizaba por adultos
  // únicamente (los niños nunca movían el precio) y el mismo carrito daba dos totales según la
  // puerta de entrada; ahora, sin edades, cada niño de la línea se SINTETIZA a
  // `childPolicy.maxChildAge` — "niño con plaza" (cuenta para precio y capacidad, nunca bebé ni
  // libre) — y de ahí en adelante la línea recorre EXACTAMENTE el mismo camino que una con edades
  // (ver public-booking.ts para la justificación completa). Un grupo sin ningún niño (todas las
  // líneas con children 0 y sin edades) no paga la lectura de política.
  const anyLineHasChildren = lines.some((l) => (l.childrenAges?.length ?? 0) > 0 || (l.children ?? 0) > 0)
  const childPolicy = anyLineHasChildren ? await resolveChildPolicy(extraDeps?.config, hotelId) : null
  // Con Opción A una línea con `children` plano en un hotel que no acepta niños también recibe
  // este 400 — antes pasaba en silencio cotizando por adultos.
  if (anyLineHasChildren && childPolicy && !childPolicy.acceptChildren) {
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
    /** MR-10 (#275) — personas por unidad que cuentan para `per_person`/`per_person_per_night`. */
    upsellPersonsPerUnit: number
    // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — por LÍNEA, no por grupo
    // (a diferencia de los upsells genéricos de abajo): cada habitación pide lo suyo para su
    // propio bebé. #292 — `needsCrib` acá es "al menos una unidad de la línea quedó con cuna"
    // (para las notas); lo que se PERSISTE por fila sale de `roomAmenitiesByRoom` de ESA unidad.
    needsCrib: boolean
    /** Revisión #292 — unidades de la línea que pidieron cuna y NO la ofrecen (persisten
     *  `cribUnavailable`, van a la nota del grupo y a la respuesta). Vacío si no se pidió. */
    cribUnavailableRoomIds: string[]
    // Tarea "Cobro % niños" — % REALMENTE usado para cotizar ESTA línea (o `null`), por LÍNEA
    // igual que crib: cada habitación puede tener una cantidad de adultos distinta, así que el
    // "valor de un adulto" (y por ende si el % terminó aplicando) es por línea.
    childrenRatePercentApplied: number | null
    // REQ-01 (#290) — snapshot de amenidades de habitación POR UNIDAD FÍSICA elegida (cada una
    // cobra el precio de SUS filas `RoomAmenities`, cuna incluida cuando `needsCrib`, #292);
    // `roomAmenitiesTotal` es la Σ de la línea.
    roomAmenitiesByRoom: Map<string, RoomAmenityLine[]>
    roomAmenitiesTotal: number
  }
  const resolvedLines: ResolvedLine[] = []

  // Catálogo de upsells del hotel, UNA lectura para todo el grupo (la matemática por `kind` va
  // más abajo, cuando ya se conocen habitaciones y personas de todas las líneas).
  const hotelUpsells: any[] | null = Array.isArray(upsells) && upsells.length > 0 && extraDeps?.upsells
    ? (((await extraDeps.upsells.findMany({ hotelId })) as any[]) ?? [])
    : null

  for (const [lineIndex, line] of lines.entries()) {
    // MR-10 (#275, Opción A): edades de ESTA línea — las declaradas, o sintetizadas a
    // `maxChildAge` (una por cada `children` plano) cuando el caller no mandó `childrenAges`.
    const declaredAges = line.childrenAges ?? []
    const plainChildren = Math.max(0, line.children ?? 0)
    const lineChildrenAges: number[] = declaredAges.length > 0
      ? declaredAges
      : (childPolicy ? Array.from({ length: plainChildren }, () => childPolicy.maxChildAge) : [])
    const hasAges = lineChildrenAges.length > 0
    // FIX (mismo bug que public-booking.ts, encontrado en revisión Requerimiento 2, 2026-09-03):
    // la composición tiene que contar a los niños para que `fitsRoomCapacity` (de acá para abajo,
    // unificado con el path de edades) siga validando capacidad física como el chequeo literal
    // `adults+children >= room.capacity` de antes — y para que `maxChildren` también aplique. Con
    // MR-10 una línea con `children` plano ya entra por `resolveChildComposition` con las edades
    // sintetizadas; el `else` queda solo para `children: 0` sin edades (composición trivial de
    // adultos).
    const composition = hasAges && childPolicy
      ? resolveChildComposition(line.adults, lineChildrenAges, childPolicy)
      : {
          effectiveAdults: line.adults,
          payingChildren: 0,
          freeChildren: 0,
          babies: 0,
          chargeableOccupancy: line.adults,
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
    // Ocupación para PRECIO/cierre por ocupación: chargeable (adultos + niños con plaza), sean
    // edades declaradas o sintetizadas por MR-10 — mismo criterio que `public-booking.ts`.
    const pricingOccupancy = composition.chargeableOccupancy

    const closedForOccupancy = closedRoomTypes(rawRates ?? [], rawAssignments ?? [], stayNightDates, pricingOccupancy)
    if (isRoomTypeClosed(closedForOccupancy, line.roomType)) {
      return { status: 409, body: { error: `No hay disponibilidad de "${line.roomType}" para esa ocupación en esas fechas` } }
    }

    const roomsOfType = (await orm.findMany('Rooms', { hotelId, type: line.roomType })) as any[]
    if (roomsOfType.length === 0) {
      return { status: 404, body: { error: `Tipo de habitación "${line.roomType}" no encontrado` } }
    }

    // Ocupación FÍSICA de la línea (para el mensaje de error y el fallback sin `maxAdults`/
    // `maxChildren`): adultos + niños con plaza + niños libres — mismo criterio que
    // `public-booking.ts`.
    const totalGuestsForLine = Math.max(1, composition.effectiveAdults + composition.payingChildren + composition.freeChildren)
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

    // ─── Cuna (Tarea 22, simplificada 2026-09-09; #292 por habitación) — POR LÍNEA ───────────
    // Mismo criterio de defensa en profundidad que public-booking.ts: sin al menos un bebé en
    // ESTA línea, se fuerza "no pedida" sin importar el body. La segunda mitad del gate — ¿la
    // unidad FINALMENTE asignada ofrece `custom:cuna`? — se cierra DESPUÉS de
    // `resolveRoomAmenityLines`, por unidad. Sí/No únicamente — `cribCount` es 1/0 espejo de
    // `needsCrib`, nunca una cantidad elegible.
    const lineBabies = composition.babies
    const lineCribRequested = lineBabies > 0 && line.needsCrib === true

    // REQ-01 (#290) — entre las libres, PRIMERO las que ofrecen todas las amenidades pedidas por
    // ESTA línea (orden estable, mismo criterio que public-booking.ts). Sin keys (ni cuna
    // pedida) no se lee nada. #292 — si la línea pide cuna, `custom:cuna` entra a las keys de la
    // línea (la key del body ya se filtró en `normalizeRoomLines`) y tiene PRIORIDAD al elegir
    // unidades: primero las que ofrecen todo, después las que al menos tienen la cuna.
    const lineRoomAmenityKeys = (line.roomAmenities ?? []).map((a) => a.key)
    if (lineCribRequested) lineRoomAmenityKeys.push(CRIB_AMENITY_KEY)
    let lineAmenitiesByRoom = new Map<string, any[]>()
    if (lineRoomAmenityKeys.length > 0) {
      lineAmenitiesByRoom = await loadRoomAmenitiesFor(orm, freeOfType.map((r: any) => r.id))
      freeOfType = preferRoomsOffering(freeOfType, lineAmenitiesByRoom, lineRoomAmenityKeys, lineCribRequested ? CRIB_AMENITY_KEY : undefined)
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
    // #292 — `needsCrib` definitivo POR UNIDAD: la línea de cuna quedó (o no) en el snapshot de
    // cada unidad asignada (`hasCribLine`), igual que en public-booking.ts. Si se pidió y alguna
    // unidad de la línea no la ofrece, esa fila se crea sin cuna con un warn claro.
    const cribRoomIds = lineCribRequested ? chosen.filter((r: any) => hasCribLine(roomAmenitiesByRoom.get(r.id) ?? [])).map((r: any) => r.id) : []
    // Revisión #292 — unidades de ESTA línea que pidieron cuna y no la tienen: cada una de esas
    // filas persiste `cribUnavailable`, la nota del grupo lo dice y la respuesta lo expone.
    const cribUnavailableRoomIds = lineCribRequested ? chosen.filter((r: any) => !cribRoomIds.includes(r.id)).map((r: any) => r.id) : []
    if (cribUnavailableRoomIds.length > 0) {
      logger?.warn('createPublicBookingGroup: cuna pedida pero la unidad asignada no la ofrece — se crea sin cuna', {
        hotelId, roomType: line.roomType, roomIds: cribUnavailableRoomIds,
      })
    }
    const lineNeedsCrib = cribRoomIds.length > 0

    const fallbackNightly = Number(chosen[0].basePrice) || 0
    // Tarea "Cobro % niños" (2026-09-09) — POR LÍNEA, mismo criterio que public-booking.ts: aplica
    // a todo niño con plaza de ESTA línea. MR-10 (#275): también a la línea con `children` plano,
    // porque sus niños ya se sintetizaron a `maxChildAge` (con plaza) y el % no depende de la edad
    // exacta sino de consumir plaza.
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

    resolvedLines.push({
      roomType: line.roomType,
      adults: composition.effectiveAdults,
      children: composition.payingChildren + composition.freeChildren,
      // MR-10 (#275): con `children` plano acá van las edades SINTETIZADAS a `maxChildAge` — se
      // persisten a propósito, porque son la base del precio que el huésped pagó (un repricing
      // posterior volvería a cotizar por adultos sin ellas).
      childrenAges: lineChildrenAges,
      roomIds: chosen.map((r: any) => r.id), perUnitPrice,
      // MR-10 (#275) — personas de la línea que consumen upsells (adultos + niños con plaza +
      // niños libres, SIN bebés), por unidad; se multiplica por `roomIds.length` más abajo.
      upsellPersonsPerUnit: composition.effectiveAdults + composition.payingChildren + (composition.freeChildren - composition.babies),
      needsCrib: lineNeedsCrib,
      cribUnavailableRoomIds,
      childrenRatePercentApplied: lineChildrenRatePercentApplied,
      roomAmenitiesByRoom, roomAmenitiesTotal: round2(lineRoomAmenitiesTotal),
    })
  }

  const roomSubtotal = round2(
    resolvedLines.reduce((s, l) => s + l.perUnitPrice * l.roomIds.length, 0),
  )
  // REQ-01 (#290) — Σ de las amenidades de habitación de TODAS las unidades de todas las líneas.
  const roomAmenitiesTotal = round2(resolvedLines.reduce((s, l) => s + l.roomAmenitiesTotal, 0))

  // ─── Upsells (mismo criterio que el flujo de 1 habitación, por GRUPO no por línea) ─────────
  // MR-10 (#275): la matemática y los topes por `kind` viven en `resolveUpsellLines` (mismo helper
  // que `/booking`). El contexto es el CARRITO entero: `rooms` = unidades físicas de todas las
  // líneas (per_room ≤ habitaciones), `persons` = Σ por línea de (adultos + niños con plaza +
  // niños libres − bebés) × unidades (per_person ≤ personas del grupo; ppn × personas del grupo).
  const upsellItems = Array.isArray(upsells) ? upsells.filter((u: any) => u && typeof u.id === 'string') : []
  let upsellsTotal = 0
  const upsellSummary: string[] = []
  // MR-10 (#275) — líneas cotizadas por `kind` (van tal cual a `priceBreakdown.upsells[]`).
  let upsellPricedLines: UpsellPricedLine[] = []
  // #269 — líneas resueltas para materializarlas como `ReservationAddons` de la LÍDER (abajo).
  const upsellLines: BookingEngineUpsellInput[] = []
  if (upsellItems.length > 0 && hotelUpsells) {
    const upsellRooms = resolvedLines.reduce((s, l) => s + l.roomIds.length, 0)
    const upsellPersons = resolvedLines.reduce((s, l) => s + l.upsellPersonsPerUnit * l.roomIds.length, 0)
    const resolved = resolveUpsellLines(hotelUpsells, upsellItems as UpsellItem[], hotelId, { nights, rooms: upsellRooms, persons: upsellPersons })
    if (!resolved.ok) {
      // Cantidad fuera del tope del kind → 400 tipado (mismo body que `/booking`): es dinero que
      // el huésped vio en pantalla, no se silencia clampeando. `max` le dice al widget hasta
      // cuánto puede pedir.
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
      // Texto para `notes`: "Desayuno×4p×2n=80.00" (ppn), "Parking×2n=30.00" (per_night),
      // "Transfer×3=30.00" (el resto) — el detalle estructurado va en `priceBreakdown.upsells`.
      const factor = line.persons !== undefined
        ? `×${line.persons}p×${line.nights}n`
        : line.kind === 'per_night' ? `×${line.nights}n` : `×${line.quantity}`
      upsellSummary.push(`${line.name}${factor}=${line.total.toFixed(2)}`)
      // #269 — el folio asienta `quantity × unitPrice`; `quantity` lleva el multiplicador completo
      // del kind (cantidad × noches × personas) y `unitPrice` el unitario del catálogo, igual que
      // en `/booking`.
      upsellLines.push({
        name: line.name,
        quantity: line.quantity * line.nights * (line.persons ?? 1),
        unitPrice: line.unitPrice,
      })
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
    const subtotal = roomSubtotal + upsellsTotal + roomAmenitiesTotal
    const result = await validatePromoCode({ promoCodes: extraDeps.promoCodes }, hotelId, String(promoCode), subtotal)
    if (!result.valid) {
      return { status: 400, body: { error: 'promo_invalid', promoReason: result.reason ?? 'not_found' } }
    }
    promoDiscount = Number(result.discount) || 0
    promoRecord = await extraDeps.promoCodes.findOne({ hotelId, code: result.code })
    if (!promoRecord) { promoDiscount = 0; promoReason = 'not_found' }
  }

  // Tarea 24 (#88): mismo lector y misma cuenta que public-booking.ts (impuesto por impuesto).
  const subtotalBeforeDiscount = roomSubtotal + upsellsTotal + roomAmenitiesTotal
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
    // MR-10 (#275) — por línea; se persiste en el `priceBreakdown` de la LÍDER y sale en la
    // confirmación pública del grupo.
    upsells: upsellPricedLines,
    // #292 — siempre 0 (ver `TotalBreakdown.childAmenitiesTotal`).
    childAmenitiesTotal: 0,
    roomAmenitiesTotal,
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
  // REQ-01 (#290) — vistazo rápido por tipo (Σ de la línea); el snapshot por unidad vive en
  // `roomAmenities` de CADA fila. La cuna (#292) aparece acá con su precio.
  const roomAmenitiesSummary = resolvedLines
    .filter((l) => Array.from(l.roomAmenitiesByRoom.values()).some((ls) => ls.length > 0))
    .map((l) => {
      const byKey = new Map<string, number>()
      for (const ls of l.roomAmenitiesByRoom.values()) for (const a of ls) byKey.set(a.name, (byKey.get(a.name) ?? 0) + a.total)
      return `${l.roomType}: ${Array.from(byKey.entries()).map(([name, t]) => `${name}=${t.toFixed(2)}`).join(', ')}`
    })
  if (roomAmenitiesSummary.length > 0) notesParts.push(`Amenidades habitación: ${roomAmenitiesSummary.join('; ')}`)
  // Tarea 22 — mismo criterio que el resto: el detalle estructurado vive en las columnas propias
  // de CADA fila (needsCrib/cribCount), esto es solo para el vistazo rápido. Sí/No únicamente
  // (2026-09-09) — se lista qué tipos la RECIBIERON (alguna unidad con línea de cuna), sin cantidad.
  const cribLines = resolvedLines.filter((l) => l.needsCrib).map((l) => l.roomType)
  if (cribLines.length > 0) notesParts.push(`Cuna: ${cribLines.join(', ')}`)
  // Revisión #292 — tipos con alguna unidad que pidió cuna y no la ofrece (misma nota que el
  // flujo de 1 habitación, con el tipo para que recepción sepa cuál).
  const cribUnavailableTypes = resolvedLines.filter((l) => l.cribUnavailableRoomIds.length > 0).map((l) => l.roomType)
  if (cribUnavailableTypes.length > 0) notesParts.push(`${CRIB_UNAVAILABLE_NOTE} (${cribUnavailableTypes.join(', ')})`)
  notesParts.push(`Total grupo: ${totalAmount.toFixed(2)} (subtotal ${subtotalBeforeDiscount.toFixed(2)}` +
    `${promoDiscount > 0 ? ` - promo ${promoDiscount.toFixed(2)}` : ''} + tax ${taxes.toFixed(2)})`)

  // ─── Transacción: todo o nada ────────────────────────────────────────────────────────────
  let group: any = null
  let guest: any = null
  const reservations: any[] = []
  // Un solo token para TODO el grupo: el huésped consulta "su reserva" (todas las habitaciones)
  // con un solo link, no N links distintos.
  const sharedAccessToken = crypto.randomUUID()
  // #266 — un solo instante para todo el grupo (ver `resolvePaymentDeadlineAt`).
  const paymentDeadlineAt = resolvePaymentDeadlineAt(bookingConfig)

  try {
    await orm.transaction(async (tx: any) => {
      // Anti-overbooking del GRUPO COMPLETO: lock + re-chequeo de CADA unidad resuelta. Si
      // cualquiera se vendió concurrentemente, se aborta el grupo entero (todo o nada) — mismo
      // patrón que `createPublicBookingDirect`, aplicado a N habitaciones en la misma tx.
      for (const line of resolvedLines) {
        for (const roomId of line.roomIds) {
          // REQ-01 (#290) — snapshot de ESTA unidad (ya resuelto contra sus filas `RoomAmenities`).
          const unitRoomAmenities = line.roomAmenitiesByRoom.get(roomId) ?? []
          // #292 — `needsCrib` POR FILA, espejo exacto de la línea de cuna de ESTA unidad.
          const unitNeedsCrib = hasCribLine(unitRoomAmenities)
          if (typeof tx.updateMany === 'function') {
            await tx.updateMany('Rooms', { id: roomId }, { updatedAt: new Date().toISOString() }).catch(() => 0)
          }
          const freshOverlap = (await tx.findMany?.('Reservations', { roomId }).catch(() => [])) ?? []
          const takenNow = (freshOverlap as any[]).some((r: any) => overlaps(r, checkIn, checkOut))
          if (takenNow) throw new RoomTakenConcurrentlyError(line.roomType)
        }
      }

      // MR-08 (#273) — un huésped = una ficha: se busca por email/teléfono normalizados y solo se
      // crea si no existe. El lock de fila `Hotels` que toma el helper y la búsqueda van DENTRO de
      // esta misma tx. Orden de locks: siempre Rooms (arriba) → Hotels (acá); nadie hace el inverso.
      const guestMatch = await findOrCreateGuest(
        { guests: guestsOnTx(tx), lockTx: tx },
        { hotelId, name: guestName, email: guestEmail, phone: guestPhone },
      )
      guest = guestMatch.guest

      // Reusa `Groups` (módulo `grupos`, YA EXISTE) — mismo mecanismo que el panel usa para
      // reservas de agencia armadas a mano. `Reservations.groupId` ya apunta acá.
      group = await tx.create('Groups', {
        id: crypto.randomUUID(), hotelId, name: `Reserva de ${guestName}`, leadGuestId: guest.id,
        totalRooms: totalUnits, checkIn, checkOut, status: 'pending', totalAmount,
        notes: `Creado desde el motor de reservas público · ${roomsSummary}`,
      })

      for (const line of resolvedLines) {
        for (const roomId of line.roomIds) {
          // REQ-01 (#290) — snapshot de ESTA unidad (ya resuelto contra sus filas `RoomAmenities`).
          const unitRoomAmenities = line.roomAmenitiesByRoom.get(roomId) ?? []
          // #292 — `needsCrib` POR FILA, espejo exacto de la línea de cuna de ESTA unidad.
          const unitNeedsCrib = hasCribLine(unitRoomAmenities)
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
            // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No; #292 por habitación)
            // — gateado por línea (bebé + pedida) y cerrado POR UNIDAD: `needsCrib` es true si
            // y sólo si `roomAmenities` de ESTA fila trae `custom:cuna`; `cribCount` su espejo 1/0.
            needsCrib: unitNeedsCrib, cribCount: unitNeedsCrib ? 1 : 0,
            // Revisión #292 — ESTA unidad pidió cuna y no la ofrece.
            cribUnavailable: line.cribUnavailableRoomIds.includes(roomId),
            // #292 — el catálogo global de amenidades infantiles se dio de baja: las columnas
            // quedan (reservas históricas + lectores) pero una reserva nueva las escribe vacías.
            childAmenities: [],
            childAmenitiesTotal: 0,
            roomAmenities: unitRoomAmenities,
            roomAmenitiesTotal: round2(unitRoomAmenities.reduce((s, a) => s + a.total, 0)),
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
            // #266 — mismo límite de pago para todas las unidades del grupo (el cron vence el
            // grupo entero y marca `groups.status='cancelled'`, ver pending-payment-expiry.ts).
            paymentDeadlineAt,
            // #266 — la key va SOLO en la líder (índice único por hotel).
            idempotencyKey: reservations.length === 0 && idempotencyKey ? idempotencyKey : undefined,
          })
          reservations.push(reservation)
        }
      }

      // #269 — TODOS los extras pagados online del grupo cuelgan de la LÍDER (la primera creada,
      // la que lleva `priceBreakdown` y la que Stripe cobra): upsells del grupo + amenidades de
      // habitación de cada unidad (cuna incluida). Las hermanas no reciben addons — el cobro es
      // uno solo y así se postea al folio una sola vez.
      // Misma tx que las reservas; `notes`/`priceBreakdown` no cambian.
      const leader = reservations[0]
      if (leader) {
        const addonRows = buildBookingEngineAddons({
          reservationId: leader.id, hotelId, taxRate: totalTaxRateOf(hotelTaxes),
          upsells: upsellLines,
          roomAmenities: resolvedLines.flatMap((l) => Array.from(l.roomAmenitiesByRoom.values()).flat()),
        })
        for (const row of addonRows) await tx.create('ReservationAddons', row)
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
    // #266 — carrera entre dos POST con la misma key: el índice único rechazó al segundo; se
    // relee la líder ganadora y se responde el replay 200 (mismo criterio que public-booking.ts).
    if (idempotencyKey && isUniqueViolation(e)) {
      const lead = await orm.findOne('Reservations', { hotelId, idempotencyKey })
      if (lead) {
        logger?.warn('Grupo público duplicado por idempotencyKey concurrente — replay', { hotelId, reservationId: lead.id })
        return replayPublicBookingGroup(orm, lead, stripe, logger, stripeUrls)
      }
    }
    throw e
  }

  for (const r of reservations) pushAvailability?.(hotelId, r.roomId)

  // ─── UNA sola Checkout Session, sobre la reserva LÍDER (primera creada), por el total combinado ──
  const lead = reservations[0]
  const { checkoutUrl, paymentError } = await createGroupCheckoutSafely(stripe, stripeUrls, lead, totalAmount, group?.id, hotelId, logger)
  const roomTypeOf = (roomId: string) => resolvedLines.find((l) => l.roomIds.includes(roomId))?.roomType

  return groupResponse(201, group, reservations, roomTypeOf, lead, sharedAccessToken, guest, checkoutUrl, totalBreakdown, paymentError)
}

/** Ver `createCheckoutSafely` en public-booking.ts — misma robustez, sobre la LÍDER del grupo. */
async function createGroupCheckoutSafely(
  stripe: PublicBookingStripeDeps | undefined,
  stripeUrls: { successUrl: string; cancelUrl: string } | undefined,
  lead: any,
  amount: number,
  groupId: string | undefined,
  hotelId: string,
  logger?: PublicBookingLogger,
): Promise<{ checkoutUrl: string | null; paymentError: string | null }> {
  if (!stripe || !stripeUrls || !lead) return { checkoutUrl: null, paymentError: null }
  try {
    const session = await stripe.createReservationCheckout(lead.id, amount, stripeUrls.successUrl, stripeUrls.cancelUrl)
    return { checkoutUrl: session.url || null, paymentError: null }
  } catch (e: any) {
    const paymentError: string = e?.message || 'payment_gateway_unavailable'
    logger?.warn(`Grupo ${groupId} creado pero Stripe falló — checkoutUrl null`, { hotelId, groupId })
    return { checkoutUrl: null, paymentError }
  }
}

/**
 * #266 — Replay idempotente del grupo: la LÍDER ya existe para (hotelId, idempotencyKey). Se
 * reconstruye la misma respuesta que el 201 (grupo + hermanas por `groupId`) con `status: 200` y
 * `replayed: true`. El `checkoutUrl` se vuelve a pedir sobre la líder por el total del grupo
 * (`groups.totalAmount`): Stripe reutiliza la sesión por `Idempotency-Key: reservationId` — si ya
 * expiró, el cron vence el grupo por `paymentDeadlineAt` y el huésped vuelve a reservar (ver
 * `replayPublicBooking` en public-booking.ts). Líder `cancelled` → 409 `reservation_expired`.
 */
async function replayPublicBookingGroup(
  orm: any,
  lead: any,
  stripe?: PublicBookingStripeDeps,
  logger?: PublicBookingLogger,
  stripeUrls?: { successUrl: string; cancelUrl: string },
): Promise<any> {
  if (lead.status === 'cancelled') return { status: 409, body: { error: 'reservation_expired' } }
  const hotelId = String(lead.hotelId ?? '')
  const group = lead.groupId ? await Promise.resolve(orm.findById?.('Groups', lead.groupId)).catch(() => null) ?? null : null
  const siblings: any[] = lead.groupId
    ? ((await Promise.resolve(orm.findMany?.('Reservations', { groupId: lead.groupId })).catch(() => [])) ?? [])
    : []
  // La líder primero (mismo orden que el 201: `reservations[0]` es la que cobra Stripe).
  const reservations = [lead, ...siblings.filter((r: any) => r.id !== lead.id)]
  const guest = lead.guestId ? await Promise.resolve(orm.findById?.('Guests', lead.guestId)).catch(() => null) ?? null : null
  const rooms: any[] = (await Promise.resolve(orm.findMany?.('Rooms', { hotelId })).catch(() => [])) ?? []
  const roomTypeOf = (roomId: string) => rooms.find((r: any) => r.id === roomId)?.type
  const amount = Number(group?.totalAmount ?? lead.totalAmount) || 0
  const { checkoutUrl, paymentError } = await createGroupCheckoutSafely(stripe, stripeUrls, lead, amount, group?.id, hotelId, logger)
  const totalBreakdown = safeParse(lead.priceBreakdown) ?? null
  return groupResponse(200, group, reservations, roomTypeOf, lead, lead.accessToken, guest, checkoutUrl, totalBreakdown, paymentError, true)
}

function groupResponse(
  status: 200 | 201,
  group: any,
  reservations: any[],
  roomTypeOf: (roomId: string) => string | undefined,
  lead: any,
  accessToken: string,
  guest: any,
  checkoutUrl: string | null,
  totalBreakdown: TotalBreakdown | null,
  paymentError: string | null,
  replayed = false,
): any {
  return {
    status,
    body: {
      group: group ? { id: group.id, totalRooms: group.totalRooms, checkIn: group.checkIn, checkOut: group.checkOut, totalAmount: group.totalAmount } : null,
      // Allow-list estricta, mismo criterio que `createPublicBookingDirect` — nada interno sale.
      reservations: reservations.map((r) => ({
        id: r.id, roomId: r.roomId, roomType: roomTypeOf(r.roomId),
        checkIn: r.checkIn, checkOut: r.checkOut, status: r.status, adults: r.adults, children: r.children,
        totalAmount: r.totalAmount,
      })),
      // `accessToken`/`reservationId` LÍDER: el widget usa esto para el link de confirmación/
      // consulta pública, igual que el flujo de 1 habitación (mismo contrato de respuesta).
      reservationId: lead?.id ?? null,
      accessToken,
      guest: guest ? { id: guest.id, name: guest.name, email: guest.email, phone: guest.phone ?? '' } : null,
      checkoutUrl,
      totalBreakdown,
      // Revisión #292 — alguna unidad del grupo pidió cuna y no la ofrece (sale de las filas,
      // así el replay también lo trae).
      ...(reservations.some((r) => isOn(r.cribUnavailable)) ? { cribUnavailable: true } : {}),
      ...(paymentError !== null ? { paymentError } : {}),
      // #266 — solo en el replay idempotente (misma key, mismo hotel).
      ...(replayed ? { replayed: true } : {}),
    },
  }
}

