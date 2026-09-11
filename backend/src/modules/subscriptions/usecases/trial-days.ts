import type { Logger } from 'arckode-framework'
import { TRIAL_DAYS } from './signup'

/**
 * Días de prueba vigentes (#103): la config de plataforma si hay lector, TRIAL_DAYS si no.
 * Conservador a propósito — si el lector arroja (config caída) la landing sigue diciendo los
 * 15 históricos antes que `/api/public/signup-policy` devuelva 500. Alimenta al alta Y a la
 * política pública: las dos tienen que prometer los mismos días.
 */
export async function safeTrialDays(read: (() => Promise<number>) | undefined, logger: Logger): Promise<number> {
  if (!read) return TRIAL_DAYS
  try {
    return await read()
  } catch (e) {
    logger.warn('subscriptions: no se pudo leer trial_days — la política pública usa el default', { error: (e as Error).message })
    return TRIAL_DAYS
  }
}
