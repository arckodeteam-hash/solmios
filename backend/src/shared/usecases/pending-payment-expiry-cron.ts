// shared/usecases/pending-payment-expiry-cron.ts — Cron de vencimiento de reservas web sin pago
// (#248, REQ-RWP-05). Mismo molde que abandon-recovery-cron.
//
// Schedule: cada 30 min. Primer tick a los 60 s: deja que arranquen todos los módulos y no pisa el
// arranque (el sweep cancela reservas y dispara sockets/emails; no queremos eso durante el boot).
//
// Flag global `BOOKING_PENDING_TTL_DISABLED=1`: kill-switch operativo para frenar el vencimiento en
// TODOS los hoteles sin tocar `booking_config` (el TTL por hotel sigue siendo la configuración
// normal; el flag es para incidentes). Se evalúa en cada tick, no al construir el cron.
//
// Resiliencia: try/catch outer → warn + resultado en ceros con el error; nunca tira, así el
// setInterval de composition-root sigue vivo. Siempre loguea el resumen de la corrida.

import type { Logger } from 'arckode-framework'
import type { PendingPaymentExpiryResult } from './pending-payment-expiry'

/** Tick del cron: 30 min (el TTL se mide en horas; 30 min de resolución alcanza de sobra). */
export const PENDING_PAYMENT_EXPIRY_TICK_MS = 30 * 60 * 1000
/** Primer tick a los 60 s: que arranquen todos los módulos antes de cancelar nada. */
export const PENDING_PAYMENT_EXPIRY_FIRST_TICK_MS = 60_000

export function isPendingPaymentExpiryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BOOKING_PENDING_TTL_DISABLED === '1'
}

const zeros = (errors: PendingPaymentExpiryResult['errors'] = []): PendingPaymentExpiryResult =>
  ({ scanned: 0, expired: 0, skipped: 0, errors })

/**
 * Factory: devuelve la función que composition-root engancha a setTimeout/setInterval.
 *
 * @param run     `(now) => runPendingPaymentExpiry(deps, now)` ya cableado con sus repos.
 * @param logger  Logger del system.
 * @param env     Entorno (inyectable para tests). Se lee en CADA tick.
 */
export function createPendingPaymentExpiryCron(
  run: (now?: Date) => Promise<PendingPaymentExpiryResult>,
  logger: Logger,
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<PendingPaymentExpiryResult> {
  return async (): Promise<PendingPaymentExpiryResult> => {
    if (isPendingPaymentExpiryDisabled(env)) {
      logger.info('pending-payment-expiry-cron: desactivado por BOOKING_PENDING_TTL_DISABLED=1')
      return zeros()
    }
    try {
      const result = await run()
      // Log de resumen por corrida (issue #248): siempre, aunque no haya vencido ninguna.
      logger.info(`pending-payment-expiry-cron: vencidas: ${result.expired}`, { ...result })
      if (result.errors.length > 0) {
        logger.warn('pending-payment-expiry-cron: corrida con errores', { errors: result.errors })
      }
      return result
    } catch (e: unknown) {
      // Cron-level error (ej: orm caído): log + no rompe el setInterval.
      const message = (e as Error)?.message ?? String(e)
      logger.warn('pending-payment-expiry-cron falló', { error: message })
      return zeros([{ reservationId: '-', reason: `cron-level: ${message}` }])
    }
  }
}
