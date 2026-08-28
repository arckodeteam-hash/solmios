// subscriptions/model.ts — La suscripción del HOTEL a la plataforma.
//
// Ojo con la confusión: los otros módulos de pagos cobran al HUÉSPED por su
// estadía. Esto es lo otro: lo que el hotel le paga a la plataforma para poder
// usar el sistema.
//
// Antes esto no existía: el hotel solo tenía un `plan` de texto y un `status`
// que no se consultaba en ningún lado, así que la pantalla de "Suscripciones"
// del super-admin mostraba hoteles con un precio calculado de memoria. Sin
// fechas no hay vencimiento posible, y sin vencimiento no hay negocio.
import type { ORM, ModelDefinition } from 'arckode-framework'

export const SubscriptionsModel: ModelDefinition = {
  table: 'subscriptions',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    /** `plans.id`. Durante el trial ya se sabe qué plan está probando. */
    planId: { type: 'string' },
    /**
     * trialing  — está en los días de prueba
     * active    — pagando
     * past_due  — el cobro falló, todavía no se cortó
     * expired   — se venció el trial y nunca pagó
     * canceled  — dado de baja
     */
    status: { type: 'string', required: true, default: 'trialing' },
    /** Fin de la prueba gratis (ISO). Pasada esta fecha se bloquea el acceso. */
    trialEndsAt: { type: 'string' },
    /** Fin del período pago en curso (ISO). */
    currentPeriodEnd: { type: 'string' },
    canceledAt: { type: 'string' },
    /** Identificadores de la cuenta Stripe de la PLATAFORMA (no la del hotel). */
    stripeCustomerId: { type: 'string' },
    stripeSubscriptionId: { type: 'string' },
    /**
     * Cuándo quedó guardada la tarjeta del alta (ISO). Null = todavía no hay método de pago (#28).
     *
     * Es el dato que mira `access.ts` cuando la plataforma exige tarjeta para arrancar la prueba
     * (`subscription_settings.requireCardOnTrial`): sin esta marca el trial NO corre y el hotel
     * solo ve la pantalla de completar el pago. Se sella en el webhook, cuando Stripe confirma
     * el `checkout.session.completed` — nunca en el alta, que todavía no vio ninguna tarjeta.
     */
    paymentMethodAddedAt: { type: 'string' },
    /**
     * Cuándo el alta mandó a este hotel al Checkout a cargar la tarjeta (ISO). Null = nunca se lo
     * mandó, así que NO se le puede exigir (#28).
     *
     * Existe para que la exigencia sea consecuencia de un hecho y no de una config: si el plan no
     * tiene `stripePriceId`, la Checkout Session no se crea y esta marca no se sella — el hotel
     * entra con la prueba normal en vez de quedar encerrado por una tarjeta que el sistema nunca
     * pudo pedirle. En producción los 6 planes tenían `stripePriceId` vacío: con el corte atado
     * sólo al switch, prender la política dejaba el alta pública inutilizable.
     */
    awaitingPaymentMethodSince: { type: 'string' },
    /** Dedup del cron de aviso de trial (trial-reminder-cron): sin esto se reenviaría cada tick. */
    trialReminderSentAt: { type: 'string' },
    trialExpiredEmailSentAt: { type: 'string' },
    /** Categoría especial (Fundador/Pionero) asignada por el Super Admin. Ver `special_category_config`. */
    specialCategory: { type: 'string' },
    specialCategoryGrantedAt: { type: 'string' },
    /** ¿Tiene tarjeta autorizada para auto-cobro? Distingue pago recurrente de pago manual. */
    isRecurring: { type: 'boolean', default: false },
    /** Fin del período de gracia post-vencimiento (ISO). Null salvo en `past_due`. */
    graceEndsAt: { type: 'string' },
    suspendedAt: { type: 'string' },
    /** 'grace_period_expired' (automático, dispara founder_history si aplica) | 'manual' (no la dispara). */
    suspendedReason: { type: 'string' },
    /** Dedup del recordatorio a N días del vencimiento (subscription-suspension-cron). Distinto de trialReminderSentAt: ese es del trial, este es de cada ciclo pago. */
    renewalReminderSentAt: { type: 'string' },
  },
}

/** Historial de condiciones especiales (descuento/mes gratis/categoría) aplicadas por un Super Admin. Auditable, nunca se pisa. */
export const SubscriptionDiscountsModel: ModelDefinition = {
  table: 'subscription_discounts',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    subscriptionId: { type: 'string', required: true, indexed: true },
    /** percentage | free_month | category_bonus */
    type: { type: 'string', required: true },
    discountPct: { type: 'number', required: true },
    startAt: { type: 'string' },
    /** null = permanente (dura mientras la categoría/beneficio esté activo). */
    endsAt: { type: 'string' },
    appliedByUserId: { type: 'string' },
    reason: { type: 'string' },
    /** active | expired | revoked */
    status: { type: 'string', required: true, default: 'active' },
  },
}

/** Config de cupos/reglas de Fundador Uno, Fundador Dos y Pionero — 3 filas, editable desde /admin. Cero hardcode: cupos, %, plan mínimo y secuencia de apertura viven acá, no en código. */
export const SpecialCategoryConfigModel: ModelDefinition = {
  table: 'special_category_config',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    /** founder_one | founder_two | pioneer */
    key: { type: 'string', required: true, indexed: true },
    totalSlots: { type: 'number', required: true },
    /** Solo se toca vía CAS (orm.updateMany WHERE occupiedCount=expected) — nunca leer-modificar-escribir. */
    occupiedCount: { type: 'number', required: true, default: 0 },
    discountPct: { type: 'number', required: true },
    /** plans.sortOrder mínimo requerido. Null = cualquier plan (caso Pionero). */
    minPlanSortOrder: { type: 'number' },
    /** Categorías del mismo grupo no pueden estar 'open' a la vez (ej. Fundador Uno/Dos). Null = sin exclusión. */
    sequenceGroup: { type: 'string' },
    /** key de la categoría que debe estar 'full'/'closed' antes de poder abrir esta. */
    opensAfter: { type: 'string' },
    /** closed | open | full */
    status: { type: 'string', required: true, default: 'closed' },
  },
}

/** Anti-recuperación: un hotel que perdió una categoría Fundador (canceló o quedó moroso) no puede volver a calificar aunque haya cupo. Solo INSERT, nunca UPDATE/DELETE desde la app. */
export const FounderHistoryModel: ModelDefinition = {
  table: 'founder_history',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    category: { type: 'string', required: true },
    lostAt: { type: 'string', required: true },
    /** canceled | delinquent */
    reason: { type: 'string', required: true },
  },
}

export function registerSubscriptionModels(orm: ORM): void {
  orm.define('Subscriptions', SubscriptionsModel)
  orm.define('SubscriptionDiscounts', SubscriptionDiscountsModel)
  orm.define('SpecialCategoryConfig', SpecialCategoryConfigModel)
  orm.define('FounderHistory', FounderHistoryModel)
}
