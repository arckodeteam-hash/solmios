// services/Subscriptions.service.ts — el hotel paga a la plataforma (Stripe Billing).
//
// La LECTURA del estado de la suscripción ya existe en Signup.service.ts (mySubscription(),
// GET /subscription/me) y no se duplica acá: este service solo agrega las ACCIONES
// (checkout/portal, ambas Stripe Checkout/Billing Portal — el navegador redirige a `url`; y la
// mejora de plan de #46, que se resuelve por API sin salir del panel).
import { http } from './http'

export interface StripeRedirect {
  url: string
}

/** Cotización del prorrateo: cuánto le sale HOY al hotel mejorar su plan. No cobra nada. */
export interface UpgradePreview {
  planId: string
  planName: string
  /**
   * Lo que se cobra AHORA, en la MENOR unidad de la moneda (centavos), tal cual lo devuelve
   * Stripe — NO en la unidad de `PublicPlan.price`. Para mostrarlo hay que dividir por 100.
   */
  amountDue: number
  /** ISO 4217 en minúsculas ('usd'), como la maneja Stripe. */
  currency: string
  currentPlanId: string
  currentPlanName: string
  /** Fin del ciclo vigente (ISO): hasta cuándo cubre lo ya pagado. `null` si Stripe no lo informa. */
  periodEnd: string | null
}

/** Resultado de mejorar el plan cobrando la diferencia. */
export interface UpgradeResult {
  /** El plan nuevo YA rige en Stripe. No implica que se haya cobrado: eso lo dice `paid`. */
  applied: boolean
  /** `true` SOLO si la factura del prorrateo quedó paga. En `false` el cobro quedó pendiente. */
  paid: boolean
  planId: string
  planName: string
  previousPlanId: string | null
  /** Misma unidad que `UpgradePreview.amountDue`: centavos. */
  amountCharged: number
  currency: string
  invoiceStatus: string | null
}

export const SubscriptionsService = {
  /** Arranca el pago del plan elegido: Stripe Checkout Session (mode: subscription). */
  checkout: (planId: string) => http.post<StripeRedirect>('/subscriptions/checkout', { planId }),
  /** Gestionar método de pago / ver facturas: Stripe Billing Portal. */
  portal: () => http.post<StripeRedirect>('/subscriptions/portal', {}),
  /** #46 — cuánto costaría mejorar a `planId` hoy. Solo cotiza: no cambia ni cobra nada. */
  upgradePreview: (planId: string) =>
    http.get<UpgradePreview>(`/subscriptions/upgrade/preview?${new URLSearchParams({ planId }).toString()}`),
  /** #46 — aplica la mejora y cobra la diferencia en el acto. Confirmar SIEMPRE con el preview antes. */
  upgrade: (planId: string) => http.post<UpgradeResult>('/subscriptions/upgrade', { planId }),
}
