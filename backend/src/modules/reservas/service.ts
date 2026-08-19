// reservas/service.ts — Facade pública del módulo. Casos de uso, sin HTTP ni imports de otros módulos.
// Depende de RepositoryAdapter<ReservasDTO> (no del ORM directo); lógica en ./usecases/.
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import type { StorageService, FileUpload } from 'arckode-framework/modules/storage'
import type { ReservasDTO, CreateReservasDTO, UpdateReservasDTO, ReservasQuery, ReservasPaginated } from './types'
import type { ReservasSockets } from './sockets'
import { checkinValidation, checkoutValidation, executeCheckin } from './usecases/checkin'
import { sendLockCodeEmail as sendLockCodeEmailUsecase } from './usecases/lock-code-email'
import { NullEmailSender, type EmailSender } from '../../services/email-sender'
import { dispatchCreateEmail } from './usecases/reservation-notifications'
import { setGuaranteePin as setGuaranteePinUsecase, getGuaranteeHasPin as getGuaranteeHasPinUsecase, unlockGuaranteeCard as unlockGuaranteeCardUsecase } from './usecases/guarantee'
import { listReservations, getReservationById, createReservation, updateReservation, deleteReservation, type PromoCodePort } from './usecases/crud'
import { cancelReservation as cancelReservationUsecase } from './usecases/cancel'
import { cancelReservationBySystem, type SystemCancelInput, type SystemCancelOutcome } from './usecases/cancel-system'
import { previewCancellation, type CancelPreview } from './usecases/cancel-preview'
import { getPreCheckinData as getPreCheckinDataUsecase, submitPreCheckin as submitPreCheckinUsecase, uploadPreCheckinPhoto as uploadPreCheckinPhotoUsecase } from './usecases/pre-checkin'
import { getExtendedDetail as getExtendedDetailUsecase, getAuditTrail as getAuditTrailUsecase } from './usecases/detail'
import { getBookingEngineDashboard as getBookingEngineDashboardUsecase } from './usecases/booking-engine'
import { quoteReschedule as quoteRescheduleUsecase, commitReschedule as commitRescheduleUsecase, type RescheduleInput, type RescheduleChargePort } from './usecases/reschedule'
import { quoteStay as quoteStayUsecase, type QuoteParams } from './usecases/quote'
import type { ReservasQueries } from './usecases/reservas-queries'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'

export class ReservasService {
  private sockets: ReservasSockets = {}
  private auditPort: AuditPort | null = null
  setAuditDeps(port: AuditPort): void { this.auditPort = port }
  private emailSender: EmailSender = new NullEmailSender()
  private messageLogRepo: RepositoryAdapter<any> | null = null
  setEmailDeps(es: EmailSender, r: RepositoryAdapter<any>): void { this.emailSender = es; this.messageLogRepo = r }
  private notifyDeps = () => ({ emailSender: this.emailSender, messageLogRepo: this.messageLogRepo, guestRepo: this.guestRepo, roomRepo: this.roomRepo, hotelRepo: this.hotelRepo, logger: this.logger })

  private orchestrationDeps: { // cross-module deps (set from composition-root)
    pushAvailabilityToChannex?: (hotelId: string, roomId: string) => void
    sendCheckinEmail?: (deps: any, data: any) => Promise<void>
    dispatchLifecycleEmail?: (deps: any, data: any) => Promise<void>
    settleFolio?: (params: { reservationId: string; hotelId: string; guestId: string | null; roomId: string | null; settle?: { amount: number; method: string; reference?: string } | null }, user: any) => Promise<{ folioId: string; invoiceId: string | null; balance: number; amountPaid: number; invoiceNumber: string | null }>
    chargeReschedule?: RescheduleChargePort
    promoCodes?: PromoCodePort // FIX 2026-07-31 — connectors/reservas-promocodes.ts
  } = {}
  setOrchestrationDeps(deps: typeof ReservasService.prototype.orchestrationDeps): void {
    Object.assign(this.orchestrationDeps, deps)
  }

  constructor(
    private readonly repo: RepositoryAdapter<ReservasDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    private readonly guestRepo: RepositoryAdapter<any>,
    private readonly roomRepo: RepositoryAdapter<any>,
    private readonly hotelRepo: RepositoryAdapter<any>,
    private readonly queries: ReservasQueries,
    private readonly blockRepo?: RepositoryAdapter<any>,
    private readonly dateRestrictionRepo?: RepositoryAdapter<any>,
    private readonly policyRepo?: RepositoryAdapter<any>,
    /** Pertenencia del `groupId` del update — ver validate-update.ts. */ private readonly groupRepo?: RepositoryAdapter<any>,
    /** Reprice del reagendado (temporadas → tarifas). OPCIONALES: sin ellos cae a `rooms.basePrice` — ver usecases/reprice.ts. */ private readonly seasonAssignmentRepo?: RepositoryAdapter<any>, private readonly roomRateRepo?: RepositoryAdapter<any>,
    /** Storage (foto de documento + firma del pre-checkin público). Sin él, `submitPreCheckin`/`uploadPreCheckinPhoto` fallan — ver composition-root.ts. */ private readonly storage?: StorageService,
    /** Catálogo `Seasons` (label/color) para el quote del wizard — ver index.ts. */ private readonly seasonsRepo?: RepositoryAdapter<any>,
  ) {}

