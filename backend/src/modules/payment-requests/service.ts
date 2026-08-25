// payment-requests/service.ts — Facade del módulo.
// CRUD de PaymentRequests + integración Stripe (status, checkout, webhook).
// hotelId forzado del JWT en create; assertOwnership en update/delete (P0 IDOR CR-25/26).
// El asiento del dinero sale por el puerto `StripePaymentPort` → módulo `payments` (conector
// `payment-requests-payments`), así el cobro entra a la conciliación bancaria.
// DEUDA F10 (parcial): handleWebhook aplica el pago a Reservations+FolioCharges vía repos
// cross-table; lo canónico sería onPaymentRequestPaid + conector sobre los módulos dueños.

import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { NotFoundError } from 'arckode-framework'
import { StripeService } from '../../services/stripe-service'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import type { ReservationPaidRepos } from '../../shared/usecases/reservation-paid'
import type {
  PaymentRequestDTO, CreatePaymentRequestDTO, UpdatePaymentRequestDTO,
  PaymentRequestQuery, CurrentUser, StripeStatusResult, CheckoutResult, WebhookResult,
} from './types'
import type { PaymentRequestsSockets } from './sockets'
import { processStripeWebhook } from './usecases/stripe-webhook'
import type { StripePaymentPort } from './usecases/payment-port'
import type { PaymentEventStore } from '../../services/payment-gateway/payment-events'
import type { EmailSender } from '../../services/email-sender'
import { createCheckoutForRequest, checkoutBlockedReason } from './usecases/create-checkout'
import { assertChargeableAmount, assertCeilingAfterCommit, chargeLockKey, type LiveChargesSource } from './usecases/charge-ceiling'
// El MISMO lock in-memory que `payments/usecases/deposits.ts` (DT-11): un solo registry de dinero.
import { withLock } from '../../shared/utils/async-lock'
import { getStripeStatus } from './usecases/stripe-status'
import { auditSafely, type AuditEntry, type AuditPort } from './usecases/audit'
import { deletePaymentRequest } from './usecases/delete-request'
import { updatePaymentRequest } from './usecases/update-request'
import { clampRequestsToCeiling, releaseRequestsOfReservation, releaseRequestsForCancellation, type ClampDeps } from './usecases/clamp-to-ceiling'
import { MoneyPortsHolder, type MoneyPorts } from './usecases/money-ports'

export class PaymentRequestsService {
  private sockets: PaymentRequestsSockets = {}
  private paymentPort: StripePaymentPort | null = null
  private auditPort: AuditPort | null = null
  private emailSender: EmailSender | null = null
  private hotelRepoForEmail: RepositoryAdapter<any> | null = null
  /** Lectura reserva→dinero por los dueños (payment-requests-money) — fail-closed, ver usecases/money-ports.ts. */
  private readonly money = new MoneyPortsHolder()
  private events: PaymentEventStore | null = null

  /** Cablea el envío del link de pago por email (connector email-bootstrap). */
  setEmailDeps(es: EmailSender, hotelRepo: RepositoryAdapter<any>): void { this.emailSender = es; this.hotelRepoForEmail = hotelRepo }

  setMoneyDeps(deps: MoneyPorts): void { this.money.set(deps) } // connector payment-requests-money — sin él, el techo falla fuerte (STR-A/GH-0.2)
  /** Barrera atómica del settle del webhook (BUG-1): la MISMA tabla que `payments` y `bookingengine`. */
  setEventStore(events: PaymentEventStore): void { this.events = events }

  private requirePaidRepos(): ReservationPaidRepos { return this.money.get().paidRepos }

  constructor(
    private readonly repo: RepositoryAdapter<PaymentRequestDTO>,
    private readonly reservationRepo: RepositoryAdapter<any>,
    private readonly folioRepo: RepositoryAdapter<any>,
    private readonly folioChargeRepo: RepositoryAdapter<any>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly auth: Auth,
    /** `reservation_addons` — OBLIGATORIO: sin él el pendiente se recalcula sin extras, en silencio. */
    private readonly addonRepo: RepositoryAdapter<any>,
  ) {}

