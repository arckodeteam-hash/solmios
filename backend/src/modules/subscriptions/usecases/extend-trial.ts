// subscriptions/usecases/extend-trial.ts — REQ-PIPE-05 (#146): darle más días de prueba a un hotel.
//
// Prod 2026-09-10: 15 trials vencidos en `trialing` y ninguna forma de reabrirlos desde el admin.
// Un hotel que se enfrió no está perdido si alguien lo llama y le da una semana más; sin este
// usecase la única salida era tocar la fila a mano en la base.
//
// Reglas:
//   - La extensión se cuenta desde HOY si el trial ya venció (max(trialEndsAt, now) + days): un
//     hotel vencido hace 5 días con +7 tiene 7 días por delante, no 2.
//   - Vuelve a `trialing` y limpia los dedup del cron (`trialReminderSentAt`,
//     `trialExpiredEmailSentAt`): sin eso el "te quedan 2 días" y el "venció" no volverían a salir.
//   - Encola `trial_extended` al hotel por el mismo camino que `trial_ending`/`trial_expired`
//     (`platform-emails.sendEvent`), best-effort: sin correo la extensión igual queda hecha.
//   - `{platform_name}` se resuelve acá desde `configuration('plataforma')` — el nombre nunca va
//     escrito en la plantilla.
//   - SOLO se extiende una PRUEBA: `trialing` o `expired`, y sin `stripeSubscriptionId`. Antes el
//     `status:'trialing'` era incondicional y una sub `active` con Stripe quedaba en `trialing`:
//     `access.ts` la bloqueaba al vencer el trial y `create-checkout-session` dejaba de verla viva
//     (doble Checkout, BUG-9). Cualquier otro estado es `ConflictError` (409): para eso están
//     reactivar y condiciones especiales.
//
// Puro: repos inyectados, `now` inyectable (mismo criterio que trial-reminder-cron.ts).
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { RepositoryAdapter } from 'arckode-framework'
import { resolvePlatformIdentity, platformEmailVariables } from '../../../shared/utils/platform-identity'

/** Estados desde los que tiene sentido "dar más días de prueba". */
export const EXTENDABLE_TRIAL_STATUSES: ReadonlyArray<string> = ['trialing', 'expired']

export const EXTEND_TRIAL_MIN_DAYS = 1
export const EXTEND_TRIAL_MAX_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface ExtendTrialDeps {
  subscriptionsRepo: RepositoryAdapter<any>
  hotelsRepo: RepositoryAdapter<any>
  /** KV `configuration` — de acá sale `{platform_name}`. Opcional: sin él, defaults. */
  configRepo?: Pick<RepositoryAdapter<any>, 'findOne'>
  /** `platform-emails.sendEvent()`. Opcional: sin cablear, el correo no sale (best-effort). */
  sendPlatformEmail?: (event: string, to: string, hotelId: string, vars: Record<string, string>) => Promise<{ sent: boolean }>
  /** Base absoluta del panel (PUBLIC_URL) para `{link}`. */
  publicUrl?: string
  logger?: { warn: (msg: string, meta?: any) => void }
}

export interface ExtendTrialResult {
  subscription: any
  /** Días de prueba que le quedan al hotel después de extender (= `days` si estaba vencido). */
  daysLeft: number
  previousTrialEndsAt: string | null
  emailSent: boolean
}

export function assertExtendTrialDays(days: unknown): asserts days is number {
  if (typeof days !== 'number' || !Number.isInteger(days) || days < EXTEND_TRIAL_MIN_DAYS || days > EXTEND_TRIAL_MAX_DAYS) {
    throw new ValidationError(`days debe ser un entero entre ${EXTEND_TRIAL_MIN_DAYS} y ${EXTEND_TRIAL_MAX_DAYS}`)
  }
}

export async function extendTrial(
  deps: ExtendTrialDeps,
  hotelId: string,
  days: number,
  now: Date = new Date(),
): Promise<ExtendTrialResult> {
  assertExtendTrialDays(days)

  const sub = await deps.subscriptionsRepo.findOne({ hotelId })
  if (!sub) throw new NotFoundError('El hotel no tiene una suscripción registrada')
  assertExtendable(sub)

  const previousTrialEndsAt: string | null = sub.trialEndsAt ?? null
  const previous = previousTrialEndsAt ? new Date(previousTrialEndsAt) : null
  const base = previous && !Number.isNaN(previous.getTime()) && previous.getTime() > now.getTime() ? previous : now
  const trialEndsAt = new Date(base.getTime() + days * MS_PER_DAY)

  const subscription = await deps.subscriptionsRepo.update(sub.id, {
    status: 'trialing',
    trialEndsAt: trialEndsAt.toISOString(),
    trialReminderSentAt: null,
    trialExpiredEmailSentAt: null,
  })

  const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / MS_PER_DAY)
  const emailSent = await notifyHotel(deps, hotelId, daysLeft)

  return {
    subscription,
    daysLeft,
    previousTrialEndsAt,
    emailSent,
  }
}

/** Estado en español para el 409 (lo lee el vendedor en un toast, no una máquina). */
const STATUS_ES: Record<string, string> = {
  active: 'activa',
  past_due: 'con pago vencido',
  canceled: 'cancelada',
  suspended: 'suspendida',
}

function assertExtendable(sub: { status?: string | null; stripeSubscriptionId?: string | null }): void {
  const status = String(sub.status ?? '')
  if (!EXTENDABLE_TRIAL_STATUSES.includes(status)) {
    throw new ConflictError(
      `La suscripción está ${STATUS_ES[status] ?? 'en un estado desconocido'}, no en período de prueba; use reactivar o condiciones especiales`,
    )
  }
  if (sub.stripeSubscriptionId) {
    throw new ConflictError(
      'La suscripción tiene una suscripción de Stripe asociada (ya fue paga): use reactivar o condiciones especiales',
    )
  }
}

async function notifyHotel(deps: ExtendTrialDeps, hotelId: string, daysLeft: number): Promise<boolean> {
  if (!deps.sendPlatformEmail) return false
  try {
    const hotel = await deps.hotelsRepo.findById(hotelId)
    if (!hotel?.email) return false
    const identity = await resolvePlatformIdentity(deps.configRepo ?? { findOne: async () => null })
    const link = `${(deps.publicUrl || '').replace(/\/$/, '')}/panel/suscripcion`
    const { sent } = await deps.sendPlatformEmail('trial_extended', hotel.email, hotel.id, {
      ...platformEmailVariables(identity),
      hotel_name: hotel.name ?? '',
      days_left: String(daysLeft),
      link,
    })
    return sent
  } catch (e: any) {
    deps.logger?.warn('extend-trial: no se pudo encolar trial_extended', { hotelId, error: e?.message })
    return false
  }
}
