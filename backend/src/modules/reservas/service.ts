// reservas/service.ts — Facade pública del módulo. Casos de uso, sin HTTP ni imports de otros módulos.
// Depende de RepositoryAdapter<ReservasDTO> (no del ORM directo); lógica en ./usecases/.
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import type { StorageService, FileUpload } from 'arckode-framework/modules/storage'
import type { ReservasDTO, CreateReservasDTO, UpdateReservasDTO, ReservasQuery, ReservasPaginated } from './types'
import type { ReservasSockets } from './sockets'
import { checkinValidation, checkoutValidation, executeCheckin } from './usecases/checkin'
import { executeCheckout as executeCheckoutUsecase } from './usecases/checkout'
import { sendLockCodeEmail as sendLockCodeEmailUsecase } from './usecases/lock-code-email'
import { NullEmailSender, type EmailSender } from '../../services/email-sender'
import { dispatchCreateEmail } from './usecases/reservation-notifications'
import { setGuaranteePin as setGuaranteePinUsecase, getGuaranteeHasPin as getGuaranteeHasPinUsecase, unlockGuaranteeCard as unlockGuaranteeCardUsecase } from './usecases/guarantee'
import { listReservations, getReservationById, createReservation, updateReservationWithBalance, deleteReservation, type PromoCodePort } from './usecases/crud'
import { paidSourceFrom, type PaidSource } from '../../shared/usecases/reservation-paid'
import { paymentsOfReservation as paymentsOfReservationUsecase, hasInvoiceForReservation as hasInvoiceForReservationUsecase } from './usecases/reservation-money-links'
import { cancelReservation as cancelReservationUsecase } from './usecases/cancel'
import { approveReservation as approveReservationUsecase } from './usecases/approve'
import { cancelReservationBySystem, type SystemCancelInput, type SystemCancelOutcome } from './usecases/cancel-system'
import { previewCancellation, type CancelPreview } from './usecases/cancel-preview'
import { getPreCheckinData as getPreCheckinDataUsecase, submitPreCheckin as submitPreCheckinUsecase, uploadPreCheckinPhoto as uploadPreCheckinPhotoUsecase } from './usecases/pre-checkin'
import { getExtendedDetail as getExtendedDetailUsecase, getAuditTrail as getAuditTrailUsecase } from './usecases/detail'
import { getBookingEngineDashboard as getBookingEngineDashboardUsecase } from './usecases/booking-engine'
import { quoteReschedule as quoteRescheduleUsecase, commitReschedule as commitRescheduleUsecase, type RescheduleInput, type RescheduleChargePort } from './usecases/reschedule'
import { quoteStay as quoteStayUsecase, type QuoteParams } from './usecases/quote'
import type { ReservasQueries } from './usecases/reservas-queries'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import { reservationChangedNotifier, type ReservationChangedNotifier } from './usecases/reservation-changed'
import { invalidateReservasCaches } from './usecases/cache'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { requireMessageLogSource } from './usecases/message-log'
import { syncPendingAfterPayment, pendingAfterPaymentDeps, type MoneyRowRef } from './usecases/sync-pending-after-payment'
import type { ReservationMoneyPort } from './usecases/money-port'
import { settleFolioForCheckout as settleFolioForCheckoutUsecase, type SettleInput, type SettleActor, type SettleFolioPort, type SettleReservation, type SettleResult } from './usecases/settle-port'
import { ceilingGuardOf, type PaymentRequestsCeilingPort } from './usecases/ceiling-guard'
import type { ReservasOrchestrationDeps } from './usecases/orchestration-deps'

export class ReservasService {
  private sockets: ReservasSockets = {}
  private auditPort: AuditPort | null = null
  setAuditDeps(port: AuditPort): void { this.auditPort = port }
  private emailSender: EmailSender = new NullEmailSender()
  private messageLogRepo: RepositoryAdapter<any> | null = null
  setEmailDeps(es: EmailSender, r: RepositoryAdapter<any>): void { this.emailSender = es; this.messageLogRepo = r }
  private notifyDeps = () => ({ emailSender: this.emailSender, messageLogRepo: this.messageLogRepo, guestRepo: this.guestRepo, roomRepo: this.roomRepo, hotelRepo: this.hotelRepo, logger: this.logger })
  getNotifyDeps() { return this.notifyDeps() } // deps reales (post setEmailDeps) para checkin/checkout

