import { NotFoundError, AuthError, ConflictError } from 'arckode-framework'
import { assertRoomAvailable } from './availability'
import { assertUpdateValidations } from './validate-update'
import { safeEmit } from './safe-emit'
import { reservasListCacheKey, invalidateReservasCaches } from './cache'
import { eachDayExclusive } from '../../../shared/utils/daily-availability'
import { baseRatesOnly, buildSeasonByDate, sumStayPrice, round2 } from '../../../shared/utils/rate-resolution'
import { guestsOfReservation } from './reprice'
import type { ReservasDTO, CreateReservasDTO, UpdateReservasDTO, ReservasQuery, ReservasPaginated } from '../types'

/**
 * Puerto hacia el módulo `promo-codes` — regla del framework: NUNCA importar de otro módulo
 * directo. `connectors/reservas-promocodes.ts` inyecta la implementación real (valida +
 * incrementa uses atómicamente). Sin cablear, el promoCode se persiste como texto sin validar
 * (comportamiento viejo, compat).
 */
export interface PromoCodePort {
  /** Valida el código para el hotel y subtotal dados. NO incrementa uses. */
  validate(hotelId: string, code: string, subtotal: number): Promise<{ valid: boolean; discount: number; reason?: string; code?: string }>
  /** Incrementa uses del código ya validado (post-creación exitosa de la reserva). */
  incrementUses(hotelId: string, code: string): Promise<void>
}

