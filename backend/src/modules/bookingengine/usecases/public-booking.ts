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
//     El total se calcula como Σ price × quantity (kind es solo un hint de UI para el
//     frontend; la matemática es price × qty para los tres kinds).
//   - `totalBreakdown`: { subtotal, promoDiscount, upsellsTotal, taxes, total } se devuelve
//     en la respuesta para que el widget muestre el detalle y Stripe cobre el `total`.
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
import type { RepositoryAdapter } from 'arckode-framework'
import { validate as validatePromoCode } from '../../promo-codes/usecases/promo-validate'
import { blockedRoomIds, closedRoomTypes, isRoomTypeClosed, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate, sumStayPrice } from './rate-resolution'
import { MAX_STAY_NIGHTS } from '../validators/schema'

const MS_PER_DAY = 86_400_000

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
  /** Repo de `Configuration` para leer la tasa de impuesto del hotel (configuration('taxes')). */
  config?: RepositoryAdapter<any>
  /** FIX 2026-07-31 — Repo de `BookingConfig` (booking_config). Defensa en profundidad: si
   *  `/rates` bloquea por `enabled=false` un guest normal nunca llega acá, pero un caller
   *  directo del POST sí podría — mismo gate acá. Opcional (compat callers/tests viejos). */
  bookingConfig?: RepositoryAdapter<any>
}

/**
 * F2 2.5 — Desglose del total que el widget muestra en el step Pay y que Stripe cobra.
 * Todos los importes en `hotels.currency` (multi-moneda es display only — el cobro es en base).
 */