  /** Puertos cross-módulo que inyectan los connectors. Tipo en usecases/orchestration-deps.ts. */
  private orchestrationDeps: ReservasOrchestrationDeps = {}
  setOrchestrationDeps(deps: ReservasOrchestrationDeps): void {
    Object.assign(this.orchestrationDeps, deps)
    if (deps.moneyPort) this.queries.setMoneyPort(deps.moneyPort) // lo consume ReservasQueries
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
    /** `RateOverrides` — tarifa por FECHA. AL FINAL: no corre ningún posicional existente. */ private readonly rateOverrideRepo?: RepositoryAdapter<any>,
    /** Requerimiento 7 (2026-09-03) — `Configuration` KV general, para `resolveChildPolicy` al repreciar un reagendado con niños. AL FINAL, mismo criterio. */ private readonly configRepo?: RepositoryAdapter<any>,
  ) {}

  // ACUMULA handlers (cadena secuencial; implementación única en shared/utils/accumulate-sockets.ts).
  setSockets(s: Partial<ReservasSockets>): void { accumulateSockets(this.sockets as any, s as any) }
  /** Invalidación a mano para altas que bypassan el CRUD (ver reservas-bookingengine.ts). */
  async invalidateListCache(hotelId: string): Promise<void> { await invalidateReservasCaches(this.cache, hotelId) }
  async list(query: ReservasQuery, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasPaginated> { return listReservations(this.repo, this.userRepo, this.cache, this.logger, query, currentUser) }
  async getById(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
    this.logger.info('Obteniendo reserva', { id, userId: currentUser.id })
    return getReservationById(this.repo, id, currentUser)
  }
  async create(dto: CreateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
    this.logger.info('Creando reserva', { userId: currentUser.id, roomId: dto.roomId })
    const item = await createReservation(this.repo, this.blockRepo, this.logger, this.cache, this.sockets, this.notifyDeps(), dto, currentUser, this.roomRepo, this.guestRepo, this.dateRestrictionRepo, this.orchestrationDeps.promoCodes, { seasonAssignmentRepo: this.seasonAssignmentRepo, roomRateRepo: this.roomRateRepo, rateOverrideRepo: this.rateOverrideRepo, seasonsRepo: this.seasonsRepo }, this.configRepo)
    dispatchCreateEmail(this.notifyDeps(), dto, item)
    return item
  }
  async update(id: string, dto: UpdateReservasDTO, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> {
    this.logger.info('Actualizando reserva', { id, userId: currentUser.id })
    // SEC3-2: el clamp de links vivos, si el connector lo cableó (ver orchestrationDeps).
    const c = this.orchestrationDeps.paymentRequestsCeiling
    return updateReservationWithBalance((rid, hid) => this.queries.getReservationAddons(rid, hid), this.paidSource(), this.repo, this.logger, this.cache, this.sockets, id, dto, currentUser, this.roomRepo, this.guestRepo, this.groupRepo, this.orchestrationDeps.promoCodes,
      c ? (item) => c.clamp(String(item.hotelId), String(item.id)) : undefined, this.configRepo)
  }
  async delete(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<void> {
    this.logger.info('Eliminando reserva', { id, userId: currentUser.id }) // SEC3-3: release antes del delete
    const c = this.orchestrationDeps.paymentRequestsCeiling
    const existing = await deleteReservation(this.repo, this.logger, this.cache, this.sockets, id, currentUser,
      c ? (h, r) => c.releaseAll(h, r) : undefined)
    const locator = existing?.externalLocator ? ` (${existing.externalLocator})` : ''
    await auditSafely(this.auditPort, this.logger, { hotelId: existing?.hotelId, userId: currentUser.id, action: 'reservation.delete', entity: 'reservation', entityId: id,
      detail: `Reserva${locator} ${existing?.checkIn} → ${existing?.checkOut}, habitación ${existing?.roomId}, monto ${existing?.totalAmount} — eliminada` })
  }

  // ── CHECK-IN ─────────────────────────────────────────────────────────────
  async checkin(id: string, user: any): Promise<any> { return checkinValidation(this.repo, id, user, this.auth) }
  async executeCheckin(r: any, user: any, deps: { orm: any; pushAvailabilityToChannex?: any; sendCheckinEmail?: any; logger?: any }): Promise<any> {
    return executeCheckin(r, user, { orm: deps.orm, logger: deps.logger || this.logger, repo: this.repo, queries: this.queries })
  }

  // ── CHECK-OUT ──────────────────────────────────────────────────────────
  async checkout(id: string, user: any): Promise<any> {
    return checkoutValidation(this.repo, id, user, this.auth)
  }

  async executeCheckout(r: any, user: any, deps: { orm: any; invalidateHousekeepingCache?: () => Promise<void>; pushAvailabilityToChannex?: any; dispatchLifecycleEmail?: any; logger?: any }): Promise<any> {
    // R-1 (2026-08-19): flujo con guard de carrera extraído a usecases/checkout.ts
    // (mismo lugar que executeCheckin; el service delega y queda bajo las 200 líneas).
    return executeCheckoutUsecase(r, user, {
      orm: deps.orm,
      queries: this.queries,
      sockets: this.sockets,
      logger: deps.logger || this.logger,
    })
  }

  // ── SETTLEMENT (folio → invoice → payment) — ver usecases/settle-port.ts ────────────────
  settleFolioForCheckout(reservation: SettleReservation, settle: SettleInput | null | undefined, user: SettleActor): Promise<SettleResult | null> {
    return settleFolioForCheckoutUsecase(this.orchestrationDeps.settleFolio, reservation, settle, user)
  }

  /** Lo COBRADO, derivado de `payments` (GH-0.2) — ver shared/usecases/reservation-paid.ts. */
  paidSource(): PaidSource { return paidSourceFrom(this.queries.paidRepos) }

  // Ver usecases/reservation-money-links.ts — los usa el connector del cambio de reserva.
  paymentsOfReservation(hotelId: string, rid: string) { return paymentsOfReservationUsecase(this.queries.paidRepos, hotelId, rid) }
  hasInvoiceForReservation(hotelId: string, rid: string) { return hasInvoiceForReservationUsecase(this.queries.paidRepos, hotelId, rid) }

  addonsCeilingGuard() { return (rid: string, hid: string) => ceilingGuardOf(this.orchestrationDeps.paymentRequestsCeiling, 'clamp')(hid, rid) } // SEC3-2/RTC-8.8, fail-closed — ver usecases/ceiling-guard.ts

  /** COR-1/RTC-7.3 — un movimiento de dinero mueve el saldo Y baja el techo (connector payments-reservas). */
  syncPendingAfterPayment(row: MoneyRowRef): Promise<number | null> {
    return syncPendingAfterPayment(pendingAfterPaymentDeps(this.repo, this.queries, this.paidSource(), this.reservationChanged(), this.logger, this.orchestrationDeps.paymentRequestsCeiling?.clamp), row)
  }

  // ── RESCHEDULE (mover/extender desde planning) ──────────────────────────
  // `addonsOf` (STR-2): el reprice cambia `totalAmount` → el saldo persistido se mueve con él. `ceilingGuard` (SEC3-2): un reprice que BAJA el total recorta los links de pago vivos — mismo connector que `update()` (reservas-payment-requests).
  private rescheduleDeps = () => ({ repo: this.repo, roomRepo: this.roomRepo, seasonAssignmentRepo: this.seasonAssignmentRepo, roomRateRepo: this.roomRateRepo, rateOverrideRepo: this.rateOverrideRepo, seasonsRepo: this.seasonsRepo, configRepo: this.configRepo, addonsOf: (rid: string, hid: string) => this.queries.getReservationAddons(rid, hid), paidOf: this.paidSource(), ceilingGuard: this.orchestrationDeps.paymentRequestsCeiling?.clamp })
  async quoteStay(params: QuoteParams): Promise<any> { return quoteStayUsecase({ roomRepo: this.roomRepo, seasonAssignmentRepo: this.seasonAssignmentRepo, roomRateRepo: this.roomRateRepo, seasonsRepo: this.seasonsRepo, rateOverrideRepo: this.rateOverrideRepo }, params) }

  async quoteReschedule(id: string, input: RescheduleInput, user: { id: string; role: string; hotelId?: string }): Promise<any> {
    return quoteRescheduleUsecase(this.rescheduleDeps(), id, input, user)
  }

  async reschedule(id: string, input: RescheduleInput, user: { id: string; role: string; hotelId?: string }): Promise<any> {
    return commitRescheduleUsecase({ ...this.rescheduleDeps(), logger: this.logger, cache: this.cache, sockets: this.sockets, chargePort: this.orchestrationDeps.chargeReschedule, creditPort: this.orchestrationDeps.creditReschedule, audit: (e) => this.queries.createAuditLog({ id: crypto.randomUUID(), entity: 'Reservations', entityId: id, action: 'reschedule', userId: user.id, hotelId: String(e.hotelId), detail: JSON.stringify(e), createdAt: new Date().toISOString() }) }, id, input, user)
  }

  // ── PRE-CHECKIN (público) ──────────────────────────────────────────────
  async getPreCheckinData(hash: string): Promise<any> { return getPreCheckinDataUsecase(hash, this.hotelRepo, this.roomRepo, this.guestRepo, this.queries) }

  async submitPreCheckin(hash: string, body: any, signatureFile: FileUpload): Promise<void> { return submitPreCheckinUsecase(hash, body, this.queries, this.guestRepo, signatureFile, this.storage) }
  async uploadPreCheckinPhoto(hash: string, file: FileUpload): Promise<{ url: string }> {
    return uploadPreCheckinPhotoUsecase(hash, file, this.queries, this.storage)
  }

  // ── EXTENDED RESERVATION DETAIL ─────────────────────────────────────────
  /** Efectos de un cambio de saldo hecho fuera del CRUD (extras): socket + invalidación del listado. */
  reservationChanged(): ReservationChangedNotifier { return reservationChangedNotifier({ logger: this.logger, cache: this.cache, sockets: this.sockets }) }

  async getExtendedDetail(id: string, currentUser: any): Promise<any> {
    const messageLogs = requireMessageLogSource(this.orchestrationDeps.listMessageLogs)
    return getExtendedDetailUsecase(this.repo, this.guestRepo, this.roomRepo, this.queries, id, currentUser, messageLogs, this.userRepo)
  }

  // ── AUDIT TRAIL ────────────────────────────────────────────────────────
  async getAuditTrail(id: string, currentUser: any): Promise<any[]> { return getAuditTrailUsecase(this.repo, this.queries, id, currentUser) }

  // ── GUARANTEE CARD ──────────────────────────────────────────────────────
  async setGuaranteePin(user: any, body: any): Promise<{ success: boolean }> { return setGuaranteePinUsecase(this.queries, this.userRepo, user, body) }

  async getGuaranteeHasPin(user: any): Promise<{ hasPin: boolean }> { return getGuaranteeHasPinUsecase(this.queries, this.userRepo, user) }

  async unlockGuaranteeCard(reservationId: string, user: any, body: any): Promise<any> { return unlockGuaranteeCardUsecase(this.queries, this.repo, this.userRepo, reservationId, user, body, this.auth) }
  // ── CANCEL (F2 plan #627) — `cancel` aplica la política del hotel; `cancelPreview` hace el MISMO cálculo sin persistir ni emitir ──
  async cancel(id: string, dto: { reason?: string }, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> { return cancelReservationUsecase({ repo: this.repo, policyRepo: this.policyRepo!, hotelRepo: this.hotelRepo, logger: this.logger, cache: this.cache, sockets: this.sockets, releaseChargeSessions: (rid: string, hid: string) => ceilingGuardOf(this.orchestrationDeps.paymentRequestsCeiling, 'releaseForCancel')(hid, rid) }, id, dto, currentUser, this.auth) }
  async approve(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<ReservasDTO> { return approveReservationUsecase({ repo: this.repo, cache: this.cache }, id, currentUser, this.auth) }
  async cancelPreview(id: string, currentUser: { id: string; role: string; hotelId?: string }): Promise<CancelPreview> { return previewCancellation({ repo: this.repo, policyRepo: this.policyRepo!, hotelRepo: this.hotelRepo, guestRepo: this.guestRepo }, id, currentUser, this.auth) }
  /** Cancelación de SISTEMA (OTA/IA): sin usuario logueado, scoping por `hotelId`. Ver usecases/cancel-system.ts. Lo consumen los connectors canales-reservas / ai-recepcionista-reservas / ai-gerente-reservas. */
  async cancelBySystem(id: string, input: SystemCancelInput): Promise<SystemCancelOutcome> { return cancelReservationBySystem({ repo: this.repo, policyRepo: this.policyRepo!, hotelRepo: this.hotelRepo, logger: this.logger, cache: this.cache, sockets: this.sockets, releaseChargeSessions: (rid: string, hid: string) => ceilingGuardOf(this.orchestrationDeps.paymentRequestsCeiling, 'releaseForCancel')(hid, rid) }, id, input) }

  async getBookingEngineDashboard(user: any): Promise<any> { return getBookingEngineDashboardUsecase(this.queries, user) }
  async sendLockCodeEmail(id: string, user: any, deps: { orm: any }): Promise<{ sentTo: string }> {
    return sendLockCodeEmailUsecase({ orm: deps.orm, reservationRepo: this.repo, guestRepo: this.guestRepo, userRepo: this.userRepo, emailSender: this.emailSender, roomRepo: this.roomRepo, hotelRepo: this.hotelRepo, messageLogRepo: this.messageLogRepo, logger: this.logger }, id, user)
  }
}