const CACHE_TTL = 300
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export async function listReservations(repo: any, userRepo: any, cache: any, logger: any, query: ReservasQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasPaginated> {
  const filters: Record<string, unknown> = {}
  if (query.status) filters.status = query.status
  if (query.channel) filters.channel = query.channel
  if (query.roomId) filters.roomId = query.roomId
  if (query.guestId) filters.guestId = query.guestId
  let hotelId = currentUser.hotelId
  if (!hotelId && currentUser.role !== 'super_admin') {
    const user = await userRepo.findById(currentUser.id)
    hotelId = user?.hotelId
  }
  if (currentUser.role !== 'super_admin') {
    if (!hotelId) throw new AuthError('No hotel assigned')
    filters.hotelId = hotelId
  } else if (query.hotelId) {
    filters.hotelId = query.hotelId
  }
  const page = Math.max(query.page || 1, 1)
  const limit = Math.min(Math.max(query.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = (page - 1) * limit
  const cacheKey = await reservasListCacheKey(cache, hotelId, { filters, page, limit, search: query.search })
  const cached = await cache.get(cacheKey)
  if (cached) return cached as ReservasPaginated
  // FIX #662: sin `orderBy`, la query SQL no lleva ORDER BY y el motor devuelve las filas en
  // su orden físico (insercíon/rowid), NO por recencia. El store del panel (`reservation.store.ts`)
  // nunca manda `page` — siempre pide la "página 1" con el límite default (20) — así que, apenas
  // el hotel supera 20 reservas, una reserva recién creada (create → 201, GET /:id → 200) queda
  // fuera de esos primeros 20 resultados y "desaparece" de la tabla aunque exista. Verificado
  // localmente: total=50, la reserva creada NO aparecía en `GET /api/reservas` por defecto hasta
  // ordenar por createdAt DESC.
  const orderBy = [{ field: 'createdAt', dir: 'DESC' as const }]
  const result = query.search
    ? await repo.paginate({ ...filters, externalLocator: { $like: `%${query.search}%` } }, { offset, limit, orderBy })
    : await repo.paginate(filters, { offset, limit, orderBy })
  const response: ReservasPaginated = { data: result.data, total: result.total, page, limit, pages: Math.ceil(result.total / limit) }
  await cache.set(cacheKey, response, CACHE_TTL)
  return response
}

export async function getReservationById(repo: any, id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
  const item = await repo.findById(id)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  if (currentUser.role !== 'super_admin' && item.hotelId !== currentUser.hotelId) throw new AuthError('No autorizado')
  return item
}

export interface CreatePricingRepos {
  /** Reprice del alta del panel (`priceFrom:'rates'`): temporada por fecha + grilla de tarifas. */
  seasonAssignmentRepo?: any
  roomRateRepo?: any
}

export async function createReservation(repo: any, blockRepo: any | undefined, logger: any, cache: any, sockets: any, notifyDeps: any, dto: CreateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }, roomRepo?: any, guestRepo?: any, dateRestrictionRepo?: any, promoCodes?: PromoCodePort, pricing?: CreatePricingRepos): Promise<ReservasDTO> {
  if (currentUser.role !== 'super_admin' && dto.hotelId !== currentUser.hotelId) throw new AuthError('No autorizado para crear en otro hotel')
  // El estado inicial no puede ser checked_in/checked_out/etc: esos se logran vía /checkin y
  // /checkout (que crean folio y ocupan el cuarto). Una reserva nace confirmada o pendiente.
  if (dto.status && dto.status !== 'confirmed' && dto.status !== 'pending') {
    throw new ConflictError(`Estado inicial no permitido: ${dto.status} (usar confirmed o pending)`)
  }
  // IDOR: el cuarto y el huésped deben ser del MISMO hotel que la reserva. Sin esto, un hotel
  // ocupaba/cobraba cuartos de otro pasando un roomId ajeno (el hotelId ya se forzó arriba).
  // Se lee por `findOne({id})` — la pertenencia es lo que se está verificando, no un recurso
  // protegido que requiera assertOwnership del usuario sobre él.
  if (roomRepo) {
    const room = await roomRepo.findOne({ id: dto.roomId })
    if (!room || room.hotelId !== dto.hotelId) throw new ConflictError('La habitación no pertenece a este hotel')
  }
  if (guestRepo && dto.guestId) {
    const guest = await guestRepo.findOne({ id: dto.guestId })
    if (!guest || guest.hotelId !== dto.hotelId) throw new ConflictError('El huésped no pertenece a este hotel')
  }
  if (dto.checkIn >= dto.checkOut) throw new ConflictError('checkIn debe ser anterior a checkOut')
  // Estadía mínima por fecha (fila "Días Mínimos" del planning). Solo se persisten overrides (minStay>1);
  // sin fila para la fecha de entrada, el mínimo es 1 noche. Lee la tabla compartida DateRestrictions —
  // sin importar el módulo pricing (aislamiento de módulos), igual que blockRepo con RoomBlocks.
  if (dateRestrictionRepo) {
    const nights = Math.round((new Date(dto.checkOut).getTime() - new Date(dto.checkIn).getTime()) / 86_400_000)
    const row = (await dateRestrictionRepo.findMany({ hotelId: dto.hotelId, date: dto.checkIn }))[0] as any
    const minStay = row && Number(row.minStay) > 1 ? Math.floor(Number(row.minStay)) : 1
    if (nights < minStay) throw new ConflictError(`Estadía mínima para el ${dto.checkIn}: ${minStay} noche(s)`)
  }
  await assertRoomAvailable(repo, dto.roomId, dto.checkIn, dto.checkOut)
  if (blockRepo) {
    const blocks = await blockRepo.findMany({ roomId: dto.roomId, hotelId: dto.hotelId })
    for (const block of blocks as any[]) {
      if (dto.checkIn <= block.endDate && dto.checkOut >= block.startDate) throw new ConflictError(`Habitación bloqueada del ${block.startDate} al ${block.endDate}: ${block.reason || 'Sin motivo'}`)
    }
  }
  // FIX 2026-07-31 (hallazgo real: el staff podía tipear un código promocional en el wizard
  // manual y quedaba guardado como texto SIN aplicar ningún descuento — cero validación, cero
  // efecto en totalAmount). El frontend ya restó el descuento de `dto.totalAmount` antes de
  // mandarlo (mismo cálculo que muestra en pantalla); acá se re-valida que el código SIGA
  // siendo legítimo justo antes de crear (por si quedó aplicado en un form abierto mucho
  // tiempo y venció/se agotó mientras tanto) y se incrementa `uses` — sin esto, un código con
  // `maxUses` nunca se agotaba vía el panel del staff, solo vía el widget público.
  if (dto.promoCode && promoCodes) {
    const result = await promoCodes.validate(dto.hotelId, dto.promoCode, dto.totalAmount)
    if (!result.valid) {
      throw new ConflictError(`Código promocional inválido (${result.reason}): ${dto.promoCode}`)
    }
  }
  // Precio por temporada: cuando el alta viene del panel sin edición manual (`priceFrom:'rates'`),
  // el alojamiento lo calcula el SERVIDOR con la misma cadena que el motor público —
  // season_assignments → room_rates (BASE) → fallback rooms.basePrice — pisando el subtotal que
  // mandó el cliente (que pudo quedar viejo si cambiaron tarifas con el form abierto mucho
  // tiempo). totalAmount = alojamiento recalculado + impuestos − descuento promo (aditamentos
  // NO-lodging que el wizard muestra y manda explícitos). Sin repos de tarifas cableados no se
  // recalcula: el DTO se persiste tal cual (comportamiento histórico, degradación como reprice.ts).
  if (dto.priceFrom === 'rates' && pricing?.seasonAssignmentRepo && pricing.roomRateRepo && roomRepo) {
    const room = await roomRepo.findOne({ id: dto.roomId })
    if (room) {
      const [assignments, rates] = await Promise.all([
        pricing.seasonAssignmentRepo.findMany({ hotelId: dto.hotelId }),
        pricing.roomRateRepo.findMany({ hotelId: dto.hotelId }),
      ])
      const nightDates = eachDayExclusive(dto.checkIn, dto.checkOut)
      const roomSubtotal = sumStayPrice(
        nightDates, baseRatesOnly((rates ?? []) as any[]), String(room.type ?? ''),
        buildSeasonByDate((assignments ?? []) as any[]), guestsOfReservation(dto), Number(room.basePrice) || 0,
      )
      dto.totalAmount = round2(roomSubtotal + (dto.taxesAmount || 0) - (dto.promoDiscountAmount || 0))
    }
  }
  const item = await repo.create(dto as any)
  if (dto.promoCode && promoCodes) {
    await promoCodes.incrementUses(dto.hotelId, dto.promoCode)
  }
  await safeEmit(logger, 'onReservasCreated', sockets.onReservasCreated, item)
  await invalidateReservasCaches(cache, dto.hotelId)
  return item
}

export async function updateReservation(repo: any, logger: any, cache: any, sockets: any, id: string, dto: UpdateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }, roomRepo?: any, guestRepo?: any, groupRepo?: any): Promise<ReservasDTO> {
  const existing = await repo.findById(id)
  if (!existing) throw new NotFoundError('Reserva no encontrada')
  if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) throw new AuthError('No autorizado')
  await assertUpdateValidations(repo, existing, dto, currentUser, id, roomRepo, guestRepo, groupRepo)
  const item = await repo.update(id, dto as any)
  if (!item) throw new NotFoundError('Reserva no encontrada')
  await safeEmit(logger, 'onReservasUpdated', sockets.onReservasUpdated, item)
  await invalidateReservasCaches(cache, existing.hotelId)
  return item
}

/** Devuelve la reserva borrada (SC-05: el service la necesita para el audit log). */
export async function deleteReservation(repo: any, logger: any, cache: any, sockets: any, id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<any> {
  const existing = await repo.findById(id)
  if (!existing) throw new NotFoundError('Reserva no encontrada')
  if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) throw new AuthError('No autorizado')
  // Una reserva con folio/check-in no se borra: el FK lo frena, pero como 500 de motor. Se mapea a
  // un 409 claro (regla "anular ≠ borrar": cancelar la reserva, no eliminar el registro).
  let deleted: boolean
  try {
    deleted = await repo.delete(id)
  } catch (e) {
    if (/FOREIGN KEY|constraint/i.test((e as Error).message)) {
      throw new ConflictError('No se puede eliminar una reserva con folio o check-in: cancelala en su lugar')
    }
    throw e
  }
  if (!deleted) throw new NotFoundError('Reserva no encontrada')
  await safeEmit(logger, 'onReservasDeleted', sockets.onReservasDeleted, id)
  // Invalidación versionada (de la rama, consistente con create/update). Se MANTIENE `return
  // existing`: el service lo necesita para el audit log del borrado (SC-05).
  await invalidateReservasCaches(cache, existing.hotelId)
  return existing
}
