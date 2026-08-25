import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { SignupUseCase, type SignupInput, type SignupResult } from './usecases/signup'
import { SubscriptionAccess, type AccessResult } from './usecases/access'
import { OnboardingUseCase, type OnboardingStatus } from './usecases/onboarding'
import { hashPassword } from '../usuarios/usecases/password'
import { createCheckoutSession, type CreateCheckoutResult } from './usecases/create-checkout-session'
import { createPortalSession, type CreatePortalResult } from './usecases/create-portal-session'
import { processSubscriptionWebhook } from './usecases/handle-stripe-event'
import { applyStripeDiscount, type ApplyStripeDiscountResult, type ApplyStripeDiscountMeta } from './usecases/apply-stripe-discount'
import { listPublicPlans, type PublicPlan } from './usecases/public-plans'
import { publicFounderDiscount } from './usecases/public-founder-discount'
import type { SubscriptionSockets } from './sockets'

export class SubscriptionsService {
  private readonly signupUc: SignupUseCase
  private readonly onboardingUc: OnboardingUseCase
  private readonly accessUc: SubscriptionAccess
  /** `platform-emails.sendEvent()` — welcome (signup) + payment_succeeded/failed/subscription_canceled
   *  (webhook de Stripe). Opcional: sin cablear, el correo simplemente no sale (best-effort). */
  private sendPlatformEmail?: (event: string, to: string, hotelId: string, vars: Record<string, string>) => Promise<{ sent: boolean }>
  private sockets: SubscriptionSockets = {}

  constructor(
    private readonly subscriptionsRepo: RepositoryAdapter<any>,
    private readonly hotelsRepo: RepositoryAdapter<any>,
    usersRepo: RepositoryAdapter<any>,
    rolesRepo: RepositoryAdapter<any>,
    private readonly plansRepo: RepositoryAdapter<any>,
    roomsRepo: RepositoryAdapter<any>,
    ratesRepo: RepositoryAdapter<any> | undefined,
    private readonly logger: Logger,
    channelsRepo?: RepositoryAdapter<any>,
    /** `subscription_discounts` — historial de condiciones especiales (admin). Opcional: sin cablear, `statusOf` no muestra descuento activo pero no rompe. */
    private readonly discountsRepo?: RepositoryAdapter<any>,
    /** ORM crudo — solo para el CAS de `SpecialCategoryConfig.occupiedCount` al liberar un cupo
     *  de Fundador/Pionero en `customer.subscription.deleted` (handle-stripe-event.ts). Mismo
     *  motivo que admin/usecases/special-conditions.ts: RepositoryAdapter no expone updateMany. */
    private readonly orm?: any,
    /** `special_category_config` — la verdad del % del programa Fundador (CFG-1). Opcional: sin
     *  cablear, el endpoint público devuelve `null` y la landing muestra su copy de reserva. */
    private readonly specialCategoriesRepo?: RepositoryAdapter<any>,
  ) {
    this.signupUc = new SignupUseCase({
      hotelsRepo, usersRepo, rolesRepo, subscriptionsRepo, plansRepo, hashPassword, logger,
    })
    this.accessUc = new SubscriptionAccess(subscriptionsRepo, hotelsRepo)
    this.onboardingUc = new OnboardingUseCase({ roomsRepo, usersRepo, ratesRepo, hotelsRepo, channelsRepo })
  }

  /** Cablea el correo de verificación del alta (#421). Lo llama el bootstrap de email. */
  setEmailDeps(sender: any, appUrl?: string): void {
    this.signupUc.setEmailDeps(sender, appUrl || '')
  }

  /** Cablea `platform-emails.sendEvent()` — welcome (signup) + payment_succeeded/failed/
   *  subscription_canceled (webhook de Stripe). Lo llama el bootstrap de email. */
  setPlatformEmailSender(fn: NonNullable<typeof this.sendPlatformEmail>): void {
    this.sendPlatformEmail = fn
    this.signupUc.setPlatformEmailSender(fn)
  }

