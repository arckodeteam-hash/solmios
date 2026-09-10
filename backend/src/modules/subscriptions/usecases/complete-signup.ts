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
import type { SubscriptionSockets } from '../sockets'

export interface CompleteSignupDeps extends CardFlowDeps {
  /** `onTrialStarted` de los sockets del módulo (lo consume `referrals`). */
  notifyTrialStarted?: (p: { hotelId: string; trialEndsAt: string; referralCode?: string }) => Promise<void>
  /** `onHotelSignedUp` de los sockets del módulo (lo consume `sales-leads`, #145). */
  notifyHotelSignedUp?: SubscriptionSockets['onHotelSignedUp']
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

  // #145 — aviso inmediato a ventas. Los datos salen del input del alta (ya validado y
  // persistido por SignupUseCase): no hace falta releer hotel ni usuario. Mismo contrato que el
  // socket de arriba: best-effort, y el fallo queda en el log — nunca en la respuesta del alta.
  try {
    await deps.notifyHotelSignedUp?.(
      {
        id: result.hotelId,
        name: String(input.hotelName ?? '').trim(),
        email: String(input.email ?? '').trim().toLowerCase(),
        phone: input.phone ?? '',
        country: input.country ?? '',
        createdAt: new Date().toISOString(),
      },
      { id: result.userId, name: input.ownerName?.trim() || String(input.hotelName ?? '').trim(), email: String(input.email ?? '').trim().toLowerCase() },
      input.planId ?? '',
    )
  } catch (e: any) {
    deps.logger.warn('onHotelSignedUp socket falló — el alta sigue, ventas no recibe el aviso', { hotelId: result.hotelId, error: e?.message })
  }
  return result
}
