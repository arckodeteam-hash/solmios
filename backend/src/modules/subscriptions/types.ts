// types.ts — Contratos de la API de suscripciones (distinto de model.ts, que es la BD).

/** Estado del vínculo del hotel con la plataforma. `suspended` = gracia agotada sin pagar, bloquea el panel. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled' | 'suspended'

/** Categoría especial con cupo limitado (Fundador Uno/Dos, Pionero). Ver `special_category_config`. */
export type SpecialCategoryKey = 'founder_one' | 'founder_two' | 'pioneer'

export interface SubscriptionDTO {
  id: string
  hotelId: string
  planId?: string
  status: SubscriptionStatus
  trialEndsAt?: string
  currentPeriodEnd?: string
  canceledAt?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  specialCategory?: SpecialCategoryKey | null
  specialCategoryGrantedAt?: string
  isRecurring?: boolean
  graceEndsAt?: string
  suspendedAt?: string
  suspendedReason?: 'grace_period_expired' | 'manual'
  renewalReminderSentAt?: string
  createdAt?: string
  updatedAt?: string
}

/** Por qué un hotel no puede operar (`MySubscriptionDTO.reason`). */
export type SubscriptionDenyReason =
  | 'trial_expired' | 'subscription_expired' | 'hotel_suspended' | 'hotel_inactive' | 'subscription_suspended'

/** Lo que ve el hotel sobre su propia suscripción. */
export interface MySubscriptionDTO {
  status: SubscriptionStatus | 'none'
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  planId: string
  allowed: boolean
  /** Por qué no puede operar, si es el caso. */
  reason: SubscriptionDenyReason | string | null
  /** Días que faltan para que se venza la prueba. */
  daysLeft: number | null
  /** Ya tiene un Customer de Stripe (pagó al menos una vez) → puede abrir el Billing Portal. */
  hasStripeCustomer: boolean
  /** Categoría especial activa, si tiene. */
  specialCategory: SpecialCategoryKey | null
  /** Descuento activo (el mayor `discountPct` entre las filas `subscription_discounts` vigentes), si tiene. */
  activeDiscountPct: number | null
}

/** Respuesta de /subscriptions/checkout y /subscriptions/portal: a dónde redirigir al hotel. */
export interface StripeRedirectDTO {
  url: string
}

/** Plan tal como lo ve alguien que todavía no es cliente. */
export interface PublicPlanDTO {
  id: string
  name: string
  slug: string
  price: number
  currency: string
  description: string
  features: string[]
}

/**
 * `GET /api/subscriptions/upgrade/preview` — cuánto le sale HOY al hotel mejorar su plan (#46).
 * Cotiza el prorrateo de Stripe sin cobrar ni cambiar nada.
 */
export interface UpgradePreviewDTO {
  /** Plan destino. */
  planId: string
  planName: string
  /**
   * Lo que se cobra AHORA por el prorrateo, en la MENOR unidad de la moneda (centavos), tal cual
   * lo devuelve Stripe (`invoice.amount_due`) — NO en la unidad de `plans.price`, que es mayor.
   * El frontend divide por 100 para mostrarlo.
   */
  amountDue: number
  /** ISO 4217 en minúsculas ('usd'), como la maneja Stripe. */
  currency: string
  currentPlanId: string
  currentPlanName: string
  /** Fin del ciclo de facturación vigente (ISO) — hasta cuándo cubre lo ya pagado. `null` si Stripe no lo informa. */
  periodEnd: string | null
}

/** `POST /api/subscriptions/upgrade` — resultado de mejorar el plan cobrando la diferencia (#46). */
export interface UpgradeResultDTO {
  /** El plan nuevo ya rige en Stripe (el ítem cambió de precio). NO implica que se haya cobrado: ver `paid`. */
  applied: boolean
  /** `true` SOLO si la factura del prorrateo quedó `paid`. En `false` el cobro falló o quedó pendiente. */
  paid: boolean
  planId: string
  planName: string
  /** Plan que tenía la suscripción antes (`null` si no tenía ninguno). */
  previousPlanId: string | null
  /**
   * Monto de la factura del prorrateo, en la MENOR unidad de la moneda (centavos), misma unidad
   * que `UpgradePreviewDTO.amountDue`. Con `paid: false` es lo que quedó PENDIENTE de cobro.
   */
  amountCharged: number
  currency: string
  /** Estado real de la factura del prorrateo ('paid' | 'open' | ...). `null` si Stripe no emitió ninguna. */
  invoiceStatus: string | null
}
