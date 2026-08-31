// admin/usecases/subscription-settings.ts — Config global Grupo B/C de PLAN-SUSCRIPCIONES.md
// (recordatorio, gracia, anti-recuperación, tope de descuento manual). Mismo patrón que
// getModuleState/setModuleState (admin/usecases/modules.ts): 1 fila en `configuration`
// (hotelId='platform', key='subscription_settings'), no una tabla nueva.
import type { RepositoryAdapter } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'

export interface SubscriptionSettings {
  reminderDaysBefore: number
  gracePeriodDays: number
  founderChurnBlocksReturn: boolean
  maxManualDiscountPct: number
  /**
   * ¿El alta exige tarjeta ANTES de que empiecen los días de prueba? (#28)
   *
   * true  — el alta crea el hotel y lo manda al Checkout de Stripe: la tarjeta queda guardada
   *         sin cobrar, el trial corre, y al vencer Stripe cobra solo. Sin tarjeta no se entra
   *         (`access.ts` deniega con `payment_method_required`).
   * false — trial sin tarjeta: al vencer se corta el acceso y hay que contratar a mano.
   *
   * El copy del registro y de la landing se DERIVA de este flag (`GET /api/public/signup-policy`),
   * no es un literal: prometer "sin tarjeta" con el flag en true es la contradicción del #28.
   */
  requireCardOnTrial: boolean
  /**
   * Contador de la landing /hotel-fundador. Se calcula siempre contra un ancla fija +
   * `founderCountdownDurationDays` (`subscriptions/usecases/founder-countdown.ts`) — apagarlo
   * oculta la cuenta regresiva sin tocar código; no hay una fecha límite que reiniciar a mano.
   */
  founderCountdownEnabled: boolean
  /** Duración de cada ciclo del contador, en días. Por defecto 90 (~3 meses). */
  founderCountdownDurationDays: number
}

export const DEFAULT_SUBSCRIPTION_SETTINGS: SubscriptionSettings = {
  reminderDaysBefore: 5,
  gracePeriodDays: 5,
  founderChurnBlocksReturn: true,
  maxManualDiscountPct: 100,
  // Decisión del dueño (#28): la política por defecto es pedir la tarjeta al iniciar la prueba.
  requireCardOnTrial: true,
  founderCountdownEnabled: true,
  founderCountdownDurationDays: 90,
}

const SETTINGS_KEY = 'subscription_settings'
const PLATFORM = 'platform'

async function readRaw(configRepo: RepositoryAdapter<any>): Promise<{ row: any; value: Partial<SubscriptionSettings> }> {
  const rows = await configRepo.findMany({ hotelId: PLATFORM, key: SETTINGS_KEY })
  const row = (rows as any[])?.[0]
  const value = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) : {}
  return { row, value: value && typeof value === 'object' ? value : {} }
}

export async function getSubscriptionSettings(configRepo: RepositoryAdapter<any>): Promise<SubscriptionSettings> {
  const { value } = await readRaw(configRepo)
  return { ...DEFAULT_SUBSCRIPTION_SETTINGS, ...value }
}

export async function setSubscriptionSettings(
  configRepo: RepositoryAdapter<any>, patch: Partial<SubscriptionSettings>,
): Promise<SubscriptionSettings> {
  const { row, value } = await readRaw(configRepo)
  const next: SubscriptionSettings = { ...DEFAULT_SUBSCRIPTION_SETTINGS, ...value }
  for (const k of Object.keys(DEFAULT_SUBSCRIPTION_SETTINGS) as (keyof SubscriptionSettings)[]) {
    if (patch[k] !== undefined) (next as any)[k] = patch[k]
  }
  if (next.reminderDaysBefore < 0 || next.gracePeriodDays < 0 || next.maxManualDiscountPct < 0 || next.maxManualDiscountPct > 100) {
    throw new ValidationError('Valores fuera de rango: días >= 0, maxManualDiscountPct entre 0 y 100')
  }
  if (!Number.isFinite(next.founderCountdownDurationDays) || next.founderCountdownDurationDays < 1 || next.founderCountdownDurationDays > 3650) {
    throw new ValidationError('founderCountdownDurationDays fuera de rango: entre 1 y 3650 días')
  }
  if (row) await configRepo.update(row.id, { value: next })
  else await configRepo.create({ id: crypto.randomUUID(), hotelId: PLATFORM, key: SETTINGS_KEY, value: next })
  return next
}
