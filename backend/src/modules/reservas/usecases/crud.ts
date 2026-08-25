import { NotFoundError, AuthError, ConflictError } from 'arckode-framework'
import { assertRoomAvailable } from './availability'
import { assertUpdateValidations } from './validate-update'
import { safeEmit } from './safe-emit'
import { reservasListCacheKey, invalidateReservasCaches } from './cache'
import { eachDayExclusive } from '../../../shared/utils/daily-availability'
import { baseRatesOnly, buildSeasonByDate, sumStayPrice } from '../../../shared/utils/rate-resolution'
import { round2 } from '../../../shared/utils/money'
import { guestsOfReservation } from './reprice'
import { syncReservationPending, type AddonSource } from '../../../shared/usecases/sync-reservation-pending'
import type { PaidSource } from '../../../shared/usecases/reservation-paid'
import type { ReservasDTO, CreateReservasDTO, UpdateReservasDTO, ReservasQuery, ReservasPaginated } from '../types'

/**
 * Puerto hacia el módulo `promo-codes` — regla del framework: NUNCA importar de otro módulo
 * directo. `connectors/reservas-promocodes.ts` inyecta la implementación real. Sin cablear,
 * el promoCode se persiste como texto sin validar (comportamiento viejo, compat).
 *
 * PC-1/PC-2 (auditoría 2026-08-19): el viejo `incrementUses` (read-modify-write POST-create,
 * sin re-chequeo de maxUses) se reemplazó por `consumeUse` — CAS con optimistic lock que se
 * llama ANTES de persistir y lanza ConflictError si el código se agotó — más `releaseUse`
 * para compensar (fallo del create) y para devolver el uso al cancelar la reserva (PC-5).
 */
export interface PromoCodePort {
  /** Valida el código para el hotel y subtotal dados. NO consume uses. */
  validate(hotelId: string, code: string, subtotal: number): Promise<{ valid: boolean; discount: number; reason?: string; code?: string }>
  /** Consume UN uso (CAS). Lanza ConflictError si agotado. ANTES de persistir la reserva. */
  consumeUse(hotelId: string, code: string): Promise<void>
  /** Devuelve UN uso (compensación por fallo post-consumo, o cancelación de la reserva). */
  releaseUse(hotelId: string, code: string): Promise<void>
}

const CACHE_TTL = 300
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
/**
 * Tolerancia de redondeo al comparar el descuento que declara el cliente contra el que
 * computa el server (ambos redondean a centavos → drift real ≤ 0.01). Diferencias mayores
 * son tarifas viejas en pantalla o manipulación → 409 con el monto real.
 */
