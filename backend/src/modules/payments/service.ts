// payments/service.ts — Facade pública del módulo Payments. Orquestador delgado que delega a usecases/
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { paymentsLinkedTo, settledNetOfReservation, unbilledPaymentsOfReservation, linkPaymentsToInvoice, type PaymentReservationRef } from './usecases/reservation-money'
import type {
  PaymentDTO, CreatePaymentDTO, ChargeCardDTO,
  DepositDTO, CreateDepositDTO, RefundDepositDTO, PaymentsQuery, PaymentsPaginated,
  ReconciliationEntry, ReconciliationResult,
} from './types'
import { settleHooks, type PaymentsSockets } from './sockets'
import { StripeUseCase } from './usecases/stripe'
import type { PaymentGatewayRegistry } from '../../services/payment-gateway/registry'
import type { PaymentEventStore } from '../../services/payment-gateway/payment-events'
import { PaymentCrudUseCase } from './usecases/payment-crud'
import { DepositsUseCase } from './usecases/deposits'
import { ReconciliationUseCase } from './usecases/reconciliation'
import * as refunds from './usecases/refund-flows'
import type { DirectRefundInput } from './usecases/refund-direct'
import { chargeCard, type ChargeCeilingPort } from './usecases/charge-card'
import { liveChargesPort, type LiveChargesPort } from './usecases/live-charges'
import { settleStripeWebhook } from './usecases/settle-webhook'
import { cancelHeldDeposits } from './usecases/cancel-deposits'
import {
  auditSafely, chargeEntry, depositRefundEntry, depositReleaseEntry,
  type AuditEntry, type AuditPort, type Actor,
} from './usecases/audit'

export class PaymentsService {
  private sockets: PaymentsSockets = {}
  private stripe: StripeUseCase
  private crud: PaymentCrudUseCase
  private deposits: DepositsUseCase
  private reconciliation: ReconciliationUseCase
  private auditPort: AuditPort | null = null
  /** RTC-8.1: techo del cobro para la vía charge-card (connector `payments-ceiling`) — fail-closed en el usecase. */
  private ceiling: ChargeCeilingPort | null = null
  /** RTC-8.2/8.3 — sesiones de checkout vivas de esta vía, para `connectors/payment-requests-money`. */
  readonly liveChargePort: LiveChargesPort

  constructor(
    private readonly paymentRepo: RepositoryAdapter<PaymentDTO>,
    depositRepo: RepositoryAdapter<DepositDTO>,
    private readonly logger: Logger,
    cache: CacheAdapter,
    private readonly auth?: any,
    userRepo?: RepositoryAdapter<any>,
    registry?: PaymentGatewayRegistry,
    private readonly events?: PaymentEventStore,
    /** Verifican folioId/invoiceId/guestId/reservationId del body contra el hotel — ver payment-crud (SEC3-5). */
    folioRepo?: RepositoryAdapter<any>, invoiceRepo?: RepositoryAdapter<any>, guestRepo?: RepositoryAdapter<any>, reservationRepo?: RepositoryAdapter<any>,
    /** #213: zona horaria del hotel para `payments.businessDate` (ver model.ts). */
    hotelRepo?: RepositoryAdapter<any>,
  ) {
    if (!registry) throw new Error('payments: PaymentGatewayRegistry es requerido (pasarela por hotel)')
    this.stripe = new StripeUseCase(registry, logger)
    this.crud = new PaymentCrudUseCase(paymentRepo, logger, auth, userRepo, folioRepo, invoiceRepo, guestRepo, reservationRepo, hotelRepo)
    this.liveChargePort = liveChargesPort(paymentRepo, this.crud)
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
    // `onPaymentCompleted` = entró un COBRO. Un `type:'refund'` nace `completed` pero es plata que SALE: su
    // evento es `onRefundProcessed` (usecases/refund-flows.ts). #214 (COR-D): antes salía hacia caja/webhooks como cobro.
    if (payment.status === 'completed' && payment.type !== 'refund') await this.sockets.onPaymentCompleted?.(payment)
    return payment
  }