export interface TotalBreakdown {
  /** room.basePrice × nights + upsellsTotal (antes de promo y antes de impuestos). */
  subtotal: number
  /** Descuento del promo (0 si no hay promo). Siempre >= 0. */
  promoDiscount: number
  /** Σ upsell.price × quantity. */
  upsellsTotal: number
  /** Σ impuestos (ITBIS + otros) sobre (subtotal - promoDiscount). */
  taxes: number
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
  let available = rooms.filter((r: any) => r.status === 'disponible' || r.status === 'available')

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
    // F2 2.5 — promoCode + upsells ahora se PROCESAN (F0 0.16 solo los persistía).
    promoCode,
    upsells,
    // Tarea 3.1 — hora de llegada estructurada + pedidos especiales en texto libre. Antes
    // de este cambio ninguno de los dos llegaba acá: el schema no los declaraba y
    // validateSchema los descartaba en el controller en silencio.
    estimatedArrival,
    specialRequests,
  } = body

  if (!hotelId || (!roomId && !roomType) || !guestName || !guestEmail || !checkIn || !checkOut) {
    return { status: 400, body: { error: 'Campos requeridos: hotelId, guestName, guestEmail, checkIn, checkOut, y roomId o roomType' } }
  }
  if (checkIn >= checkOut) return { status: 400, body: { error: 'checkIn debe ser anterior a checkOut' } }

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
  if (extraDeps?.bookingConfig) {
    const bookingConfig = await extraDeps.bookingConfig.findOne({ hotelId })
    if (bookingConfig && bookingConfig.enabled === false) {
      return { status: 404, body: { error: 'Hotel no encontrado' } }
    }
  }

  // ─── FIX (room_blocks + stop-sell) — paridad con AvailabilityUseCase y /calendar ──────
  // El motor ya no OFRECE una habitación bloqueada ni un tipo con la tarifa cerrada; el POST
  // tampoco la ACEPTA. Sin esto el gate sería puramente cosmético: un integrador (o un submit
  // con datos stale) podía crear la reserva igual sobre inventario que el hotel cerró.
  // Las tres lecturas son sobre modelos COMPARTIDOS (`shared/models.ts`) — mismo criterio de
  // acceso que `Rooms`/`Reservations` acá arriba, sin import cross-module.
  const stayNightDates = stayNights(checkIn, checkOut)
  const [rawBlocks, rawRates, rawAssignments] = await Promise.all([
    orm.findMany('RoomBlocks', { hotelId }) as Promise<any[]>,
    orm.findMany('RoomRates', { hotelId }) as Promise<any[]>,
    orm.findMany('SeasonAssignments', { hotelId }) as Promise<any[]>,
  ])
  const blockedIds = blockedRoomIds(rawBlocks ?? [], stayNightDates)
  const closedTypes = closedRoomTypes(rawRates ?? [], rawAssignments ?? [], stayNightDates, Number(adults) || 2)

  // Ocupación FÍSICA total (adultos + niños): la matriz de `/rates` deshabilita `over_capacity`
  // contra este mismo número (`occupancy-matrix.ts`). La UI ya no deja elegir una fila que no
  // entra, pero un POST directo (integrador, replay, o `roomId` explícito que se salta la
  // resolución por tipo) nunca pasaba por esa matriz — sin este número acá se podía crear una
  // reserva de 6 huéspedes en una habitación para 2.
  const totalGuests = Math.max(1, (Number(adults) || 1) + Math.max(0, Number(kids) || 0))

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

    const availableOfType = roomsOfType.filter((r: any) => r.status === 'disponible' || r.status === 'available')
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
    const freeOfType = availableOfType
      // `room_blocks` descuenta unidades igual que una reserva: la habitación puede no tener
      // reservas y aun así estar cerrada por mantenimiento para ese rango.
      .filter((r: any) => !busyRoomIds.has(r.id) && !blockedIds.has(r.id))
      .filter((r: any) => Number(r.capacity ?? totalGuests) >= totalGuests)
      .sort((a: any, b: any) => (Number(a.basePrice) || 0) - (Number(b.basePrice) || 0))
    if (freeOfType.length === 0) {
      // El tipo existe pero no hay unidades libres (o con capacidad suficiente) para esas
      // fechas — 409, no 404.
      return { status: 409, body: { error: 'No hay habitaciones de este tipo disponibles para esas fechas' } }
    }
    room = freeOfType[0]
  }
  const resolvedRoomId: string = room.id

  // Red de seguridad final: cubre el path de `roomId` explícito (arriba nunca filtró por
  // capacidad porque no pasa por la resolución de `roomType`) y actúa como defensa en
  // profundidad del filtro de arriba.
  if (Number(room.capacity ?? totalGuests) < totalGuests) {
    return { status: 409, body: { error: `Esta habitación admite hasta ${room.capacity ?? totalGuests} huésped(es); pediste ${totalGuests}` } }
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
  const seasonByDate = buildSeasonByDate(rawAssignments ?? [])
  // Misma ocupación y mismo default (2) que `/rates` y que el `closedRoomTypes` de arriba.
  const occupancy = Number(adults) || 2
  const fallbackNightly = Number(room.basePrice) || 0
  const roomSubtotal = stayNightDates.length > 0
    ? sumStayPrice(stayNightDates, baseRates, String(room.type ?? ''), seasonByDate, occupancy, fallbackNightly)
    // Defensa: `checkOut > checkIn` ya se validó, pero si las fechas no se pudieran parsear no se
    // puede cobrar 0 en silencio (mismo criterio que `public-rates.ts`).
    : round2(fallbackNightly * nights)

  // ─── F2 2.5 — Upsells: validar ids contra el hotel y computar upsellsTotal ──────────
  // Defensa: si extraDeps.upsells no está cableado (compat F0 0.16 / callers viejos), no podemos
  // validar ids ni sumar precios, pero sí dejamos constancia en `notes` para el recepcionista
  // (HOOK F0 0.16 que se mantiene — los tests de checkout lo verifican). Cuando extraDeps SÍ está,
  // procesamos para valer: validamos ids, sumamos precios, y el summary lleva el total por línea.
  const upsellItems = Array.isArray(upsells) ? upsells.filter((u: any) => u && typeof u.id === 'string') : []
  let upsellsTotal = 0
  const upsellSummary: string[] = []
  if (upsellItems.length > 0 && extraDeps?.upsells) {
    const hotelUpsells = await extraDeps.upsells.findMany({ hotelId })
    const byId = new Map(hotelUpsells.map((u: any) => [u.id, u]))
    for (const item of upsellItems as UpsellItem[]) {
      const found = byId.get(item.id)
      // Solo se suman upsells activos del hotel. Si el cliente manda un id inexistente,
      // inactivo, o de otro hotel, se ignora (no fail-fast: el huésped no tiene la culpa
      // de un id stale en el frontend; mejor crear la reserva sin ese extra).
      if (!found || !found.active || found.hotelId !== hotelId) continue
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1))
      const lineTotal = Number(found.price) * qty
      upsellsTotal += lineTotal
      upsellSummary.push(`${found.name}×${qty}=${lineTotal.toFixed(2)}`)
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
    const subtotal = roomSubtotal + upsellsTotal
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
  // Orden: subtotal (room + upsells) - promoDiscount = base imponible; taxes sobre base;
  // total = base + taxes. Mismo fallback que folios/facturas: configuration('taxes') y si
  // está vacío, hotels.taxRate.
  const subtotalBeforeDiscount = roomSubtotal + upsellsTotal
  const taxableBase = Math.max(0, subtotalBeforeDiscount - promoDiscount)
  const taxRatePercent = extraDeps?.config ? await readTaxRate(extraDeps.config, hotelId, orm) : 0
  const taxes = round2((taxableBase * taxRatePercent) / 100)
  const totalAmount = round2(taxableBase + taxes)
  const totalBreakdown: TotalBreakdown = {
    subtotal: round2(subtotalBeforeDiscount),
    promoDiscount: round2(promoDiscount),
    upsellsTotal: round2(upsellsTotal),
    taxes,
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

      guest = await tx.create('Guests', {
        id: crypto.randomUUID(), hotelId, name: guestName, email: guestEmail, phone: guestPhone || '',
        documentType: 'passport', documentNumber: '', nationality: '', address: '',
      })
      // F0 0.13 — AccessToken público (UUID). Solo el flujo público lo setea; las reservas
      // creadas desde `/api/panel/reservas` NO lo reciben → `accessToken=null` → 404 en el
      // endpoint público (anti-enumeración IDOR, spec booking-unification D4).
      reservation = await tx.create('Reservations', {
        id: crypto.randomUUID(), hotelId, roomId: resolvedRoomId, guestId: guest.id,
        checkIn, checkOut, status: 'pending', source: 'direct',
        adults: adults || 1, children: kids || 0, totalAmount, deposit: 0,
        notes: notesParts.join(' | '),
        accessToken: crypto.randomUUID(),
        // F2 2.5 — persistimos el promoCode validado (upper-case). Upsells van en `notes`
        // (no hay tabla puente reservation_upsells en este cambio).
        promoCode: promoCode ? String(promoCode).trim().toUpperCase() : undefined,
      })

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
    // Otros errores de la tx: relanzar como antes (el controller pasa a 500 si no se atrapa).
    throw e
  }

  pushAvailability?.(hotelId, resolvedRoomId)

  // F0 0.16 — Cableo del checkoutUrl. ROBUSTEZ: si Stripe falla (no configurado, gateway
  // caído), la reserva SE CREÓ igual. Devolvemos 201 con checkoutUrl:null + paymentError.
  // El huésped al menos tiene su reserva; el panel la ve como "pending".
  let checkoutUrl: string | null = null
  let paymentError: string | null = null
  if (stripe && stripeUrls) {
    try {
      const session = await stripe.createReservationCheckout(
        reservation.id, totalAmount, stripeUrls.successUrl, stripeUrls.cancelUrl,
      )
      checkoutUrl = session.url || null
    } catch (e: any) {
      // NO relanzar — robustez F0. La reserva ya está creada; lo peor que podemos hacer es
      // tirar 500 y que el huésped crea que la reserva no se hizo (cuando sí se hizo).
      paymentError = e?.message || 'payment_gateway_unavailable'
      logger?.warn(
        `Reserva ${reservation.id} creada pero Stripe falló — checkoutUrl null, paymentError="${paymentError}"`,
        { hotelId, reservationId: reservation.id },
      )
    }
  }

  return {
    status: 201,
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
    },
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Tasa de impuesto (%) del hotel. Copia del fallback estándar del proyecto (folios/facturas/
 * reservas/checkin): lee `configuration(key='taxes')` y si está vacío cae a `hotels.taxRate`.
 *
 * `orm` se pasa solo para el fallback a hotels.taxRate (via orm.findById, ya que el usecase
 * no recibe hotelsRepo por separado — mantener la firma compacta). Si extraDeps.config no está
 * cableado, devuelve 0 (compat con callers que no cablean config).
 */
async function readTaxRate(config: RepositoryAdapter<any>, hotelId: string, orm: any): Promise<number> {
  try {
    let c = await config.findOne({ hotelId, key: 'taxes' })
    if (!c) c = await config.findOne({ hotelId, key: 'impuestos' })
    const arr: any[] = c?.value ?? []
    const configured = arr
      .filter((t) => t && (t.activo ?? t.active))
      .reduce((s, t) => s + Number(t.tasa ?? t.rate ?? 0), 0)
    if (configured > 0) return configured
  } catch { /* cae al fallback */ }
  try {
    const hotel = await orm.findById('Hotels', hotelId)
    return Number((hotel as any)?.taxRate) || 0
  } catch {
    return 0
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
