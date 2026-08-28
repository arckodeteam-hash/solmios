// subscriptions/usecases/signup-policy.ts — #28: la política de alta de la plataforma.
//
// "¿El alta pide tarjeta antes de que corra la prueba?" lo decide el super-admin
// (`subscription_settings.requireCardOnTrial`, módulo `admin`, llega por connector). Acá vive lo
// que el módulo hace CON esa respuesta: cuántos días de prueba le quedan a quien todavía no cargó
// tarjeta, y bajo qué condiciones se le puede reabrir el Checkout que abandonó.
//
// El criterio transversal es fail-open para el ACCESO y fail-closed para el DINERO: si la config
// no se puede leer, nadie queda afuera (se asume que no se exige tarjeta), pero tampoco se abre
// un Checkout sin haber confirmado que hay un pago pendiente de verdad.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface SignupPolicy {
  requireCardOnTrial: boolean
}

/** Política vigente. Un fallo de lectura NO puede cortar accesos: cae a "no exige tarjeta". */
export async function readSignupPolicy(
  read?: () => Promise<SignupPolicy>,
): Promise<SignupPolicy> {
  if (!read) return { requireCardOnTrial: false }
  try {
    return { requireCardOnTrial: (await read()).requireCardOnTrial === true }
  } catch {
    return { requireCardOnTrial: false }
  }
}

/**
 * Días de prueba que le quedan a un hotel que todavía no dio la tarjeta, o `undefined` si el
 * Checkout tiene que cobrar de una (política apagada, tarjeta ya cargada, o prueba vencida).
 *
 * Se redondea hacia arriba y sale de `trialEndsAt`, no de `TRIAL_DAYS`: si alguien abandona el
 * Checkout el día 5 de 7, al volver le quedan 2 — no se le regalan 7 nuevos por reintentar.
 */
export async function pendingTrialDays(
  subscriptionsRepo: RepositoryAdapter<any>,
  policy: SignupPolicy,
  hotelId: string,
  now: Date = new Date(),
): Promise<number | undefined> {
  if (!policy.requireCardOnTrial) return undefined
  const sub = ((await subscriptionsRepo.findMany({ hotelId })) as any[])?.[0]
  if (!sub || sub.status !== 'trialing' || sub.paymentMethodAddedAt) return undefined
  // Sin la marca nunca se le pidió tarjeta (p. ej. el plan no tiene precio en Stripe): no hay
  // pago pendiente que retomar y tampoco corresponde bloquearlo.
  if (!sub.awaitingPaymentMethodSince) return undefined
  if (!sub.trialEndsAt) return undefined
  const left = Math.ceil((new Date(sub.trialEndsAt).getTime() - now.getTime()) / MS_PER_DAY)
  return left > 0 ? left : undefined
}

/**
 * ¿Este hotel tiene un pago del alta pendiente de completar, y contra qué plan?
 * `null` = no hay nada que retomar (y quien llama debe responder lo mismo que ante credenciales
 * inválidas, para no delatar el estado de una cuenta ajena).
 */
export async function resumableCheckout(
  subscriptionsRepo: RepositoryAdapter<any>,
  policy: SignupPolicy,
  hotelId: string,
  now: Date = new Date(),
): Promise<{ planId: string; trialDays: number } | null> {
  const trialDays = await pendingTrialDays(subscriptionsRepo, policy, hotelId, now)
  if (!trialDays) return null
  const sub = ((await subscriptionsRepo.findMany({ hotelId })) as any[])?.[0]
  if (!sub?.planId) return null
  return { planId: String(sub.planId), trialDays }
}

/** Lo que la orquestación del alta con tarjeta necesita del módulo, sin conocer al service. */
export interface CardFlowDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  /** Abre una Checkout Session ya resuelta (incluye los días de prueba si corresponde). */
  createCheckout: (hotelId: string, planId: string, origin: string) => Promise<{ url: string }>
  /** Valida email+contraseña sin emitir sesión (`connectors/subscriptions-usuarios-owner.ts`). */
  verifyOwner?: (email: string, password: string) => Promise<{ hotelId?: string } | null>
  logger: { warn: (msg: string, meta?: Record<string, unknown>) => void }
}

/**
 * URL del Checkout con la que arranca un alta que exige tarjeta, o `undefined`.
 *
 * Se arma en el mismo request del alta y NO la pide el frontend después de loguearse: el login
 * corre `assertHotelCanOperate`, que con la política prendida corta a este hotel con
 * `payment_method_required` — nunca habría token para pedirlo. Best-effort a propósito: si Stripe
 * falla, la cuenta ya existe y el pago se completa desde el login (`resumeAbandonedCheckout`).
 */
export async function checkoutUrlForSignup(
  deps: CardFlowDeps,
  policy: SignupPolicy,
  hotelId: string,
  planId?: string,
  origin?: string,
): Promise<string | undefined> {
  if (!policy.requireCardOnTrial || !planId || !origin) return undefined
  let url: string
  try {
    url = (await deps.createCheckout(hotelId, planId, origin)).url
  } catch (e: any) {
    // El caso real que esto cubre: plan sin `stripePriceId`. Se avisa fuerte porque significa que
    // la política está prendida y NO se está aplicando — el hotel entra con la prueba normal.
    deps.logger.warn('Alta: no se pudo abrir el Checkout — la prueba arranca SIN tarjeta', {
      hotelId, planId, error: e?.message,
    })
    return undefined
  }

  // Recién ahora se sella: al hotel se le pidió la tarjeta de verdad, así que se le puede exigir.
  // Best-effort — si el UPDATE falla, el peor caso es que entre sin tarjeta, nunca que quede
  // encerrado sin poder pagar.
  try {
    const sub = ((await deps.subscriptionsRepo.findMany({ hotelId })) as any[])?.[0]
    if (sub) await deps.subscriptionsRepo.update(sub.id, { awaitingPaymentMethodSince: new Date().toISOString() })
  } catch (e: any) {
    deps.logger.warn('Alta: no se pudo marcar la espera del método de pago', { hotelId, error: e?.message })
  }
  return url
}

/**
 * Reabre el Checkout del alta para quien no puede loguearse por no haberlo completado.
 *
 * La autorización son las credenciales del propio dueño. Todos los caminos de fallo —sin
 * verificador, credenciales que no validan, cuenta sin pago pendiente— terminan en un error, y los
 * dos últimos deliberadamente NO se distinguen hacia afuera: esto es un endpoint público y no
 * puede volverse un oráculo de qué cuentas existen ni en qué estado están.
 */
export async function resumeAbandonedCheckout(
  deps: CardFlowDeps,
  policy: SignupPolicy,
  email: string,
  password: string,
  origin: string,
): Promise<{ url: string }> {
  if (!deps.verifyOwner) throw new ValidationError('No se puede retomar el pago en este momento')
  const hotelId = (await deps.verifyOwner(email, password))?.hotelId
  if (!hotelId) throw new ValidationError('No pudimos validar tus datos')
  const pending = await resumableCheckout(deps.subscriptionsRepo, policy, hotelId)
  if (!pending) throw new ValidationError('Esta cuenta no tiene un pago pendiente de completar')
  return deps.createCheckout(hotelId, pending.planId, origin)
}