  // ACUMULA handlers (cadena secuencial). Para ejecución paralela independiente -> EventBus en composition-root.ts.
  setSockets(s: Partial<ReservasSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  async list(query: ReservasQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasPaginated> {
    return listReservations(this.repo, this.userRepo, this.cache, this.logger, query, currentUser)
  }
  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
    this.logger.info('Obteniendo reserva', { id, userId: currentUser.id })
    return getReservationById(this.repo, id, currentUser)
  }
  async create(dto: CreateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
    this.logger.info('Creando reserva', { userId: currentUser.id, roomId: dto.roomId })
    const item = await createReservation(this.repo, this.blockRepo, this.logger, this.cache, this.sockets, this.notifyDeps(), dto, currentUser, this.roomRepo, this.guestRepo, this.dateRestrictionRepo, this.orchestrationDeps.promoCodes, { seasonAssignmentRepo: this.seasonAssignmentRepo, roomRateRepo: this.roomRateRepo })
    dispatchCreateEmail(this.notifyDeps(), dto, item)
    return item
  }
  async update(id: string, dto: UpdateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
    this.logger.info('Actualizando reserva', { id, userId: currentUser.id })
    return updateReservation(this.repo, this.logger, this.cache, this.sockets, id, dto, currentUser, this.roomRepo, this.guestRepo, this.groupRepo, this.orchestrationDeps.promoCodes)
  }
  async delete(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    this.logger.info('Eliminando reserva', { id, userId: currentUser.id })
    const existing = await deleteReservation(this.repo, this.logger, this.cache, this.sockets, id, currentUser)
    const locator = existing?.externalLocator ? ` (${existing.externalLocator})` : ''
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing?.hotelId, userId: currentUser.id, action: 'reservation.delete',
      entity: 'reservation', entityId: id,
      detail: `Reserva${locator} ${existing?.checkIn} → ${existing?.checkOut}, habitación ${existing?.roomId}, monto ${existing?.totalAmount} — eliminada`,
    })
  }

  // ── CHECK-IN ─────────────────────────────────────────────────────────────
  async checkin(id: string, user: any): Promise<any> {
    return checkinValidation(this.repo, id, user, this.auth)
  }
  async executeCheckin(r: any, user: any, deps: { orm: any; pushAvailabilityToChannex?: any; sendCheckinEmail?: any; logger?: any }): Promise<any> {
    const result = await executeCheckin(r, user, {
      orm: deps.orm,
      logger: deps.logger || this.logger,
      repo: this.repo,
      queries: this.queries,
    })
    return result
  }

  // ── CHECK-OUT ──────────────────────────────────────────────────────────
  async checkout(id: string, user: any): Promise<any> {
    return checkoutValidation(this.repo, id, user, this.auth)
  }

  async executeCheckout(r: any, user: any, deps: { orm: any; invalidateHousekeepingCache?: () => Promise<void>; pushAvailabilityToChannex?: any; dispatchLifecycleEmail?: any; logger?: any }): Promise<any> {
    const nowIso = new Date().toISOString()
    try {
      await this.queries.updateReservation(r.id, { status: 'checked_out', checkedOutAt: nowIso })
    } catch (e: any) {
      throw new Error(`Error interno al procesar check-out: ${e.message}`)
    }
    const log = deps.logger || this.logger
    this.queries.createAuditLog({ id: crypto.randomUUID(), entity: 'Reservations', entityId: r.id, action: 'checkout', userId: user.id, hotelId: r.hotelId, detail: JSON.stringify({ roomId: r.roomId, guestId: r.guestId, checkIn: r.checkIn, checkOut: r.checkOut }), createdAt: nowIso })
    await this.sockets.onReservationCheckedOut?.({ reservationId: r.id, roomId: r.roomId, hotelId: r.hotelId, guestId: r.guestId ?? null, totalAmount: Number(r.totalAmount) || 0 })
    return { ok: true, reservationId: r.id, status: 'checked_out' }
  }

  // ── SETTLEMENT (folio → invoice → payment) ─────────────────────────────
  async settleFolioForCheckout(reservation: any, settle: { amount: number; method: string; reference?: string } | null | undefined, user: any): Promise<any> {
    if (!this.orchestrationDeps.settleFolio) return null
    return this.orchestrationDeps.settleFolio({
      reservationId: reservation.id,
      hotelId: reservation.hotelId,
      guestId: reservation.guestId || null,
      roomId: reservation.roomId,
      settle: settle || null,
    }, user)
  }

  // ── RESCHEDULE (mover/extender desde planning) ──────────────────────────
  private rescheduleDeps = () => ({ repo: this.repo, roomRepo: this.roomRepo, seasonAssignmentRepo: this.seasonAssignmentRepo, roomRateRepo: this.roomRateRepo })
  async quoteStay(params: QuoteParams): Promise<any> { return quoteStayUsecase({ roomRepo: this.roomRepo, seasonAssignmentRepo: this.seasonAssignmentRepo, roomRateRepo: this.roomRateRepo, seasonsRepo: this.seasonsRepo }, params) }

  async quoteReschedule(id: string, input: RescheduleInput, user: { id: string; role: string; hotelId?: string }): Promise<any> {
    return quoteRescheduleUsecase(this.rescheduleDeps(), id, input, user)
  }

  async reschedule(id: string, input: RescheduleInput, user: { id: string; role: string; hotelId?: string }): Promise<any> {
    return commitRescheduleUsecase({ ...this.rescheduleDeps(), logger: this.logger, cache: this.cache, sockets: this.sockets, chargePort: this.orchestrationDeps.chargeReschedule, audit: (e) => this.queries.createAuditLog({ id: crypto.randomUUID(), entity: 'Reservations', entityId: id, action: 'reschedule', userId: user.id, hotelId: String(e.hotelId), detail: JSON.stringify(e), createdAt: new Date().toISOString() }) }, id, input, user)
  }

  // ── PRE-CHECKIN (público) ──────────────────────────────────────────────
  async getPreCheckinData(hash: string): Promise<any> {
    return getPreCheckinDataUsecase(hash, this.hotelRepo, this.roomRepo, this.guestRepo, this.queries)
  }

  async submitPreCheckin(hash: string, body: any, signatureFile: FileUpload): Promise<void> {
    return submitPreCheckinUsecase(hash, body, this.queries, this.guestRepo, signatureFile, this.storage)
  }
  async uploadPreCheckinPhoto(hash: string, file: FileUpload): Promise<{ url: string }> {
    return uploadPreCheckinPhotoUsecase(hash, file, this.queries, this.storage)
  }

  // ── EXTENDED RESERVATION DETAIL ─────────────────────────────────────────
  async getExtendedDetail(id: string, currentUser: any): Promise<any> {
    return getExtendedDetailUsecase(this.repo, this.guestRepo, this.roomRepo, this.queries, id, currentUser)
  }

  // ── AUDIT TRAIL ────────────────────────────────────────────────────────
  async getAuditTrail(id: string, currentUser: any): Promise<any[]> { return getAuditTrailUsecase(this.repo, this.queries, id, currentUser) }

  // ── GUARANTEE CARD ──────────────────────────────────────────────────────
  async setGuaranteePin(user: any, body: any): Promise<{ success: boolean }> {
    return setGuaranteePinUsecase(this.queries, this.userRepo, user, body)
  }

  async getGuaranteeHasPin(user: any): Promise<{ hasPin: boolean }> { return getGuaranteeHasPinUsecase(this.queries, this.userRepo, user) }

  async unlockGuaranteeCard(reservationId: string, user: any, body: any): Promise<any> {
    return unlockGuaranteeCardUsecase(this.queries, this.repo, this.userRepo, reservationId, user, body, this.auth)
  }
  // ── CANCEL (F2 plan #627) — `cancel` aplica la política del hotel; `cancelPreview` hace el MISMO cálculo sin persistir ni emitir ──
  async cancel(id: string, dto: { reason?: string }, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> { return cancelReservationUsecase({ repo: this.repo, policyRepo: this.policyRepo!, hotelRepo: this.hotelRepo, logger: this.logger, cache: this.cache, sockets: this.sockets }, id, dto, currentUser, this.auth) }
  async cancelPreview(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<CancelPreview> { return previewCancellation({ repo: this.repo, policyRepo: this.policyRepo!, hotelRepo: this.hotelRepo, guestRepo: this.guestRepo }, id, currentUser, this.auth) }
  /** Cancelación de SISTEMA (OTA/IA): sin usuario logueado, scoping por `hotelId`. Ver usecases/cancel-system.ts. Lo consumen los connectors canales-reservas / ai-recepcionista-reservas / ai-gerente-reservas. */
  async cancelBySystem(id: string, input: SystemCancelInput): Promise<SystemCancelOutcome> { return cancelReservationBySystem({ repo: this.repo, policyRepo: this.policyRepo!, hotelRepo: this.hotelRepo, logger: this.logger, cache: this.cache, sockets: this.sockets }, id, input) }
  async getBookingEngineDashboard(user: any): Promise<any> { return getBookingEngineDashboardUsecase(this.queries, user) }
  async sendLockCodeEmail(id: string, user: any, deps: { orm: any }): Promise<{ sentTo: string }> {
    return sendLockCodeEmailUsecase({ orm: deps.orm, reservationRepo: this.repo, guestRepo: this.guestRepo, emailSender: this.emailSender, roomRepo: this.roomRepo, hotelRepo: this.hotelRepo, messageLogRepo: this.messageLogRepo, logger: this.logger }, id, user)
  }
}
