// shared/usecases/approval-reminder-cron.ts — Cron del recordatorio de aprobación pendiente
// (#271 MR-06). Mismo molde que pending-payment-expiry-cron.
//
// Schedule: cada 15 min (el plazo se mide en horas: `booking_config.approvalDeadlineHours`, así
// que 15 min de resolución sobra). Primer tick a los 30 s: deja que arranquen todos los módulos
// (el aviso usa notificaciones, usuarios, roles, correo y push) y no pisa el arranque.
//
// Flag global `BOOKING_APPROVAL_REMINDER_DISABLED=1`: kill-switch operativo para frenar el
// recordatorio en TODOS los hoteles sin tocar `booking_config`. Se evalúa en cada tick.
//
// Resiliencia: try/catch outer → warn + resultado en ceros con el error; nunca tira, así el
// setInterval de composition-root sigue vivo. Siempre loguea el resumen de la corrida.

import type { Logger } from 'arckode-framework'
import type { ApprovalReminderResult } from './approval-reminder'

/** Tick del cron: 15 min (el plazo por hotel se mide en horas). */
export const APPROVAL_REMINDER_TICK_MS = 15 * 60 * 1000
/** Primer tick a los 30 s: que arranquen todos los módulos antes de avisar nada. */
export const APPROVAL_REMINDER_FIRST_TICK_MS = 30_000

export function isApprovalReminderDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BOOKING_APPROVAL_REMINDER_DISABLED === '1'
}

const zeros = (errors: ApprovalReminderResult['errors'] = []): ApprovalReminderResult =>
  ({ scanned: 0, reminded: 0, skipped: 0, errors })

/**
 * Factory: devuelve la función que composition-root engancha a setTimeout/setInterval.
 *
 * @param run     `(now) => runApprovalReminder(deps, now)` ya cableado con sus repos.
 * @param logger  Logger del system.
 * @param env     Entorno (inyectable para tests). Se lee en CADA tick.
 */
export function createApprovalReminderCron(
  run: (now?: Date) => Promise<ApprovalReminderResult>,
  logger: Logger,
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<ApprovalReminderResult> {
  return async (): Promise<ApprovalReminderResult> => {
    if (isApprovalReminderDisabled(env)) {
      logger.info('approval-reminder-cron: desactivado por BOOKING_APPROVAL_REMINDER_DISABLED=1')
      return zeros()
    }
    try {
      const result = await run()
      logger.info(`approval-reminder-cron: recordadas: ${result.reminded}`, { ...result })
      if (result.errors.length > 0) {
        logger.warn('approval-reminder-cron: corrida con errores', { errors: result.errors })
      }
      return result
    } catch (e: unknown) {
      const message = (e as Error)?.message ?? String(e)
      logger.warn('approval-reminder-cron falló', { error: message })
      return zeros([{ reservationId: '-', reason: `cron-level: ${message}` }])
    }
  }
}
