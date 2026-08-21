// payments/types.ts — DTOs y tipos de queries

export type PaymentType = 'charge' | 'refund' | 'deposit' | 'withdrawal'
export type PaymentMethod = 'card' | 'cash' | 'transfer' | 'link' | 'deposit' | 'other'
// 'cancelled' (fix-refund-pos-card): Checkout Session que EXPIRÓ antes de que el huésped/cajero
// completara el pago (webhook checkout.session.expired). Distinto de 'failed' (el proveedor rechazó
// la tarjeta): acá nadie intentó pagar, solo se agotó el tiempo.
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'cancelled'
export type DepositStatus = 'held' | 'partially_refunded' | 'fully_refunded' | 'released'
export type LinkStatus = 'active' | 'used' | 'expired' | 'cancelled'

// ─── Payment ───────────────────────────────────────────
export interface PaymentDTO {
  id: string
  hotelId: string
  folioId?: string
  invoiceId?: string
  /** Vínculo directo con la reserva cuando el cobro no cuelga de un folio ni de una factura. */
  reservationId?: string
  guestId?: string
  type: PaymentType
  method: PaymentMethod
  status: PaymentStatus
  amount: number
  currency: string
  description: string
  reference: string
  stripePaymentId: string
  stripeSessionId: string
  metadata: Record<string, any>
  processedAt?: string
  createdAt: string
  updatedAt: string
}

export interface CreatePaymentDTO {
  hotelId: string
  folioId?: string
  invoiceId?: string
  /**
   * Reserva a la que pertenece el cobro cuando NO hay folio ni factura de por medio (BUG-ceiling-bypass).
   * Es de uso INTERNO: no está en `CreatePaymentSchema`, así que no llega por el body de la API.
   */
  reservationId?: string
  guestId?: string
  type: PaymentType
  method: PaymentMethod
  amount: number
  currency?: string
  description?: string
  reference?: string
  metadata?: Record<string, any>
  /**
   * Estado explícito. Sin esto, `cash` se asume cobrado y todo lo demás queda `pending` (correcto
   * para tarjeta vía Stripe: se confirma por webhook). Un cobro registrado a mano — "el huésped ya
   * transfirió" — es dinero recibido y debe entrar `completed`, o nunca dispara `onPaymentCompleted`
   * y la caja/conciliación no se enteran.
   */
  status?: PaymentStatus
  /** Identidad del cobro en Stripe. Permite deduplicar los reintentos del webhook. */
  stripeSessionId?: string
  stripePaymentId?: string
}

export interface ChargeCardDTO {
  hotelId: string
  amount: number
  currency?: string
  description: string
  folioId?: string
  /** Ver `CreatePaymentDTO.reservationId` — se propaga al payment que abre el checkout. */
  reservationId?: string
  guestId?: string
  successUrl: string
  cancelUrl: string
  // fix-refund-pos-card: idempotency key propia del caller (ej. 'pos:'+orderId, ver
  // idempotencia-settlement-pos) — se persiste en el payment, NO en el client_reference_id de Stripe
  // (ese sigue siendo payment.id, así el webhook siempre encuentra el payment sin ambigüedad).
  reference?: string
  // Tag de origen (ej. { source: 'restaurant', orderId }) para que el conector que escucha
  // onPaymentCompleted/onPaymentExpired sepa a qué módulo/entidad avisarle.
  metadata?: Record<string, any>
  // Minutos hasta que la Checkout Session expira sola. Sin esto, Stripe usa su default (24h). El
  // caller pide el mínimo que necesite; StripeGateway.createCharge lo clampea al rango real de la
  // API de Stripe (30min–24h).
  expiresInMinutes?: number
}

// ─── Payment Link ──────────────────────────────────────
export interface PaymentLinkDTO {
  id: string
  hotelId: string
  guestId?: string
  folioId?: string
  amount: number
  currency: string
  description: string
  status: LinkStatus
  token: string
  expiresAt?: string
  maxUses: number
  useCount: number
  paymentId?: string
  createdAt: string
  updatedAt: string
}

export interface CreatePaymentLinkDTO {
  hotelId: string
  guestId?: string
  folioId?: string
  amount: number
  currency?: string
  description?: string
  expiresInHours?: number
  maxUses?: number
}

// ─── Deposit ───────────────────────────────────────────
export interface DepositDTO {
  id: string
  hotelId: string
  reservationId?: string
  guestId?: string
  roomId?: string
  amount: number
  currency: string
  status: DepositStatus
  paymentMethod: string
  stripePaymentId: string
  holdReason: string
  releasedAt?: string
  refundAmount: number
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CreateDepositDTO {
  hotelId: string
  reservationId?: string
  guestId?: string
  roomId?: string
  amount: number
  currency?: string
  paymentMethod?: string
  holdReason?: string
  notes?: string
}

export interface RefundDepositDTO {
  amount?: number // partial refund, or full if omitted
  reason?: string
}

// ─── Queries ───────────────────────────────────────────
export interface PaymentsQuery {
  hotelId?: string
  folioId?: string
  invoiceId?: string
  type?: PaymentType
  method?: PaymentMethod
  status?: PaymentStatus
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface PaymentsPaginated {
  data: PaymentDTO[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

// ─── Reconciliation ────────────────────────────────────
export interface ReconciliationEntry {
  date: string
  description: string
  amount: number
  type: 'credit' | 'debit'
  reference?: string
}

export interface ReconciliationResult {
  matched: { bank: ReconciliationEntry; system: PaymentDTO }[]
  unmatchedBank: ReconciliationEntry[]
  unmatchedSystem: PaymentDTO[]
  difference: number
}

// ─── Current User ──────────────────────────────────────
export interface CurrentUser {
  id: string
  hotelId?: string | null
  role?: string
}
