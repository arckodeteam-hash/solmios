// payments/usecases/payment-crud.ts — Payment CRUD operations

import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { PaymentDTO, CreatePaymentDTO, PaymentsQuery, PaymentsPaginated } from '../types'

/**
 * Detecta la violación de UNIQUE/PK en SQLite y Postgres (el mensaje difiere por motor). Mismo
 * criterio que `PaymentEventStore.isDuplicateError` (services/payment-gateway/payment-events.ts) —
 * replicado acá (no importado) porque ese store es de webhooks de pasarela, un scope distinto.
 */
function isDuplicateError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e).toLowerCase()
  return (
    msg.includes('unique constraint') ||   // SQLite: "UNIQUE constraint failed"
    msg.includes('duplicate key') ||        // Postgres: "duplicate key value violates unique constraint"
    msg.includes('constraint failed')
  )
}

export class PaymentCrudUseCase {
  constructor(
    private readonly paymentRepo: RepositoryAdapter<PaymentDTO>,
    private readonly logger: Logger,
    private readonly auth?: Auth,
    private readonly userRepo?: RepositoryAdapter<any>,
    /**
     * Solo para verificar que el folio / la factura / el huésped que llegan en el body sean del
     * MISMO hotel que el pago. El `hotelId` ya lo fuerza el controller desde el token, pero los
     * campos de relación viajaban sin verificar: se podía crear un pago propio apuntando a un
     * folio o a un huésped de otro hotel. Es el mismo patrón del IDOR de reservas (guestId).
     * Opcionales para no romper callers viejos.
     */
    private readonly folioRepo?: RepositoryAdapter<any>,
    private readonly invoiceRepo?: RepositoryAdapter<any>,
    private readonly guestRepo?: RepositoryAdapter<any>,
    /** SEC3-5: mismo check para `reservationId` — la columna nueva (BUG-ceiling-bypass) es el
     *  vínculo directo del techo de `payment-requests`; un id cross-tenant acá infla o pincha el
     *  saldo cobrable de una reserva ajena. Hoy no llega por HTTP (el schema no la declara), es
     *  defensa en profundidad para los callers internos (charge-reschedule-diff). */
    private readonly reservationRepo?: RepositoryAdapter<any>,
  ) {}

  /**
   * Verifica que un recurso referenciado pertenezca al hotel del pago. FAIL-CLOSED: si el repo no
   * está inyectado no se puede comprobar y se rechaza, en vez de dejar pasar en silencio (así fue
   * como el IDOR de `guestId` en reservas sobrevivió al primer fix).
   */
  private async assertBelongs(
    repo: RepositoryAdapter<any> | undefined, id: string | null | undefined, hotelId: string, label: string,
  ): Promise<void> {
    if (!id) return
    if (!repo) throw new ValidationError(`No se puede verificar a qué hotel pertenece ${label}`)
    const row = await repo.findOne({ id })
    if (!row || row.hotelId !== hotelId) throw new ValidationError(`${label} no pertenece a este hotel`)
  }

  private async assertOwnership(resourceHotelId: string, userId?: string, userRole?: string): Promise<void> {
    if (!this.auth || !this.userRepo || !userId) return
    const me = await this.userRepo.findById(userId)
    this.auth.assertOwnership(resourceHotelId, (me as any)?.hotelId ?? '', userRole || '', 'super_admin')
  }

