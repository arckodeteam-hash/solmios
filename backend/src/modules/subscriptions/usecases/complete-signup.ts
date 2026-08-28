// subscriptions/usecases/complete-signup.ts — Lo que pasa DESPUÉS de que el alta creó la cuenta.
//
// `SignupUseCase` crea hotel + usuario + suscripción y ahí termina su trabajo. Lo que sigue son
// tres cosas que no le corresponden porque dependen de datos de otros módulos: qué política de
// alta rige (`admin`), si hay que abrir un Checkout de Stripe, y avisarle a `referrals` que
// arrancó un trial.
//
// Las dos últimas son BEST-EFFORT y el orden importa: la cuenta ya existe y devolvió 201, así que
// ni Stripe caído ni un connector sin cargar pueden deshacerla ni hacer fallar el request.
import type { SignupInput, SignupResult } from './signup'
import { checkoutUrlForSignup, type CardFlowDeps, type SignupPolicy } from './signup-policy'

export interface CompleteSignupDeps extends CardFlowDeps {
  /** `onTrialStarted` de los sockets del módulo (lo consume `referrals`). */
  notifyTrialStarted?: (p: { hotelId: string; trialEndsAt: string; referralCode?: string }) => Promise<void>
}

export async function completeSignup(
  deps: CompleteSignupDeps,
  policy: SignupPolicy,
  created: Omit<SignupResult, 'requiresPaymentMethod'>,
  input: SignupInput,
  origin?: string,
): Promise<SignupResult> {
  const result: SignupResult = { ...created, requiresPaymentMethod: policy.requireCardOnTrial }

  result.checkoutUrl = await checkoutUrlForSignup(deps, policy, result.hotelId, input.planId, origin)

  try {
    await deps.notifyTrialStarted?.({
      hotelId: result.hotelId, trialEndsAt: result.trialEndsAt, referralCode: input.referralCode,
    })
  } catch (e: any) {
    deps.logger.warn('onTrialStarted socket falló', { hotelId: result.hotelId, error: e?.message })
  }
  return result
}