const DISCOUNT_EPSILON = 0.011

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
  // ─── Precio por temporada (server-side) ───────────────────────────────────────────────
  // Cuando el alta viene del panel sin edición manual (`priceFrom:'rates'`), el alojamiento lo
  // calcula el SERVIDOR con la misma cadena que el motor público — season_assignments →
  // room_rates (BASE) → fallback rooms.basePrice. PC-2 (2026-08-19): este bloque se movió
  // ANTES del promo para que la validación del código y el descuento usen el subtotal
  // autoritativo del server (antes validaba contra `dto.totalAmount`, que ya incluye
  // impuestos y descuento — semántica de minAmount distinta a la del widget público).
  // Sin repos de tarifas cableados no se recalcula (comportamiento histórico, como reprice.ts).
  let roomSubtotal: number | null = null
  if (dto.priceFrom === 'rates' && pricing?.seasonAssignmentRepo && pricing.roomRateRepo && roomRepo) {
    const room = await roomRepo.findOne({ id: dto.roomId })
    if (room) {
      const [assignments, rates] = await Promise.all([
        pricing.seasonAssignmentRepo.findMany({ hotelId: dto.hotelId }),
        pricing.roomRateRepo.findMany({ hotelId: dto.hotelId }),
      ])
      const nightDates = eachDayExclusive(dto.checkIn, dto.checkOut)
      roomSubtotal = sumStayPrice(
        nightDates, baseRatesOnly((rates ?? []) as any[]), String(room.type ?? ''),
        buildSeasonByDate((assignments ?? []) as any[]), guestsOfReservation(dto), Number(room.basePrice) || 0,
      )
    }
  }

  // ─── Promo: descuento AUTORITATIVO del server + consumo atómico (PC-1/PC-2) ──────────
  // FIX 2026-07-31 (contexto): antes el staff tipeaba un código y quedaba como texto sin
  // descuento. FIX 2026-08-19 (PC-2): el descuento REGISTRADO pasa a ser SIEMPRE el que el
  // server computa para el subtotal base — nunca el `promoDiscountAmount` que declara el
  // cliente; si difiere (form abierto con tarifas viejas, o manipulación), 409 con el monto
  // real para que el operador reaplique. FIX (PC-1): el consumo de `uses` es CAS
  // (promo-atomic.ts) y ocurre ANTES del create — un código agotado en la ventana → 409 y la
  // reserva NO se crea (antes: read-modify-write post-create sin re-chequeo → doble canje).
  const taxes = Number(dto.taxesAmount || 0)
  const clientDiscount = Number(dto.promoDiscountAmount || 0)
  let discount = clientDiscount // sin código/sin port: aditamento manual del staff (histórico)
  if (dto.promoCode && promoCodes) {
    // Normalización al persistir (mismo criterio que el flujo público, public-booking.ts).
    dto.promoCode = String(dto.promoCode).trim().toUpperCase()
    // Base del descuento = subtotal pre-descuento/pre-impuestos (misma base que el preview
    // del wizard y que el widget público). Con tarifas recalculadas manda el server; si no,
    // se reconstruye de la identidad del wizard: total = subtotal + taxes − desc.
    const subtotalBase = roomSubtotal != null
      ? roomSubtotal
      : Math.max(0, Number(dto.totalAmount || 0) + clientDiscount - taxes)
    const result = await promoCodes.validate(dto.hotelId, dto.promoCode, subtotalBase)
    if (!result.valid) {
      throw new ConflictError(`Código promocional inválido (${result.reason}): ${dto.promoCode}`)
    }
    if (clientDiscount > 0 && Math.abs(clientDiscount - result.discount) > DISCOUNT_EPSILON) {
      throw new ConflictError(
        `El descuento real del código ${dto.promoCode} es ${result.discount.toFixed(2)}, no ${clientDiscount.toFixed(2)} — volvé a aplicarlo`,
      )
    }
    discount = result.discount
    dto.promoDiscountAmount = discount
  }

  // ─── Total ────────────────────────────────────────────────────────────────────────────
  if (roomSubtotal != null) {
    dto.totalAmount = round2(roomSubtotal + taxes - discount)
  } else if (dto.promoCode && promoCodes) {
    // Precio manual con promo: restaurar la identidad total = subtotal − descuento + impuestos
    // (el total queda acotado por el descuento que el server computó, no por el declarado).
    const subtotalBase = Math.max(0, Number(dto.totalAmount || 0) + clientDiscount - taxes)
    dto.totalAmount = round2(subtotalBase - discount + taxes)
  }

  // Consumo atómico ANTES de persistir: 409 "agotado" sin crear nada.
  if (dto.promoCode && promoCodes?.consumeUse) {
    await promoCodes.consumeUse(dto.hotelId, dto.promoCode)
  }
  let item: ReservasDTO
  try {
    item = await repo.create(dto as any)
  } catch (e) {
    // Compensación: la reserva no existe, el uso no se consume.
    if (dto.promoCode && promoCodes?.releaseUse) {
      await promoCodes.releaseUse(dto.hotelId, dto.promoCode).catch(() => {})
    }
    throw e
  }
  await safeEmit(logger, 'onReservasCreated', sockets.onReservasCreated, item)
  await invalidateReservasCaches(cache, dto.hotelId)
  return item
}

/**
 * Efectos colaterales que tienen que correr DENTRO de la ventana de escritura del update.
 *
 * ARCH-7 / COR-2: recalcular `pendingAmount` DESPUÉS de `updateReservation` dejaba dos agujeros —
 * el socket `onReservasUpdated` viajaba con el saldo VIEJO, y una lectura que entrara entre la
 * invalidación de caché y el recálculo volvía a cachear el número pre-sync durante 300s. Todo lo
 * que mueva el saldo se ejecuta acá: después de persistir, antes de emitir e invalidar.
 */
