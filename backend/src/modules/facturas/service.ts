// facturas/service.ts — Casos de uso de facturación del hotel.
// Delega la lógica pura a ./usecases/ para mantenerse < 200 líneas.

import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { invoicesOfReservation, reservationIdOfInvoice } from './usecases/reservation-money'
import { NotFoundError } from 'arckode-framework'
import type { FacturasDTO, CreateFacturasDTO, UpdateFacturasDTO, PayFacturasDTO, FacturasQuery, FacturasListResult, CurrentUser, FacturasStats } from './types'
import type { FacturasSockets } from './sockets'
import { enrichInvoice, assertOwnership, hotelFilterFor, type EnrichDeps } from './usecases/billing'
import { getTaxRateForUser } from './usecases/tax-rate'
import { resolveInvoiceHotelId } from './usecases/resolve-hotel'
import { creditNoteFlow } from './usecases/credit-note-flow'
import { createInvoice } from './usecases/create-invoice'
import { getStatsForUser } from './usecases/stats'
import { invalidateFacturasCaches } from './usecases/cache'
import { listInvoices } from './usecases/list-invoices'
import { auditSafely, type AuditPort } from './usecases/audit'
import { assertDeletable, isElectronicInvoicingEnabled } from './usecases/deletable'
import { payInvoice } from './usecases/pay-invoice'
import { getInvoicePolicyText } from './usecases/policy-text'
import type { PaymentPort } from './usecases/payment-port'
import type { CreditNoteResult } from './usecases/credit-note'
import { generateTaxReport, type TaxReport } from './usecases/tax-report'
import { attachItems, deleteItems } from './usecases/invoice-items'
import { sendInvoiceByEmail, type InvoiceEmailPort, type EmailInvoiceResult } from './usecases/email-invoice'

export class FacturasService {
  private sockets: FacturasSockets = {}
  private readonly enrichDeps: EnrichDeps
  private emailPort: InvoiceEmailPort | null = null
  private hotelRepo: RepositoryAdapter<any> | null = null
  private auditPort: AuditPort | null = null
  private paymentPort: PaymentPort | null = null

  constructor(
    private readonly repo: RepositoryAdapter<FacturasDTO>,
    private readonly configRepo: RepositoryAdapter<any>,
    deps: EnrichDeps,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
    private readonly itemRepo: RepositoryAdapter<any>,
    // Fallback de taxRateFor a hotels.taxRate (ver comentario en usecases/billing.ts).
    private readonly hotelsForTaxRepo?: RepositoryAdapter<any>,
  ) {
    this.enrichDeps = deps
  }

  // ACUMULA (no pisa): implementación única en shared/utils/accumulate-sockets.ts.
  setSockets(s: Partial<FacturasSockets>): void { accumulateSockets(this.sockets as any, s as any) }

  setEmailDeps(emailPort: InvoiceEmailPort, hotelRepo: RepositoryAdapter<any>): void {
    this.emailPort = emailPort
    this.hotelRepo = hotelRepo
  }

  /** Conecta el audit log. Lo inyecta el connector `facturas-auditlog`. */
  setAuditDeps(auditPort: AuditPort): void {
    this.auditPort = auditPort
  }

  /** Conecta el registro de pagos. Lo inyecta el connector `facturas-payments`. */
  setPaymentDeps(paymentPort: PaymentPort): void {
    this.paymentPort = paymentPort
  }

  // Puerto de lectura para `connectors/reservas-money` — la lógica vive en el usecase.
  invoicesOfReservation(hotelId: string, reservationId: string): Promise<FacturasDTO[]> { return invoicesOfReservation(this.repo, hotelId, reservationId) }
  reservationIdOfInvoice(hotelId: string, invoiceId: string): Promise<string | null> { return reservationIdOfInvoice(this.repo, hotelId, invoiceId) }

  async list(query?: FacturasQuery, user?: CurrentUser): Promise<FacturasListResult> {
    return listInvoices(
      { repo: this.repo, itemRepo: this.itemRepo, cache: this.cache, logger: this.logger, enrichDeps: this.enrichDeps },
      query,
      user,
    )
  }

  async getById(id: string, user?: CurrentUser): Promise<FacturasDTO> {
    this.logger.info('Obteniendo factura', { id })
    const item = await this.repo.findById(id)
    if (!item) throw new NotFoundError('Factura no encontrada')
    if (user) await assertOwnership(this.userRepo, this.auth,item.hotelId, user.id, user.role)
    return attachItems(this.itemRepo,await enrichInvoice(item, this.enrichDeps))
  }

  async create(dto: CreateFacturasDTO, user: CurrentUser): Promise<FacturasDTO> {
    // Ownership en el ALTA (ver resolveInvoiceHotelId): el hotel sale del JWT, no de dto.hotelId.
    const hotelId = await resolveInvoiceHotelId(this.userRepo, user, dto.hotelId)
    const { item, invoiceNumber, amount, currency } = await createInvoice(
      { repo: this.repo, configRepo: this.configRepo, itemRepo: this.itemRepo, logger: this.logger, hotelsRepo: this.hotelsForTaxRepo },
      dto,
      hotelId,
    )
    await auditSafely(this.auditPort, this.logger, {
      hotelId, userId: user.id, action: 'invoice.create', entityId: item.id,
      detail: `${dto.type ?? 'invoice'} ${invoiceNumber} · ${amount} ${currency}`,
    })
    await this.sockets.onFacturasCreated?.(item)
    await invalidateFacturasCaches(this.cache, item.hotelId)
    return attachItems(this.itemRepo,await enrichInvoice(item, this.enrichDeps))
  }