  // ACUMULA handlers — nunca pisa el anterior (mismo patrón que reservas/service.ts).
  // Si dos conectores registran el mismo evento, ambos corren en cadena.
  setSockets(s: Partial<SubscriptionSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  async signup(input: SignupInput): Promise<SignupResult> {
    const result = await this.signupUc.signup(input)
    // Best-effort: el alta ya terminó (201 con la cuenta creada) — un connector caído
    // (ej. referrals sin cargar) no puede deshacer nada de lo anterior.
    try {
      await this.sockets.onTrialStarted?.({
        hotelId: result.hotelId, trialEndsAt: result.trialEndsAt, referralCode: input.referralCode,
      })
    } catch (e: any) {
      this.logger.warn('onTrialStarted socket falló', { hotelId: result.hotelId, error: e.message })
    }
    return result
  }

  /** ¿Este hotel puede trabajar hoy? Lo usan el login y el guard de las rutas. */
  checkAccess(hotelId: string): Promise<AccessResult> {
    return this.accessUc.check(hotelId)
  }

  /**
   * Planes para la landing y el registro. Solo lo público: precio, descripción, features y los
   * `limits` recortados a `rooms`/`users` (`usecases/public-plans.ts` → `publicLimits`), que es lo
   * que la landing necesita para no escribir "Hasta 30 habitaciones" a mano. `modules` y el resto
   * de `limits` NO salen: son detalle interno de cómo se aplica el plan.
   *
   * El orden lo fija el backend y el frontend lo respeta tal cual (no re-ordena):
   * del más barato al más caro (#30), ver `shared/utils/plans-order.ts`.
   */
  publicPlans(): Promise<PublicPlan[]> {
    return listPublicPlans(this.plansRepo)
  }

  /** % del programa Hotel Fundador para la landing (CFG-1). `null` = sin config usable. */
  publicFounderDiscount(): Promise<number | null> {
    return publicFounderDiscount(this.specialCategoriesRepo)
  }

  /** Qué le falta configurar al hotel para poder trabajar. */
  onboarding(hotelId: string): Promise<OnboardingStatus> {
    return this.onboardingUc.status(hotelId)
  }

  /** Estado para mostrarle al hotel cuánto le queda o qué tiene que pagar. */
  async statusOf(hotelId: string): Promise<any> {
    const access = await this.accessUc.check(hotelId)
    const sub = (await this.subscriptionsRepo.findMany({ hotelId }))[0]
    // El mayor % vigente entre los descuentos activos (una fila 'active' sin vencer) — puede
    // venir de una categoría (category_bonus) o de un descuento manual (percentage/free_month).
    let activeDiscountPct: number | null = null
    if (sub && this.discountsRepo) {
      const now = new Date()
      const discounts = await this.discountsRepo.findMany({ hotelId, status: 'active' })
      const vigentes = (discounts as any[]).filter((d) => !d.endsAt || new Date(d.endsAt) > now)
      if (vigentes.length > 0) activeDiscountPct = Math.max(...vigentes.map((d) => Number(d.discountPct) || 0))
    }
    return {
      status: sub?.status ?? 'none',
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      planId: sub?.planId ?? '',
      allowed: access.allowed,
      reason: access.reason ?? null,
      daysLeft: access.daysLeft ?? null,
      // Sin esto el frontend no puede decidir si mostrar "Gestionar método de pago"
      // (requiere un Customer de Stripe ya creado, es decir: pagó al menos una vez).
      hasStripeCustomer: !!sub?.stripeCustomerId,
      specialCategory: sub?.specialCategory ?? null,
      activeDiscountPct,
    }
  }

  /** Cupón real de Stripe sobre la suscripción activa del hotel (F6 de PLAN-SUSCRIPCIONES.md,
   *  también usado por los créditos de `referrals`). Invocado desde otros módulos vía
   *  `system.resolveModule('subscriptions')` — nunca import directo entre módulos. Best-effort:
   *  si Stripe falla, el registro de negocio del llamador ya quedó creado, no se revierte. */
  applyStripeDiscount(
    hotelId: string, discountPct: number, durationMonths: number | null, meta?: ApplyStripeDiscountMeta,
  ): Promise<ApplyStripeDiscountResult> {
    return applyStripeDiscount(
      { subscriptionsRepo: this.subscriptionsRepo, discountsRepo: this.discountsRepo, logger: this.logger },
      hotelId, discountPct, durationMonths, meta,
    )
  }

  /** Suscribirse a un plan: Checkout Session de Stripe (cuenta de PLATAFORMA). */
  createCheckout(hotelId: string, planId: string, origin: string): Promise<CreateCheckoutResult> {
    return createCheckoutSession(
      { subscriptionsRepo: this.subscriptionsRepo, hotelsRepo: this.hotelsRepo, plansRepo: this.plansRepo, logger: this.logger },
      hotelId, planId, origin,
    )
  }

  /** Gestionar método de pago / ver facturas: Billing Portal de Stripe. */
  createPortal(hotelId: string, origin: string): Promise<CreatePortalResult> {
    return createPortalSession({ subscriptionsRepo: this.subscriptionsRepo, logger: this.logger }, hotelId, origin)
  }

  /** Webhook de la cuenta de PLATAFORMA (checkout/renovación/cancelación de la suscripción SaaS). */
  handlePlatformWebhook(rawBody: string | Buffer, signature: string) {
    return processSubscriptionWebhook(
      {
        subscriptionsRepo: this.subscriptionsRepo, hotelsRepo: this.hotelsRepo,
        plansRepo: this.plansRepo, logger: this.logger,
        sendPlatformEmail: this.sendPlatformEmail, orm: this.orm,
      },
      rawBody, signature,
    )
  }
}