export interface UpdateReservationHooks {
  /** Corre tras el `repo.update` exitoso. Lo que devuelva se mergea en el item que se emite/devuelve. */
  afterPersist?: (item: ReservasDTO) => Promise<Partial<ReservasDTO> | void>
  /**
   * Corre DESPUÉS de persistir un update que mueve el total cobrable. SEC3-2: `totalAmount` y
   * `otherCharges` son el lado "balance" del techo de `payment-requests` — bajarlos sin más deja
   * vivas Checkout Sessions por importes que el nuevo saldo ya no respalda. Lo implementa el
   * módulo dueño del cobro (connector `reservas-payment-requests`); sin él no hay links que
   * recortar y es no-op.
   */
  afterCeilingDrop?: (item: ReservasDTO) => Promise<void>
}

export async function updateReservation(repo: any, logger: any, cache: any, sockets: any, id: string, dto: UpdateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }, roomRepo?: any, guestRepo?: any, groupRepo?: any, promoCodes?: PromoCodePort, hooks?: UpdateReservationHooks): Promise<ReservasDTO> {
  const existing = await repo.findById(id)
  if (!existing) throw new NotFoundError('Reserva no encontrada')
  if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) throw new AuthError('No autorizado')
  await assertUpdateValidations(repo, existing, dto, currentUser, id, roomRepo, guestRepo, groupRepo)
  // ─── PC-8 (2026-08-19): promoCode en edición ──────────────────────────────────────────
  // Antes el UpdateReservasSchema ni declaraba `promoCode`: el wizard lo mandaba en edición y
  // validateSchema lo descartaba en silencio (anti-patrón campo-no-declarado, lado validador).
  // Ahora: si CAMBIA, se valida y se consume el NUEVO antes de persistir (409 si inválido o
  // agotado, sin tocar la reserva) y se libera el VIEJO recién tras el update exitoso; si se
  // QUITA, se libera el viejo. El precio en edición sigue siendo el total pactado que envía
  // el wizard (semántica histórica del update: el staff puede ajustar el total manualmente).
  const prevCode = String(existing.promoCode ?? '').trim().toUpperCase()
  const nextCode = dto.promoCode !== undefined ? String(dto.promoCode ?? '').trim().toUpperCase() : prevCode
  if (nextCode) dto.promoCode = nextCode // persistir normalizado (mismo criterio que create)
  let consumedCode: string | null = null
  if (promoCodes && nextCode && nextCode !== prevCode) {
    const sub = Math.max(0, Number(dto.totalAmount ?? existing.totalAmount ?? 0) || 0)
    const result = await promoCodes.validate(existing.hotelId, nextCode, sub)
    if (!result.valid) {
      throw new ConflictError(`Código promocional inválido (${result.reason}): ${nextCode}`)
    }
    await promoCodes.consumeUse(existing.hotelId, nextCode)
    consumedCode = nextCode
  }
  let item: ReservasDTO | null
  try {
    item = await repo.update(id, dto as any)
  } catch (e) {
    if (consumedCode) await promoCodes!.releaseUse(existing.hotelId, consumedCode).catch(() => {})
    throw e
  }
  if (!item) {
    if (consumedCode) await promoCodes!.releaseUse(existing.hotelId, consumedCode).catch(() => {})
    throw new NotFoundError('Reserva no encontrada')
  }
  // Post-éxito: devolver el uso del código reemplazado o quitado (best-effort, no rompe).
  if (promoCodes?.releaseUse && prevCode && prevCode !== nextCode) {
    await promoCodes.releaseUse(existing.hotelId, prevCode).catch(() => {})
  }
  // Orden NO negociable: persistir → hooks (recálculo del saldo) → socket → invalidar caché.
  // Emitir o invalidar antes del hook publica/recachea el saldo viejo (COR-2).
  const patched = (await hooks?.afterPersist?.(item)) || {}
  const result = { ...item, ...patched } as ReservasDTO
  // SEC3-2: los links de pago vivos se recortan al saldo NUEVO. Corre después de persistir a
  // propósito: el clamp relee la reserva y necesita ver el total definitivo. Si Stripe falla, el PUT
  // ya quedó aplicado y el clamp se reintenta en el próximo cambio de la reserva — la ventana
  // residual es la misma que la de un webhook lento.
  //
  // RTC-7.1: SIN condición sobre qué campos vinieron en el `dto`. Antes era
  // `if (dto.totalAmount !== undefined || dto.otherCharges !== undefined)`, y esa lista se olvidaba
  // de `deposit` —escribible por el MISMO `PUT /api/reservas/:id` (`validators/schema.ts`) y parte
  // de lo pagado vía `combinePaid` (`shared/usecases/reservation-paid.ts`)—, así que subir el
  // anticipo bajaba el saldo cobrable a 0 con el link de Stripe todavía pagable: medido por
  // `payment-requests/tests/ceiling-property.test.ts` (`requerir-pago → subir-anticipo`, $400
  // cobrables sobre un saldo de $0). El comentario de `updateReservationWithBalance`, once líneas
  // más abajo, ya decía que los TRES campos mueven el total cobrable: el código contradecía al
  // comentario.
  //
  // Enumerar campos es la forma del bug, no un detalle: cada campo nuevo que toque el dinero
  // reabre la puerta en silencio. El clamp es idempotente y sale en la primera query si la reserva
  // no tiene cobros `pending` (`clamp-to-ceiling.ts:clampUnlocked`), así que correrlo siempre
  // cuesta una lectura y cierra la CLASE de bug en vez de una instancia.
  await hooks?.afterCeilingDrop?.(result)
  await safeEmit(logger, 'onReservasUpdated', sockets.onReservasUpdated, result)
  await invalidateReservasCaches(cache, existing.hotelId)
  return result
}

