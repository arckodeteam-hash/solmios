// payments/controller.ts — Adaptador HTTP del módulo

import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from 'arckode-framework'
import type { PaymentsService } from './service'
import type {
  CreatePaymentDTO, ChargeCardDTO, CreatePaymentLinkDTO,
  CreateDepositDTO, RefundDepositDTO, PaymentsQuery, ReconciliationEntry,
} from './types'
import {
  CreatePaymentSchema, ChargeCardSchema, CreatePaymentLinkSchema,
  CreateDepositSchema, RefundDepositSchema, ReconcileSchema, RefundSchema,
} from './validators/schema'

export class PaymentsController {
  constructor(
    private readonly service: PaymentsService,
    private readonly logger: Logger,
  ) {}

  /** Fuerza hotelId del JWT en los creates (P0 IDOR V1-V4). super_admin puede especificar otro. */
  private forceHotelId(dto: { hotelId?: string }, user: any): string {
    return user?.userType === 'admin' ? (dto.hotelId || user.hotelId || '') : (user?.hotelId || '')
  }

  private userHotelId(user: any): string | undefined {
    return user?.hotelId || undefined
  }

  private userInfo(user: any): { id?: string; role?: string; hotelId?: string } {
    return { id: user?.id, role: user?.role || user?.userType, hotelId: user?.hotelId }
  }

  // ─── Payments ────────────────────────────────────────

  async createPayment(req: HttpRequest) {
    this.logger.info('POST /api/payments')
    const data = validateSchema(CreatePaymentSchema, req.body) as unknown as CreatePaymentDTO
    data.hotelId = this.forceHotelId(data, req.user as any) // V1 IDOR: forzar del JWT
    // Quién lo registró: sale del JWT, NO del body (un cliente no elige a nombre de quién queda
    // asentado un cobro). Vacío si el token no trae id — la fila se guarda igual.
    data.createdBy = String((req.user as { id?: string } | undefined)?.id ?? '')
    const payment = await this.service.createPayment(data)
    return { status: 201, body: payment }
  }

  async chargeCard(req: HttpRequest) {
    this.logger.info('POST /api/payments/charge')
    const data = validateSchema(ChargeCardSchema, req.body) as unknown as ChargeCardDTO
    data.hotelId = this.forceHotelId(data, req.user as any) // V2 IDOR: forzar del JWT
    const result = await this.service.chargeCard(data, this.userInfo(req.user))
    return { status: 200, body: result }
  }

  async refund(req: HttpRequest) {
    this.logger.info('POST /api/payments/:id/refund')
    const { id } = req.params
    const data = validateSchema(RefundSchema, req.body) as { amount?: number }
    const payment = await this.service.refundPayment(id, data.amount, this.userInfo(req.user))
    return { status: 200, body: payment }
  }

  async getPayment(req: HttpRequest) {
    this.logger.info('GET /api/payments/:id')
    const payment = await this.service.getPayment(req.params.id, this.userInfo(req.user))
    return { status: 200, body: payment }
  }

  async listPayments(req: HttpRequest) {
    this.logger.info('GET /api/payments')
    const query = req.query as unknown as PaymentsQuery
    const userHotelId = this.userHotelId(req.user)
    if (userHotelId) query.hotelId = userHotelId
    const result = await this.service.listPayments(query)
    return { status: 200, body: result }
  }

  /**
   * Webhook de Stripe. El hotel va en la RUTA porque su secreto de firma es lo que autentica
   * el mensaje: hay que saber de quién es ANTES de creerle al contenido.
   *
   * La firma se verifica contra los bytes CRUDOS (`req.rawBody`, framework >= 1.6.3):
   * `JSON.stringify(req.body)` no los reproduce y la firma nunca validaría.
   */
  async handleWebhook(req: HttpRequest) {
    const hotelId = String(req.params?.hotelId || '')
    if (!hotelId) return { status: 400, body: { error: 'Falta el hotel en la ruta del webhook' } }

    const signature = (req as any).headers?.['stripe-signature'] || ''
    const rawBody = (req as any).rawBody
    if (!rawBody) return { status: 400, body: { error: 'Webhook sin body' } }

    try {
      const result = await this.service.handleStripeWebhook(hotelId, rawBody, signature)
      if (!result) return { status: 400, body: { error: 'Firma inválida' } }
      return { status: 200, body: result }
    } catch (e: any) {
      this.logger.error(`Webhook Stripe (hotel ${hotelId}): ${e?.message}`)
      return { status: 400, body: { error: e?.message || 'Webhook rechazado' } }
    }
  }