  async chargeCard(dto: ChargeCardDTO, actor?: Actor): Promise<{ payment: PaymentDTO; checkoutUrl: string }> {
    const result = await chargeCard({ stripe: this.stripe, crud: this.crud, createPayment: (d) => this.createPayment(d), ceiling: this.ceiling ?? undefined }, dto)
    await this.audit(chargeEntry(result.payment, actor))
    return result
  }

  // Toda devolución (Stripe, efectivo/transferencia, monto suelto, por método) sale por usecases/refund-flows.ts:
  // asiento + audit `payment.refund` + `onRefundProcessed` (el evento que escuchan caja, contabilidad y webhooks).
  private refundDeps(): refunds.RefundFlowDeps {
    return { crud: this.crud, stripe: this.stripe, createPayment: (d) => this.createPayment(d), audit: (e) => this.audit(e), onRefundProcessed: async (p) => { await this.sockets.onRefundProcessed?.(p) } }
  }
  refundPayment(paymentId: string, amount?: number, user?: Actor): Promise<PaymentDTO> { return refunds.refundStripe(this.refundDeps(), paymentId, amount, user) }
  /** #214 (COR-5): devolución de un cobro efectivo/transferencia — asiento `refund` sin pasarela. */
  refundDirectPayment(paymentId: string, user?: Actor): Promise<PaymentDTO> { return refunds.refundDirect(this.refundDeps(), paymentId, user) }
  /** Devolución por caja de un monto SIN cobro de origen (excedente de una reserva reprogramada). */
  recordDirectRefund(input: DirectRefundInput, user?: Actor): Promise<PaymentDTO> { return refunds.recordDirect(this.refundDeps(), input, user) }
  /** Devolución total por método (tarjeta → Stripe; cash/transfer → asiento directo). Lo usa el POS. */
  refundPaymentByMethod(paymentId: string, user?: Actor): Promise<PaymentDTO> { return refunds.refundByMethod(this.refundDeps(), paymentId, user) }
  /** Un payment por su idempotency key (`pos:*`) — el POS concilia un cobro cuyo puerto falló después de asentarlo. */
  findByReference(hotelId: string, reference: string): Promise<PaymentDTO | null> { return this.crud.findByReference(hotelId, reference) }

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
  // #253 — puerto para connectors/facturas-payments: pagos de la reserva aún sin factura (los que la factura emitida desde la reserva vincula).
  unbilledPaymentsOfReservation(hotelId: string, reservationId: string): Promise<PaymentDTO[]> { return unbilledPaymentsOfReservation(this.paymentRepo, hotelId, reservationId) }
  // #253 — puerto para connectors/facturas-payments: vincula filas EXISTENTES a la factura (nunca crea); devuelve cuántas.
  linkPaymentsToInvoice(hotelId: string, reservationId: string, paymentIds: string[], invoiceId: string): Promise<number> { return linkPaymentsToInvoice(this.paymentRepo, hotelId, reservationId, paymentIds, invoiceId) }

  /** RTC-8.1 — lo inyecta el connector `payments-ceiling`; ver `usecases/charge-card.ts`. */
  setCeilingGuard(port: ChargeCeilingPort): void { this.ceiling = port }
  async listPayments(query: PaymentsQuery): Promise<PaymentsPaginated> {
    return this.crud.list(query)
  }

  /** #213 — puerto de lectura para `connectors/restaurante-reports-payments`: los pagos del hotel de un día contable. */
  paymentsOfBusinessDate(hotelId: string, businessDate: string): Promise<PaymentDTO[]> { return this.crud.ofBusinessDate(hotelId, businessDate) }
  /** #216 — puerto de lectura para el ticket impreso del POS: un pago por id, solo si es del hotel. */
  paymentOfHotel(hotelId: string, paymentId: string): Promise<PaymentDTO | null> { return this.crud.ofHotel(hotelId, paymentId) }

  /** Asiento de un cobro Stripe, si ya existe. */
  async findByStripeSession(hotelId: string, stripeSessionId: string): Promise<PaymentDTO | null> {
    return this.crud.findByStripeSession(hotelId, stripeSessionId)
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
