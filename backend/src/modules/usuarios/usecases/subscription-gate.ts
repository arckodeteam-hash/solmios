// subscription-gate.ts — El corte de servicio en el login.
//
// Hasta ahora `hotel.status: 'suspended'` no se consultaba en ningún lado: un
// hotel suspendido entraba y trabajaba igual. Acá se le pregunta al módulo de
// suscripciones si ese hotel puede operar, y si no, se corta con un mensaje que
// dice qué hacer — no un "credenciales inválidas" que confundiría a alguien que
// puso bien su clave.
import { AuthError } from 'arckode-framework'

export interface AccessCheck {
  allowed: boolean
  reason?: string
}

/** Qué se le dice al que no puede entrar. Tiene que quedar claro el siguiente paso. */
const MESSAGES: Record<string, string> = {
  // #28: la prueba NO arrancó — falta la tarjeta. Decirle "tu prueba terminó" sería mentira y
  // manda al lugar equivocado: lo que tiene que hacer es completar el pago que dejó a medias.
  payment_method_required: 'Te falta cargar el método de pago para empezar tu prueba. Completá ese paso y entrás.',
  trial_expired: 'Tu prueba gratis terminó. Elegí un plan para seguir usando el sistema.',
  subscription_expired: 'Tu suscripción venció. Renovala para volver a entrar.',
  hotel_suspended: 'La cuenta del hotel está suspendida. Escribinos para reactivarla.',
  hotel_inactive: 'La cuenta del hotel está desactivada.',
  subscription_suspended: 'Tu suscripción está suspendida por falta de pago. Regularizá el pago para reactivarla.',
}

/**
 * Lanza si el hotel no puede operar. El error viaja con `code` y `reason` para
 * que el frontend muestre la pantalla de compra en vez de un error genérico.
 *
 * El `super_admin` nunca se bloquea: es quien tiene que poder entrar a arreglar
 * la suscripción de un cliente.
 */
export async function assertHotelCanOperate(
  user: { hotelId?: string; role?: string },
  check?: (hotelId: string) => Promise<AccessCheck>,
): Promise<void> {
  if (!check || !user.hotelId || user.role === 'super_admin') return
  const access = await check(user.hotelId)
  if (access.allowed) return

  const err: any = new AuthError(MESSAGES[access.reason ?? 'trial_expired'] ?? MESSAGES.trial_expired)
  err.code = 'SUBSCRIPTION_REQUIRED'
  err.reason = access.reason
  err.status = 402 // Payment Required: distinto de credenciales inválidas
  throw err
}
