// payments/service.ts — Facade pública del módulo Payments. Orquestador delgado que delega a usecases/
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { paymentsLinkedTo, settledNetOfReservation, type PaymentReservationRef } from './usecases/reservation-money'
import type {
  PaymentDTO, CreatePaymentDTO, ChargeCardDTO, PaymentLinkDTO, CreatePaymentLinkDTO,
  DepositDTO, CreateDepositDTO, RefundDepositDTO, PaymentsQuery, PaymentsPaginated,
  ReconciliationEntry, ReconciliationResult,
} from './types'
import { settleHooks, type PaymentsSockets } from './sockets'
import { StripeUseCase } from './usecases/stripe'
import type { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import type { PaymentEventStore } from '../../services/payment-gateway/payment-events'
import { PaymentCrudUseCase } from './usecases/payment-crud'
import { PaymentLinksUseCase } from './usecases/payment-links'
import { DepositsUseCase } from './usecases/deposits'
import { ReconciliationUseCase } from './usecases/reconciliation'
import { refundPayment } from './usecases/refund'
import { chargeCard, type ChargeCeilingPort } from './usecases/charge-card'
import { liveChargesPort, type LiveChargesPort } from './usecases/live-charges'
import { settleStripeWebhook } from './usecases/settle-webhook'
import { cancelHeldDeposits } from './usecases/cancel-deposits'
import {
  auditSafely, chargeEntry, refundEntry, depositRefundEntry, depositReleaseEntry,
  type AuditEntry, type AuditPort, type Actor,
} from './usecases/audit'

export class PaymentsService {
  private sockets: PaymentsSockets = {}
  private stripe: StripeUseCase
  private crud: PaymentCrudUseCase
  private links: PaymentLinksUseCase
  private deposits: DepositsUseCase
  private reconciliation: ReconciliationUseCase
  private auditPort: AuditPort | null = null
  /** RTC-8.1: techo del cobro para la vía charge-card (connector `payments-ceiling`) — fail-closed en el usecase. */
  private ceiling: ChargeCeilingPort | null = null
  /** RTC-8.2/8.3 — sesiones de checkout vivas de esta vía, para `connectors/payment-requests-money`. */
  readonly liveChargePort: LiveChargesPort

  constructor(
    private readonly paymentRepo: RepositoryAdapter<PaymentDTO>,
    linkRepo: RepositoryAdapter<PaymentLinkDTO>,
    depositRepo: RepositoryAdapter<DepositDTO>,
    private readonly logger: Logger,
    cache: CacheAdapter,
    private readonly auth?: any,
    userRepo?: RepositoryAdapter<any>,
    registry?: PaymentGatewayRegistry,
    private readonly events?: PaymentEventStore,
    /** Verifican folioId/invoiceId/guestId/reservationId del body contra el hotel — ver payment-crud (SEC3-5). */
    folioRepo?: RepositoryAdapter<any>, invoiceRepo?: RepositoryAdapter<any>, guestRepo?: RepositoryAdapter<any>, reservationRepo?: RepositoryAdapter<any>,
  ) {
    if (!registry) throw new Error('payments: PaymentGatewayRegistry es requerido (pasarela por hotel)')
    this.stripe = new StripeUseCase(registry, logger)
    this.crud = new PaymentCrudUseCase(paymentRepo, logger, auth, userRepo, folioRepo, invoiceRepo, guestRepo, reservationRepo)
    this.liveChargePort = liveChargesPort(paymentRepo, this.crud)
    this.links = new PaymentLinksUseCase(linkRepo, auth, userRepo)
    this.deposits = new DepositsUseCase(depositRepo, logger, auth, userRepo)
    this.reconciliation = new ReconciliationUseCase(paymentRepo)
  }

  // ACUMULA (no pisa): implementación única en shared/utils/accumulate-sockets.ts.
  setSockets(s: Partial<PaymentsSockets>): void { accumulateSockets(this.sockets as any, s as any) }

  /** Conecta el audit log. Lo inyecta el connector `payments-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  private audit(entry: AuditEntry): Promise<void> {
    return auditSafely(this.auditPort, this.logger, entry)
  }

  // ─── Payments ────────────────────────────────────────

  async createPayment(dto: CreatePaymentDTO): Promise<PaymentDTO> {
    const payment = await this.crud.create(dto)
    await this.sockets.onPaymentCreated?.(payment)
    if (payment.status === 'completed') await this.sockets.onPaymentCompleted?.(payment)
    return payment
  }

  async chargeCard(dto: ChargeCardDTO, actor?: Actor): Promise<{ payment: PaymentDTO; checkoutUrl: string }> {
    const result = await chargeCard({ stripe: this.stripe, crud: this.crud, createPayment: (d) => this.createPayment(d), ceiling: this.ceiling ?? undefined }, dto)
    await this.audit(chargeEntry(result.payment, actor))
    return result
  }

  async refundPayment(paymentId: string, amount?: number, user?: { id?: string; role?: string }): Promise<PaymentDTO> {
    const refunded = await refundPayment(
      { crud: this.crud, stripe: this.stripe, createPayment: (dto) => this.createPayment(dto) },
      paymentId, amount, user,
    )
    await this.audit(refundEntry(refunded, amount, user))
    // La devolución Stripe ya se ejecutó (plata real que salió) → notificar a quien escuche
    // (contabilidad la asienta DR Clientes / CR Caja). El `payment type:'refund'` queda 'pending',
    // así que `onPaymentCompleted` no lo cubre: por eso se emite su propio evento acá.
    await this.sockets.onRefundProcessed?.(refunded)
    return refunded
  }

  /** Asienta un cobro confirmado por webhook, una sola vez (idempotencia en el usecase). */
  async handleStripeWebhook(
    hotelId: string, payload: Buffer | string, signature: string,
  ): Promise<{ type: string; paymentId?: string } | null> {
    if (!this.events) throw new Error('payments: PaymentEventStore es requerido para procesar webhooks')
    return settleStripeWebhook(
      { stripe: this.stripe, crud: this.crud, events: this.events, audit: (e) => this.audit(e), ...settleHooks(this.sockets) },
      hotelId, payload, signature,
    )
  }

  async getPayment(id: string, user?: { id?: string; role?: string }): Promise<PaymentDTO> {
    return this.crud.getById(id, user?.id, user?.role)
  }

  // Puerto de lectura para `connectors/reservas-money` — la lógica vive en el usecase.
  paymentsLinkedTo(hotelId: string, ref: PaymentReservationRef): Promise<PaymentDTO[]> { return paymentsLinkedTo(this.paymentRepo, hotelId, ref) }
  // RTC-7.4 — dinero neto asentado a nombre de una reserva (`connectors/payment-requests-money`).
  settledNetOfReservation(hotelId: string, reservationId: string): Promise<number> { return settledNetOfReservation(this.paymentRepo, hotelId, reservationId) }

  /** RTC-8.1 — lo inyecta el connector `payments-ceiling`; ver `usecases/charge-card.ts`. */
  setCeilingGuard(port: ChargeCeilingPort): void { this.ceiling = port }
  async listPayments(query: PaymentsQuery): Promise<PaymentsPaginated> {
    return this.crud.list(query)
  }

  /** Asiento de un cobro Stripe, si ya existe. */
  async findByStripeSession(hotelId: string, stripeSessionId: string): Promise<PaymentDTO | null> {
    return this.crud.findByStripeSession(hotelId, stripeSessionId)
  }

  // ─── Payment Links ───────────────────────────────────

  async createPaymentLink(dto: CreatePaymentLinkDTO): Promise<PaymentLinkDTO> {
    return this.links.create(dto)
  }

  async getPaymentLinkByToken(token: string): Promise<PaymentLinkDTO> {
    return this.links.getByToken(token)
  }

  async cancelPaymentLink(id: string, user?: { id?: string; role?: string }): Promise<void> {
    return this.links.cancel(id, user?.id, user?.role)
  }

  async listPaymentLinks(hotelId: string): Promise<PaymentLinkDTO[]> {
    return this.links.list(hotelId)
  }

  // ─── Deposits ────────────────────────────────────────

  async createDeposit(dto: CreateDepositDTO): Promise<DepositDTO> {
    const deposit = await this.deposits.create(dto)
    await this.sockets.onDepositCreated?.(deposit)
    return deposit
  }

  async refundDeposit(id: string, dto: RefundDepositDTO, user?: { id?: string; role?: string }): Promise<DepositDTO> {
    const before = await this.deposits.getById(id, user?.id, user?.role)
    const deposit = await this.deposits.refund(id, dto, user?.id, user?.role)
    await this.audit(depositRefundEntry(deposit, user))
    const delta = deposit.refundAmount - before.refundAmount
    await this.sockets.onDepositRefunded?.({ ...deposit, amount: delta, refundAmount: 0 })
    return deposit
  }

  async releaseDeposit(id: string, user?: { id?: string; role?: string }): Promise<DepositDTO> {
    const deposit = await this.deposits.release(id, user?.id, user?.role)
    await this.audit(depositReleaseEntry(deposit, user))
    await this.sockets.onDepositReleased?.(deposit)
    return deposit
  }

  /** Libera los 'held' de una reserva al checkout (connector `reservas-deposits`); audita + emite por c/u. */
  async releaseHeldDepositsByReservation(reservationId: string, user?: { id?: string; role?: string }): Promise<DepositDTO[]> {
    return this.deposits.releaseHeldByReservation(reservationId, async (d) => {
      await this.audit(depositReleaseEntry(d, user))
      await this.sockets.onDepositReleased?.(d)
    })
  }

  /** F5 #627 — Marca/libera depósitos held tras cancelación (delega a usecase). */
  async cancelHeldDepositsByReservation(reservationId: string, refundAmount: number, cancellationFee: number): Promise<DepositDTO[]> {
    return cancelHeldDeposits({ deposits: this.deposits, audit: (e) => this.audit(e), sockets: this.sockets }, reservationId, refundAmount, cancellationFee)
  }

  async listDeposits(hotelId: string, status?: string): Promise<DepositDTO[]> { return this.deposits.list(hotelId, status) }

  async getDeposit(id: string, user?: { id?: string; role?: string }): Promise<DepositDTO> { return this.deposits.getById(id, user?.id, user?.role) }

  // ─── Reconciliation ──────────────────────────────────

  async reconcile(hotelId: string, bankEntries?: ReconciliationEntry[], from?: string, to?: string): Promise<ReconciliationResult> {
    return this.reconciliation.reconcile(hotelId, bankEntries, from, to)
  }
}