/**
 * `updateReservation` + recálculo de la columna PERSISTIDA `reservations.pendingAmount`.
 *
 * `otherCharges`/`totalAmount`/`deposit` mueven el total cobrable, y esa columna es la que lee el
 * listado y el planning mientras el detalle lo recalcula al vuelo. Sin este paso el mismo campo
 * público devuelve dos números distintos según el endpoint (hallazgo ARCH-7).
 *
 * `addonsOf` es OBLIGATORIO a propósito: si fuera opcional, un llamador que lo omita reintroduce
 * la divergencia en silencio.
 */
export async function updateReservationWithBalance(
  addonsOf: AddonSource,
  /** OBLIGATORIO por el mismo motivo que `addonsOf`: sin él el saldo persistido se calcula contra
   *  `reservations.deposit` y contradice al detalle y al techo del cobro (GH-0.2). */
  paidOf: PaidSource,
  repo: any, logger: any, cache: any, sockets: any, id: string, dto: UpdateReservasDTO,
  currentUser: { id: string; role: string; hotelId?: string },
  roomRepo?: any, guestRepo?: any, groupRepo?: any, promoCodes?: PromoCodePort,
  /** SEC3-2 — recorte de links de pago vivos cuando el total cobrable baja. Lo cablea el service
   *  desde `orchestrationDeps` (connector `reservas-payment-requests`). Opcional: sin cobros
   *  `pending` es no-op. */
  ceilingGuard?: (item: ReservasDTO) => Promise<void>,
): Promise<ReservasDTO> {
  return updateReservation(repo, logger, cache, sockets, id, dto, currentUser, roomRepo, guestRepo, groupRepo, promoCodes, {
    // Dentro de la ventana: el socket sale con el saldo nuevo y la caché se invalida DESPUÉS.
    afterPersist: async (item) => ({ pendingAmount: await syncReservationPending(repo, addonsOf, id, paidOf, item) }),
    afterCeilingDrop: ceilingGuard,
  })
}

/** Devuelve la reserva borrada (SC-05: el service la necesita para el audit log). */
export async function deleteReservation(
  repo: any, logger: any, cache: any, sockets: any, id: string,
  currentUser: { id: string; role: string; hotelId?: string },
  /** SEC3-3 — libera los links de pago vivos de la reserva ANTES de borrarla. Sin esto, el link
   *  quedaba pagable sobre una reserva inexistente y el cobro entraba huérfano a `payments`.
   *  Fail-loud a propósito: si Stripe no responde, la reserva NO se borra (mismo invariante que
   *  `payment-requests/usecases/live-session.ts`: la sesión se mata antes de mutar la fila). */
  releaseRequests?: (hotelId: string, reservationId: string) => Promise<void>,
): Promise<any> {
  const existing = await repo.findById(id)
  if (!existing) throw new NotFoundError('Reserva no encontrada')
  if (currentUser.role !== 'super_admin' && existing.hotelId !== currentUser.hotelId) throw new AuthError('No autorizado')
  if (releaseRequests) await releaseRequests(String(existing.hotelId), String(existing.id))
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