  async create(dto: CreatePaymentDTO): Promise<PaymentDTO> {
    if (dto.amount <= 0) throw new ValidationError('Payment amount must be positive')

    // El `hotelId` ya viene forzado desde el token por el controller; lo que faltaba era que los
    // ids relacionados fueran de ESE hotel. Sin esto quedaban filas cruzadas entre hoteles.
    await this.assertBelongs(this.folioRepo, dto.folioId, dto.hotelId, 'El folio')
    await this.assertBelongs(this.invoiceRepo, dto.invoiceId, dto.hotelId, 'La factura')
    await this.assertBelongs(this.guestRepo, dto.guestId, dto.hotelId, 'El huésped')
    // SEC3-5: la reserva referenciada también tiene que ser del hotel del pago.
    await this.assertBelongs(this.reservationRepo, dto.reservationId, dto.hotelId, 'La reserva')

    // El efectivo se cobra en el acto; la tarjeta espera confirmación de Stripe. Un `status`
    // explícito gana: un cobro manual ya recibido (transferencia, POS) entra `completed`.
    const status = dto.status ?? (dto.method === 'cash' ? 'completed' : 'pending')

    const payload = {
      hotelId: dto.hotelId,
      folioId: dto.folioId ?? null,
      invoiceId: dto.invoiceId ?? null,
      reservationId: dto.reservationId ?? null,
      guestId: dto.guestId ?? null,
      type: dto.type,
      method: dto.method,
      status,
      amount: dto.amount,
      currency: dto.currency ?? 'USD',
      description: dto.description ?? '',
      reference: dto.reference ?? '',
      stripePaymentId: dto.stripePaymentId ?? '',
      stripeSessionId: dto.stripeSessionId ?? '',
      metadata: dto.metadata ?? {},
      processedAt: status === 'completed' ? new Date().toISOString() : undefined,
    }

    return await this.createIdempotent(payload)
  }

  /**
   * Claim-first (idempotencia-settlement-pos): si `reference` es una idempotency key del POS
   * (`'pos:' + orderId`), un UNIQUE index parcial (hotelId,reference) WHERE reference LIKE 'pos:%'
   * es la barrera atómica. Se intenta crear; si el insert choca contra el índice (doble click,
   * reintento tras crash), se busca y devuelve el payment YA creado en vez de duplicar el cobro.
   * Sin `reference` (o sin prefijo `pos:`), el comportamiento es el de siempre: create liso.
   */
  private async createIdempotent(payload: Record<string, unknown> & { hotelId: string; reference: string }): Promise<PaymentDTO> {
    const reference = payload.reference
    if (!reference || !reference.startsWith('pos:')) {
      return (await this.paymentRepo.create(payload as any)) as PaymentDTO
    }
    try {
      return (await this.paymentRepo.create(payload as any)) as PaymentDTO
    } catch (e) {
      if (!isDuplicateError(e)) throw e
      const existing = await this.paymentRepo.findMany({ hotelId: payload.hotelId, reference } as any)
      if (existing[0]) {
        this.logger.info('Payment POS duplicado detectado — devolviendo el existente', {
          hotelId: payload.hotelId, reference,
        })
        return existing[0] as PaymentDTO
      }
      throw e // constraint disparó pero no encontramos la fila: error real, no silenciar
    }
  }

  /**
   * Busca el asiento de un cobro de Stripe. Stripe reintenta el webhook ante cualquier error, así
   * que el cobro debe poder reconocerse ya registrado sin depender del estado del PaymentRequest.
   */
  async findByStripeSession(hotelId: string, stripeSessionId: string): Promise<PaymentDTO | null> {
    if (!hotelId || !stripeSessionId) return null
    const rows = await this.paymentRepo.findMany({ hotelId, stripeSessionId })
    return rows[0] ?? null
  }

  async getById(id: string, userId?: string, userRole?: string): Promise<PaymentDTO> {
    const payment = await this.paymentRepo.findById(id)
    if (!payment) throw new ValidationError('Payment not found')
    await this.assertOwnership(payment.hotelId, userId, userRole)
    return payment
  }

  async list(query: PaymentsQuery): Promise<PaymentsPaginated> {
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const offset = (page - 1) * limit
    const filters: Record<string, any> = {}

    if (query.hotelId) filters.hotelId = query.hotelId
    if (query.folioId) filters.folioId = query.folioId
    if (query.invoiceId) filters.invoiceId = query.invoiceId
    if (query.type) filters.type = query.type
    if (query.method) filters.method = query.method
    if (query.status) filters.status = query.status

    const result = await this.paymentRepo.paginate(filters, { limit, offset })

    return {
      data: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: result.pages,
        hasNext: offset + limit < result.total,
        hasPrev: page > 1,
      },
    }
  }

  async updateStatus(id: string, status: string, stripePaymentId?: string): Promise<PaymentDTO> {
    const update: Record<string, any> = { status }
    if (stripePaymentId) update.stripePaymentId = stripePaymentId
    if (status === 'completed') update.processedAt = new Date().toISOString()

    const updated = await this.paymentRepo.update(id, update as any)
    if (!updated) throw new ValidationError('Payment not found')
    return updated
  }
}
