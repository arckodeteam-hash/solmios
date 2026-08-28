import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { SignupUseCase, TRIAL_DAYS, type SignupInput, type SignupResult } from './usecases/signup'
import { SubscriptionAccess, type AccessResult } from './usecases/access'
import { statusOf, type SubscriptionStatus } from './usecases/status-of'
import { composeSockets } from '../../shared/utils/compose-sockets'
import { completeSignup } from './usecases/complete-signup'
import {
  readSignupPolicy, pendingTrialDays, checkoutUrlForSignup, resumeAbandonedCheckout,
  type SignupPolicy,
} from './usecases/signup-policy'
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
  private readSignupPolicy?: () => Promise<{ requireCardOnTrial: boolean }>
  private verifyOwner?: (email: string, password: string) => Promise<{ hotelId?: string } | null>

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
    // El lector se resuelve en cada llamada, no en el constructor: el connector inyecta el
    // puerto DESPUÉS de que el módulo se registró (mismo momento que setEmailDeps).
    this.accessUc = new SubscriptionAccess(
      subscriptionsRepo,
      hotelsRepo,
      async () => (this.readSignupPolicy ? this.readSignupPolicy() : { requireCardOnTrial: false }),
    )
    this.onboardingUc = new OnboardingUseCase({ roomsRepo, usersRepo, ratesRepo, hotelsRepo, channelsRepo })
  }

  /** Puerto #28: la política de alta vive en `admin` y la inyecta `subscriptions-admin-policy`. */
  setSignupPolicyDeps(read: () => Promise<{ requireCardOnTrial: boolean }>): void {
    this.readSignupPolicy = read
  }

  /** Política de alta vigente. La usa el alta para decidir si manda al Checkout antes del trial. */
  signupPolicy(): Promise<SignupPolicy> {
    return readSignupPolicy(this.readSignupPolicy)
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

  /** ACUMULA handlers — nunca pisa el anterior. Ver `shared/utils/compose-sockets.ts`. */
  setSockets(s: Partial<SubscriptionSockets>): void {
    composeSockets(this.sockets, s)
  }

  async signup(input: SignupInput, origin?: string): Promise<SignupResult> {
    const created = await this.signupUc.signup(input)
    return completeSignup(
      { ...this.cardFlowDeps(), notifyTrialStarted: this.sockets.onTrialStarted },
      await this.signupPolicy(), created, input, origin,
    )
  }

  /** #28 — de acá derivan su copy la landing y el registro, en vez de prometer "sin tarjeta" en duro. */
  async publicSignupPolicy(): Promise<{ requireCardOnTrial: boolean; trialDays: number }> {
    const { requireCardOnTrial } = await this.signupPolicy()
    return { requireCardOnTrial, trialDays: TRIAL_DAYS }
  }

  /** #28 — retomar el pago del alta sin poder loguearse. Ver `usecases/signup-policy.ts`. */
  async resumeCheckout(email: string, password: string, origin: string): Promise<CreateCheckoutResult> {
    return resumeAbandonedCheckout(this.cardFlowDeps(), await this.signupPolicy(), email, password, origin)
  }

  /** Puerto #28: identidad sin sesión. Lo inyecta `subscriptions-usuarios-owner`. */
  setOwnerVerifier(fn: (email: string, password: string) => Promise<{ hotelId?: string } | null>): void {
    this.verifyOwner = fn
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

  /** Estado para mostrarle al hotel cuánto le queda o qué tiene que pagar. Ver `usecases/status-of.ts`. */
  async statusOf(hotelId: string): Promise<SubscriptionStatus> {
    const access = await this.accessUc.check(hotelId)
    return statusOf(this.subscriptionsRepo, this.discountsRepo, access, hotelId)
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
      hotelId, discountPct, durationMonths, meta)
  }

  /**
   * Suscribirse a un plan: Checkout Session de Stripe (cuenta de PLATAFORMA). Si el hotel viene de
   * un alta que exige tarjeta y no la dio, el Checkout arranca la PRUEBA en Stripe en vez de
   * cobrar de una (#28) — quién decide eso y con cuántos días: `usecases/signup-policy.ts`.
   */
  async createCheckout(hotelId: string, planId: string, origin: string): Promise<CreateCheckoutResult> {
    const trialDays = await pendingTrialDays(this.subscriptionsRepo, await this.signupPolicy(), hotelId)
    return createCheckoutSession(
      { subscriptionsRepo: this.subscriptionsRepo, hotelsRepo: this.hotelsRepo, plansRepo: this.plansRepo, logger: this.logger },
      hotelId, planId, origin, trialDays,
    )
  }

  /** Lo que el flujo de alta con tarjeta necesita del módulo (`usecases/signup-policy.ts`). */
  private cardFlowDeps() {
    return {
      subscriptionsRepo: this.subscriptionsRepo,
      createCheckout: (h: string, p: string, o: string) => this.createCheckout(h, p, o),
      verifyOwner: this.verifyOwner,
      logger: this.logger,
    }
  }

  /** Gestionar método de pago / ver facturas: Billing Portal de Stripe. */
  createPortal(hotelId: string, origin: string): Promise<CreatePortalResult> {
    return createPortalSession({ subscriptionsRepo: this.subscriptionsRepo, logger: this.logger }, hotelId, origin)
  }

  /** Webhook de la cuenta de PLATAFORMA (checkout/renovación/cancelación de la suscripción SaaS). */
  handlePlatformWebhook(rawBody: string | Buffer, signature: string) {
    return processSubscriptionWebhook({
      subscriptionsRepo: this.subscriptionsRepo, hotelsRepo: this.hotelsRepo, plansRepo: this.plansRepo,
      logger: this.logger, sendPlatformEmail: this.sendPlatformEmail, orm: this.orm,
    }, rawBody, signature)
  }
}