  // ACUMULA (no pisa): implementación única en shared/utils/accumulate-sockets.ts.
  setSockets(s: Partial<PaymentRequestsSockets>): void { accumulateSockets(this.sockets as any, s as any) }

  /** Inyecta el conector `payment-requests-payments`. Sin él, el cobro no se asienta. */
  setPaymentDeps(deps: { paymentPort: StripePaymentPort }): void { this.paymentPort = deps.paymentPort }

  /** Conecta el audit log (connector `payment-requests-auditlog`). */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  private audit(entry: AuditEntry): Promise<void> {
    return auditSafely(this.auditPort, this.logger, entry)
  }

  /** super_admin puede especificar hotelId; resto usa el del JWT. */
  private hotelOfUser(user: CurrentUser, dtoHotelId?: string): string {
    if (user.role === 'super_admin') return dtoHotelId || user.hotelId || ''
    return user.hotelId || ''
  }

  // `paidRepos` (connector payment-requests-money): el techo mide contra lo cobrado de verdad (GH-0.2).
  private get ceilingDeps() { return { reservationRepo: this.reservationRepo, addonRepo: this.addonRepo, requestRepo: this.repo, paidRepos: this.requirePaidRepos(), liveCharges: this.money.get().liveCharges } }

  /** Deps del clamp (SEC3-2/SEC3-3): el techo + sockets/audit/log + el dinero por los dueños (RTC-7.4/8.3). */
  private get clampDeps(): ClampDeps { return { ...this.ceilingDeps, sockets: this.sockets, audit: (e) => this.audit(e), logger: this.logger, ...this.money.get() } }

  /** RTC-8.1: el techo agregado para la vía charge-card (connector `payments-ceiling`). */
  assertChargeableFor(params: { hotelId: string; reservationId: string; amount: number; excludePaymentId?: string }): Promise<void> {
    return assertChargeableAmount(this.ceilingDeps, params).then(() => undefined)
  }

  private async assertOwned(id: string, user: CurrentUser): Promise<PaymentRequestDTO> {
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Payment request no encontrado')
    const me = await this.userRepo.findById(user.id)
    this.auth.assertOwnership(item.hotelId, (me as any)?.hotelId ?? '', user.role, 'super_admin')
    return item
  }

  // ─── CRUD ──────────────────────────────────────────────

  async list(query: PaymentRequestQuery, user: CurrentUser): Promise<{ data: PaymentRequestDTO[] }> {
    const hotelId = this.hotelOfUser(user, query.hotelId)
    const filters: Record<string, unknown> = { hotelId: hotelId || '__none__' }
    if (query.reservationId) filters.reservationId = query.reservationId
    const data = await this.repo.findMany(filters)
    return { data }
  }

  async getById(id: string, user: CurrentUser): Promise<PaymentRequestDTO> {
    return this.assertOwned(id, user)
  }

  async create(dto: CreatePaymentRequestDTO, user: CurrentUser): Promise<PaymentRequestDTO> {
    const hotelId = this.hotelOfUser(user, dto.hotelId)
    // COR-3: techo + alta en UNA sección crítica (dos clicks concurrentes no ven el mismo saldo).
    return withLock(chargeLockKey(hotelId, dto.reservationId), async () => {
      // El monto NO lo dicta el cliente: se valida contra el saldo real de la reserva (SEC-1, ver
      // usecases/charge-ceiling.ts) y de paso se comprueba que la reserva sea de este hotel.
      const amount = await assertChargeableAmount(this.ceilingDeps, { hotelId, reservationId: dto.reservationId, amount: dto.amount })
      const item = await this.repo.create({
        hotelId, reservationId: dto.reservationId, amount, currency: dto.currency || 'USD',
        status: 'pending', sentTo: dto.sentTo || '', sentVia: dto.sentVia || 'email',
      } as Omit<PaymentRequestDTO, 'id'>)
      // Red multi-proceso: si otro creó a la vez, este link se revierte (COR-3).
      await assertCeilingAfterCommit(this.ceilingDeps, item, async () => { await this.repo.delete(item.id) })
      await this.sockets.onPaymentRequestCreated?.(item)
      return item
    })
  }