  async update(id: string, dto: UpdateFacturasDTO, user: CurrentUser): Promise<FacturasDTO> {
    this.logger.info('Actualizando factura', { id })
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Factura no encontrada')
    await assertOwnership(this.userRepo, this.auth,existing.hotelId, user.id, user.role)
    const item = await this.repo.update(id, dto as Partial<Omit<FacturasDTO, 'id'>>)
    if (!item) throw new NotFoundError('Factura no encontrada')
    await this.sockets.onFacturasUpdated?.(item)
    await invalidateFacturasCaches(this.cache, existing.hotelId)
    return enrichInvoice(item, this.enrichDeps)
  }

  async pay(id: string, dto: PayFacturasDTO, user: CurrentUser): Promise<FacturasDTO> {
    this.logger.info('Aplicando pago a factura', { id, method: dto.method })
    const inv = await this.repo.findById(id)
    if (!inv) throw new NotFoundError('Factura no encontrada')
    await assertOwnership(this.userRepo, this.auth,inv.hotelId, user.id, user.role)

    const { updated, applied, balance, paymentId } = await payInvoice(
      this.repo, this.logger, this.paymentPort, inv, dto,
    )

    await auditSafely(this.auditPort, this.logger, {
      hotelId: inv.hotelId, userId: user.id, action: 'invoice.pay', entityId: id,
      detail: `${inv.invoiceNumber} · ${applied} ${inv.currency} vía ${dto.method ?? 'n/d'}` +
        `${dto.reference ? ` · ref ${dto.reference}` : ''} · saldo ${balance}` +
        `${paymentId ? ` · payment ${paymentId}` : ''}`,
    })

    await this.sockets.onFacturasUpdated?.(updated)
    await invalidateFacturasCaches(this.cache, inv.hotelId)
    return enrichInvoice(updated, this.enrichDeps)
  }

  async delete(id: string, user: CurrentUser): Promise<void> {
    this.logger.info('Eliminando factura', { id })
    const existing = await this.repo.findById(id)
    if (!existing) throw new NotFoundError('Factura no encontrada')
    await assertOwnership(this.userRepo, this.auth,existing.hotelId, user.id, user.role)

    // Una factura con efectos contables se anula con nota de crédito, no se borra.
    const fiscalEnabled = await isElectronicInvoicingEnabled(this.configRepo, existing.hotelId)
    assertDeletable(existing, fiscalEnabled)

    await deleteItems(this.itemRepo, id)
    const deleted = await this.repo.delete(id)
    if (!deleted) throw new NotFoundError('Factura no encontrada')
    this.logger.info('Factura eliminada', {
      id, invoiceNumber: existing.invoiceNumber, amount: existing.amount, hotelId: existing.hotelId,
    })
    await auditSafely(this.auditPort, this.logger, {
      hotelId: existing.hotelId, userId: user.id, action: 'invoice.delete', entityId: id,
      detail: `${existing.invoiceNumber} · ${existing.amount} ${existing.currency} · estado ${existing.status}`,
    })
    await this.sockets.onFacturasDeleted?.(id)
    await invalidateFacturasCaches(this.cache, existing.hotelId)
  }

  async creditNote(id: string, reason: string, user: CurrentUser): Promise<CreditNoteResult> {
    return creditNoteFlow({
      repo: this.repo, userRepo: this.userRepo, auth: this.auth, logger: this.logger,
      cache: this.cache, auditPort: this.auditPort,
      onUpdated: (inv) => this.sockets.onFacturasUpdated?.(inv),
    }, id, reason, user)
  }

  async getStats(user: CurrentUser): Promise<FacturasStats> {
    return getStatsForUser(this.repo, this.cache, user)
  }
  async taxReport(user: CurrentUser, from?: string, to?: string): Promise<TaxReport> {
    return generateTaxReport(this.repo, hotelFilterFor(user), from, to)
  }
  async getTaxRate(user: CurrentUser): Promise<{ rate: number }> {
    return getTaxRateForUser(this.configRepo, user, this.hotelsForTaxRepo)
  }
  async getInvoicePolicyText(hotelId: string) { return getInvoicePolicyText(this.configRepo, hotelId) }

  async emailInvoice(id: string, to: string, user: CurrentUser): Promise<EmailInvoiceResult> {
    if (!this.emailPort) throw new NotFoundError('Servicio de email no configurado')
    const invoice = await this.getById(id, user)
    if (!(await this.emailPort.isConfigured(invoice.hotelId))) {
      this.logger.warn('Envío de factura omitido: el hotel no tiene email configurado', {
        id, hotelId: invoice.hotelId,
      })
      return { sent: false, to, subject: '', messageId: '', configured: false }
    }
    const result = await sendInvoiceByEmail({ invoice, to, hotelRepo: this.hotelRepo ?? undefined, emailPort: this.emailPort })
    await auditSafely(this.auditPort, this.logger, {
      hotelId: invoice.hotelId, userId: user.id, action: 'invoice.email', entityId: id,
      detail: `${invoice.invoiceNumber} → ${to}`,
    })
    return result
  }
}