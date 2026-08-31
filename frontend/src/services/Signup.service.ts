import { http } from './http'

/** Plan tal como lo ve alguien que todavía no es cliente. */
/** Topes públicos del plan (`plans.limits`). Los recorta el backend en `public-plans.ts`. */
export interface PublicPlanLimits {
  rooms?: number
  users?: number
  /**
   * CFG-2: "sin tope" ya viene RESUELTO del servidor (`public-plans.ts` →
   * `UNLIMITED_LIMIT_SENTINEL`). El frontend no repite el centinela numérico: sólo lo usa como
   * respaldo si el campo no viene (respuesta de una versión anterior del backend).
   */
  roomsUnlimited?: boolean
}

export interface PublicPlan {
  id: string
  name: string
  slug: string
  price: number
  currency: string
  description: string
  features: string[]
  /** CFG-1: el tope de habitaciones sale de la tabla `plans`, no de un literal en el frontend. */
  limits?: PublicPlanLimits
}

export interface SignupPayload {
  hotelName: string
  email: string
  password: string
  ownerName?: string
  country?: string
  address?: string
  phone?: string
  planId?: string
  /** Código de referido (`?ref=` en la URL, ver `/r/:code`). */
  referralCode?: string
  /** Token del captcha (Turnstile). Solo si el build tiene site key. */
  captchaToken?: string
}

export interface SignupResult {
  hotelId: string
  userId: string
  trialEndsAt: string
  trialDays: number
  /**
   * #28: la plataforma pide tarjeta ANTES de que corra la prueba. La cuenta ya existe, pero el
   * registro no debe mandar al panel: tiene que llevar al checkout de Stripe. Quien lo abandone
   * queda con el acceso cortado (`reason: 'payment_method_required'`).
   */
  requiresPaymentMethod?: boolean
  /** URL del Checkout de Stripe a la que mandar al usuario. La arma el alta, no el frontend. */
  checkoutUrl?: string
}

/**
 * Qué promete el alta hoy. Sale del servidor (`subscription_settings.requireCardOnTrial` +
 * `TRIAL_DAYS`) y NO de literales en el template: el "sin tarjeta" escrito a mano en la landing
 * y en el registro era justamente la contradicción del #28.
 */
export interface SignupPolicy {
  requireCardOnTrial: boolean
  trialDays: number
}

/** Estado de la suscripción del hotel logueado. */
export interface MySubscription {
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  planId: string
  allowed: boolean
  reason: string | null
  daysLeft: number | null
  /** Ya pagó al menos una vez (tiene Customer de Stripe) → puede abrir el Billing Portal. */
  hasStripeCustomer: boolean
  /** Categoría especial activa (Fundador Uno/Dos, Pionero), si tiene. */
  specialCategory?: 'founder_one' | 'founder_two' | 'pioneer' | null
  /** % de descuento activo (manual o de categoría), si tiene. */
  activeDiscountPct?: number | null
}

/**
 * Rutas públicas del alta. `http` desenvuelve `{success,data}`; estas responden
 * `{data:…}` anidado, así que se normaliza acá en vez de repetirlo en la vista.
 */
function unwrap<T>(res: any): T {
  return (res?.data ?? res) as T
}

export const SignupService = {
  async publicPlans(): Promise<PublicPlan[]> {
    const res = await http.get<any>('/public/plans')
    const list = unwrap<any>(res)
    return Array.isArray(list) ? list : []
  },

  /**
   * % del programa Hotel Fundador. Sale de `special_category_config` (editable desde /admin), NO
   * de una variable de build: es el mismo número con el que se cobra (CFG-1). `null` = el servidor
   * no tiene una config usable y la vista decide su copy de reserva.
   */
  async founderDiscountPct(): Promise<number | null> {
    const res = await http.get<any>('/public/founder-discount')
    const pct = Number((res?.data ?? res)?.discountPct)
    return Number.isFinite(pct) && pct > 0 && pct < 100 ? pct : null
  },

  /**
   * Contador cíclico de /hotel-fundador — prendido/apagado y duración del ciclo, editables desde
   * /admin (`subscription_settings`). `anchorAt` es una fecha ancla fija: el frontend calcula el
   * corte vigente con `%` contra ella, así que nunca hace falta reiniciar nada a mano cuando el
   * ciclo llega a 0 — el siguiente cálculo ya cae dentro del próximo ciclo.
   */
  async founderCountdown(): Promise<{ enabled: boolean; durationDays: number; anchorAt: string } | null> {
    const res = await http.get<any>('/public/founder-countdown')
    const data = res?.data ?? res
    const durationDays = Number(data?.durationDays)
    if (!data || typeof data.anchorAt !== 'string' || !Number.isFinite(durationDays) || durationDays <= 0) return null
    return { enabled: data.enabled === true, durationDays, anchorAt: data.anchorAt }
  },

  /**
   * Política del alta. Ante cualquier fallo devuelve el camino conservador —sin tarjeta, 7 días—
   * para que la pantalla de registro se pueda dibujar aunque el endpoint no responda; el backend
   * es igual el que decide de verdad, esto solo elige el texto.
   */
  async signupPolicy(): Promise<SignupPolicy> {
    try {
      const res = await http.get<any>('/public/signup-policy')
      const p = unwrap<any>(res)
      const days = Number(p?.trialDays)
      return {
        requireCardOnTrial: p?.requireCardOnTrial === true,
        trialDays: Number.isFinite(days) && days > 0 ? days : 7,
      }
    } catch {
      return { requireCardOnTrial: false, trialDays: 7 }
    }
  },

  async signup(payload: SignupPayload): Promise<SignupResult> {
    const res = await http.post<any>('/public/signup', payload)
    return unwrap<SignupResult>(res)
  },

  /**
   * #28 — reabre el Checkout del alta para quien no puede loguearse por no haberlo completado.
   * Manda credenciales y recibe SOLO la URL de Stripe: no crea sesión ni devuelve datos del usuario.
   */
  async resumeCheckout(email: string, password: string): Promise<{ url: string }> {
    const res = await http.post<any>('/public/resume-checkout', { email, password })
    return unwrap<{ url: string }>(res)
  },

  async mySubscription(): Promise<MySubscription> {
    const res = await http.get<any>('/subscription/me')
    return unwrap<MySubscription>(res)
  },
}