  async update(id: string, dto: UpdatePaymentRequestDTO, user: CurrentUser): Promise<PaymentRequestDTO> {
    const previous = await this.assertOwned(id, user) // IDOR CR-26: ownership antes de mutar
    // Misma sección crítica que el alta (COR-3): subir el monto también consume techo agregado.
    return withLock(chargeLockKey(previous.hotelId, previous.reservationId), () =>
      updatePaymentRequest(
        { repo: this.repo, ceilingDeps: this.ceilingDeps, sockets: this.sockets, audit: (e) => this.audit(e) },
        id, dto, user, previous,
      ))
  }

  async delete(id: string, user: CurrentUser): Promise<void> {
    const existing = await this.assertOwned(id, user) // IDOR CR-25: ownership antes de borrar
    return deletePaymentRequest(
      { repo: this.repo, sockets: this.sockets, audit: (e) => this.audit(e) },
      id, existing, user,
    )
  }

  // ─── SEC3-2/SEC3-3: el techo BAJA desde el lado de la reserva ── ver usecases/clamp-to-ceiling.ts
  /** Recorta los cobros `pending` al saldo cobrable ACTUAL (PUT totalAmount/otherCharges, baja de extra). */
  clampRequestsToCeiling(hotelId: string, reservationId: string, user: CurrentUser): Promise<number> { return clampRequestsToCeiling(this.clampDeps, hotelId, reservationId, user) }
  /** Libera TODOS los cobros `pending` antes de borrar la reserva: sin ella, un cobro queda huérfano. */
  releaseRequestsOfReservation(hotelId: string, reservationId: string, user: CurrentUser): Promise<number> { return releaseRequestsOfReservation(this.clampDeps, hotelId, reservationId, user) }

  /** RTC-8.7 — expira sesiones abiertas al CANCELAR (sin el 409 del borrado). */
  releaseRequestsForCancellation(hotelId: string, reservationId: string, user: CurrentUser): Promise<number> { return releaseRequestsForCancellation(this.clampDeps, hotelId, reservationId, user) }

  // ─── Stripe ────────────────────────────────────────────

  async stripeStatus(user: CurrentUser): Promise<StripeStatusResult> {
    return getStripeStatus(this.hotelOfUser(user))
  }

  // GH-0.4: el tenant sale de `pr.hotelId` (por eso el `assertOwned` va primero) — ver create-checkout.ts.
  async createCheckout(id: string, user: CurrentUser, origin: string): Promise<CheckoutResult | { status: number; body: any }> {
    const pr = await this.assertOwned(id, user)
    const hotelId = pr.hotelId
    // Precondiciones de la emisión, todas en un solo lugar (RTC-0.1) — ver create-checkout.ts.
    const blocked = checkoutBlockedReason(pr, await StripeService.isConfigured(hotelId))
    if (blocked) return blocked
    // QA7-4: última revalidación del techo antes de cobrar (el propio request se excluye del agregado).
    await assertChargeableAmount(this.ceilingDeps, { hotelId, reservationId: pr.reservationId, amount: pr.amount, excludeRequestId: pr.id })
    return createCheckoutForRequest(
      { repo: this.repo, reservationRepo: this.reservationRepo, userRepo: this.userRepo, hotelRepoForEmail: this.hotelRepoForEmail, emailSender: this.emailSender, audit: (e) => this.audit(e), logger: this.logger },
      pr, id, origin, user,
    )
  }

  /** Webhook público: el hotel viene en la RUTA y su secreto de firma es lo que autentica el mensaje. */
  async handleWebhook(hotelId: string, rawBody: string | Buffer, signature: string): Promise<WebhookResult> {
    return processStripeWebhook(
      {
        repo: this.repo, reservationRepo: this.reservationRepo,
        folioRepo: this.folioRepo, folioChargeRepo: this.folioChargeRepo,
        // `paidRepos`: lo cobrado real (GH-0.2), no `reservations.deposit`.
        addonRepo: this.addonRepo, paidRepos: this.requirePaidRepos(),
        logger: this.logger, sockets: this.sockets, paymentPort: this.paymentPort, events: this.events,
        audit: (entry) => this.audit(entry),
      },
      hotelId, rawBody, signature,
    )
  }
}
