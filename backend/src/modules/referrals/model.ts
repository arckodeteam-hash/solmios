// referrals/model.ts — Programa de referidos B2B: un hotel recomienda SOLMI OS a otro hotel.
// Ver PLAN-REFERIDOS.md. Doble incentivo: el referido arranca su trial normal (15 días, ya
// existente), el referidor gana meses gratis de SU propia suscripción cuando el referido
// completa `activeMonthsRequired` meses pagando (config `referral_program`, ver program-settings.ts).
import type { ORM, ModelDefinition } from 'arckode-framework'

/** Código propio de cada hotel para compartir su link. Persistente, se genera lazy la
 *  primera vez que el hotel pide su link — no en el signup (ese es el código del OTRO). */
export const ReferralCodesModel: ModelDefinition = {
  table: 'referral_codes',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    code: { type: 'string', required: true, indexed: true },
  },
}

/** Un hotel nuevo que se dio de alta usando el código de otro hotel. */
export const ReferralsModel: ModelDefinition = {
  table: 'referrals',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    referrerHotelId: { type: 'string', required: true, indexed: true },
    referredHotelId: { type: 'string', required: true, indexed: true },
    /** Código usado al momento del alta — snapshot, aunque el hotel referidor cambie el suyo después. */
    code: { type: 'string', required: true },
    /**
     * trial      — el referido está en su prueba gratis (15 días, mecanismo normal de signup)
     * active     — el referido ya paga (Subscription.status='active')
     * validated  — cumplió activeMonthsRequired meses pagando → generó (o va a generar) el crédito
     * churned    — el referido se dio de baja/quedó suspendido antes de validar → no genera crédito
     */
    status: { type: 'string', required: true, default: 'trial' },
    /** Cuándo el referido empezó a pagar (status Subscription → active). Null hasta entonces. */
    activeSince: { type: 'string' },
    /** Cuándo se validó (cumplió los meses). Null hasta entonces. */
    validatedAt: { type: 'string' },
    /**
     * Estado del descuento de bienvenida al REFERIDO (1er mes gratis, `referredRewardValue` % off):
     * pending  — todavía no se aplicó (acaba de pasar a active, o el referido no tiene
     *            stripeSubscriptionId todavía, o Stripe estaba caído → reintenta próximo tick)
     * applied  — applyStripeDiscount confirmó el cupón sobre la suscripción del referido
     * skipped  — referredRewardValue es 0/null → no hay reward que dar, no reintenta
     * Persistido (no en memoria) para sobrevivir restarts y evitar duplicar el cupón en Stripe.
     */
    welcomeRewardStatus: { type: 'string', default: 'pending' },
  },
}

/** Un bono de meses gratis ganado por el hotel REFERIDOR. */
export const ReferralCreditsModel: ModelDefinition = {
  table: 'referral_credits',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    referralId: { type: 'string', required: true, indexed: true },
    referrerHotelId: { type: 'string', required: true, indexed: true },
    monthsGranted: { type: 'number', required: true },
    /** pending (creado, todavía no se intentó aplicar) | released (cupón real ya aplicado en Stripe) | revoked (clawback: el referido se dio de baja dentro de la ventana) */
    status: { type: 'string', required: true, default: 'pending' },
    /** Snapshot del plan del REFERIDOR al momento de ganar el crédito (auditoría, no afecta el cálculo real: el % siempre es 100 sobre lo que Stripe cobre). */
    basePlanId: { type: 'string' },
    baseAmount: { type: 'number' },
    earnedAt: { type: 'string', required: true },
    releasedAt: { type: 'string' },
  },
}

/** Tramos escalonados: a partir de qué referido validado nº, cuántos meses suma. Editable
 *  desde /admin/referrals — cero hardcode, ver PLAN-REFERIDOS.md §3. */
export const ReferralTiersModel: ModelDefinition = {
  table: 'referral_tiers',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    fromCount: { type: 'number', required: true },
    monthsGranted: { type: 'number', required: true },
    sortOrder: { type: 'number', required: true, default: 0 },
  },
}

export function registerReferralModels(orm: ORM): void {
  orm.define('ReferralCodes', ReferralCodesModel)
  orm.define('Referrals', ReferralsModel)
  orm.define('ReferralCredits', ReferralCreditsModel)
  orm.define('ReferralTiers', ReferralTiersModel)
}