  // ─── Payment Links ───────────────────────────────────

  async createLink(req: HttpRequest) {
    this.logger.info('POST /api/payment-links')
    const data = validateSchema(CreatePaymentLinkSchema, req.body) as unknown as CreatePaymentLinkDTO
    data.hotelId = this.forceHotelId(data, req.user as any) // V3 IDOR: forzar del JWT
    const link = await this.service.createPaymentLink(data)
    return { status: 201, body: link }
  }

  async getLinkByToken(req: HttpRequest) {
    this.logger.info('GET /api/payment-links/:token')
    const link = await this.service.getPaymentLinkByToken(req.params.token)
    return { status: 200, body: link }
  }

  async cancelLink(req: HttpRequest) {
    this.logger.info('DELETE /api/payment-links/:id')
    await this.service.cancelPaymentLink(req.params.id, this.userInfo(req.user))
    return { status: 204, body: null }
  }

  async listLinks(req: HttpRequest) {
    this.logger.info('GET /api/payment-links')
    const userHotelId = this.userHotelId(req.user)
    const hotelId = userHotelId || req.query.hotelId
    const links = await this.service.listPaymentLinks(hotelId)
    return { status: 200, body: links }
  }

  // ─── Deposits ────────────────────────────────────────

  async createDeposit(req: HttpRequest) {
    this.logger.info('POST /api/deposits')
    const data = validateSchema(CreateDepositSchema, req.body) as unknown as CreateDepositDTO
    data.hotelId = this.forceHotelId(data, req.user as any) // V4 IDOR: forzar del JWT
    const deposit = await this.service.createDeposit(data)
    return { status: 201, body: deposit }
  }

  async refundDeposit(req: HttpRequest) {
    this.logger.info('POST /api/deposits/:id/refund')
    const { id } = req.params
    const data = validateSchema(RefundDepositSchema, req.body) as unknown as RefundDepositDTO
    const deposit = await this.service.refundDeposit(id, data, this.userInfo(req.user))
    return { status: 200, body: deposit }
  }

  async releaseDeposit(req: HttpRequest) {
    this.logger.info('POST /api/deposits/:id/release')
    const deposit = await this.service.releaseDeposit(req.params.id, this.userInfo(req.user))
    return { status: 200, body: deposit }
  }

  async listDeposits(req: HttpRequest) {
    this.logger.info('GET /api/deposits')
    const userHotelId = this.userHotelId(req.user)
    const hotelId = userHotelId || req.query.hotelId
    const { status } = req.query as { status?: string }
    const deposits = await this.service.listDeposits(hotelId, status)
    return { status: 200, body: deposits }
  }

  async getDeposit(req: HttpRequest) {
    this.logger.info('GET /api/deposits/:id')
    const deposit = await this.service.getDeposit(req.params.id, this.userInfo(req.user))
    return { status: 200, body: deposit }
  }

  // ─── Reconciliation ──────────────────────────────────

  async reconcile(req: HttpRequest) {
    this.logger.info('POST /api/billing/reconciliation')
    const userHotelId = this.userHotelId(req.user)
    const hotelId = userHotelId || (req as any).hotelId
    const { from, to } = validateSchema(ReconcileSchema, req.body ?? {}) as { from?: string; to?: string }
    const { entries } = (req.body ?? {}) as { entries?: unknown }
    const result = await this.service.reconcile(
      hotelId,
      Array.isArray(entries) ? (entries as ReconciliationEntry[]) : [],
      from,
      to,
    )
    return { status: 200, body: result }
  }
}
