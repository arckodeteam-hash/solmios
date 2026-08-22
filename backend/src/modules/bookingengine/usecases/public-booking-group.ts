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
import { validate as validatePromoCode } from '../../promo-codes/usecases/promo-validate'
import { blockedRoomIds, closedRoomTypes, isRoomTypeClosed, stayNights } from './stay-restrictions'
import { baseRatesOnly, buildSeasonByDate, sumStayPrice } from './rate-resolution'
import { MAX_STAY_NIGHTS } from '../validators/schema'
import type { PublicBookingExtraDeps, PublicBookingLogger, PublicBookingStripeDeps, TotalBreakdown, UpsellItem } from './public-booking'

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
    if (!roomType) continue
    out.push({ roomType, adults, children, quantity })
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

  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / MS_PER_DAY))
  if (nights > MAX_STAY_NIGHTS) {
    return { status: 400, body: { error: `La estadía no puede superar ${MAX_STAY_NIGHTS} noches` } }
  }

  if (extraDeps?.bookingConfig) {
    const bookingConfig = await extraDeps.bookingConfig.findOne({ hotelId })
    if (bookingConfig && bookingConfig.enabled === false) {
      return { status: 404, body: { error: 'Hotel no encontrado' } }
    }
  }

  const stayNightDates = stayNights(checkIn, checkOut)
  const [rawBlocks, rawRates, rawAssignments, hotelReservations] = await Promise.all([
    orm.findMany('RoomBlocks', { hotelId }) as Promise<any[]>,
    orm.findMany('RoomRates', { hotelId }) as Promise<any[]>,
    orm.findMany('SeasonAssignments', { hotelId }) as Promise<any[]>,
    orm.findMany('Reservations', { hotelId }) as Promise<any[]>,
  ])
  const blockedIds = blockedRoomIds(rawBlocks ?? [], stayNightDates)
  const busyRoomIds = new Set(
    (hotelReservations ?? []).filter((r: any) => overlaps(r, checkIn, checkOut)).map((r: any) => r.roomId),
  )
  const baseRates = baseRatesOnly(rawRates ?? [])
  const seasonByDate = buildSeasonByDate(rawAssignments ?? [])

  // ─── Resolver TODAS las líneas ANTES de la tx: qué unidades físicas, a qué precio ─────────
  // `claimedIds` evita que 2 líneas del MISMO POST se lleven la misma unidad física (2 líneas
  // del mismo roomType con distinta ocupación, por ejemplo "Deluxe para 2 ×1 + Deluxe para 4 ×1").
  const claimedIds = new Set<string>()
  interface ResolvedLine { roomType: string; adults: number; children: number; roomIds: string[]; perUnitPrice: number }
  const resolvedLines: ResolvedLine[] = []

  for (const line of lines) {
    const closedForOccupancy = closedRoomTypes(rawRates ?? [], rawAssignments ?? [], stayNightDates, line.adults)
    if (isRoomTypeClosed(closedForOccupancy, line.roomType)) {
      return { status: 409, body: { error: `No hay disponibilidad de "${line.roomType}" para esa ocupación en esas fechas` } }
    }

    const roomsOfType = (await orm.findMany('Rooms', { hotelId, type: line.roomType })) as any[]
    if (roomsOfType.length === 0) {
      return { status: 404, body: { error: `Tipo de habitación "${line.roomType}" no encontrado` } }
    }

    // `line.adults` YA es la ocupación TOTAL de la línea (la fila "para N" elegida en la
    // matriz, ver `RoomLineInput`) — sumamos `children` igual por si algún caller la manda
    // aparte. Mismo criterio que `public-booking.ts`: sin este filtro, una unidad con capacidad
    // insuficiente para el grupo se podía asignar igual (dentro del mismo tipo puede haber
    // unidades de capacidad distinta).
    const totalGuestsForLine = Math.max(1, line.adults + Math.max(0, line.children ?? 0))
    const freeOfType = roomsOfType
      .filter((r: any) => r.status === 'disponible' || r.status === 'available')
      .filter((r: any) => !busyRoomIds.has(r.id) && !blockedIds.has(r.id) && !claimedIds.has(r.id))
      .filter((r: any) => Number(r.capacity ?? totalGuestsForLine) >= totalGuestsForLine)
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

    const chosen = freeOfType.slice(0, line.quantity)
    for (const r of chosen) claimedIds.add(r.id)

    const fallbackNightly = Number(chosen[0].basePrice) || 0
    const perUnitPrice = stayNightDates.length > 0
      ? sumStayPrice(stayNightDates, baseRates, line.roomType, seasonByDate, line.adults, fallbackNightly)
      : round2(fallbackNightly * nights)

    resolvedLines.push({
      roomType: line.roomType, adults: line.adults, children: line.children ?? 0,
      roomIds: chosen.map((r: any) => r.id), perUnitPrice,
    })
  }

  const roomSubtotal = round2(
    resolvedLines.reduce((s, l) => s + l.perUnitPrice * l.roomIds.length, 0),
  )

  // ─── Upsells (mismo criterio que el flujo de 1 habitación: Σ price × qty, por GRUPO no por línea) ──
  const upsellItems = Array.isArray(upsells) ? upsells.filter((u: any) => u && typeof u.id === 'string') : []
  let upsellsTotal = 0
  const upsellSummary: string[] = []
  if (upsellItems.length > 0 && extraDeps?.upsells) {
    const hotelUpsells = await extraDeps.upsells.findMany({ hotelId })
    const byId = new Map(hotelUpsells.map((u: any) => [u.id, u]))
    for (const item of upsellItems as UpsellItem[]) {
      const found = byId.get(item.id)
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
    const subtotal = roomSubtotal + upsellsTotal
    const result = await validatePromoCode({ promoCodes: extraDeps.promoCodes }, hotelId, String(promoCode), subtotal)
    if (!result.valid) {
      return { status: 400, body: { error: 'promo_invalid', promoReason: result.reason ?? 'not_found' } }
    }
    promoDiscount = Number(result.discount) || 0
    promoRecord = await extraDeps.promoCodes.findOne({ hotelId, code: result.code })
    if (!promoRecord) { promoDiscount = 0; promoReason = 'not_found' }
  }

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
          const reservation = await tx.create('Reservations', {
            id: crypto.randomUUID(), hotelId, roomId, guestId: guest.id, groupId: group.id,
            checkIn, checkOut, status: 'pending', source: 'direct',
            adults: line.adults, children: line.children,
            // Cada fila lleva SU propio importe (para que folios/reportes sumen bien) — el
            // COBRO real es uno solo, sobre la líder, por `totalAmount` (ver más abajo).
            totalAmount: line.perUnitPrice, deposit: 0,
            notes: notesParts.join(' | '),
            accessToken: sharedAccessToken,
            promoCode: promoCode ? String(promoCode).trim().toUpperCase() : undefined,
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

/** Copia de `readTaxRate` (public-booking.ts) — mismo fallback estándar del proyecto. Duplicado
 *  a propósito (función privada de 12 líneas) en vez de exportar/importar cross-file por una
 *  función tan chica: mantiene los 2 usecases independientes uno del otro. */
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
