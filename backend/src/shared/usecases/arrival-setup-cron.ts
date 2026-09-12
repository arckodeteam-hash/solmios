// shared/usecases/arrival-setup-cron.ts — Garantiza la tarea `arrival_setup` de cada llegada (#274).
//
// Por qué existe además del connector `reservas-housekeeping`: el motor público escribe
// `Reservations` directo (bookingengine/usecases/public-booking.ts) y Stripe la confirma con el
// orm (stripe.ts), sin pasar por el CRUD de `reservas` — así que esas altas nunca emiten
// onReservasCreated/Updated. Este cron recorre las reservas `confirmed` con check-in en la
// ventana [hoy-1, hoy+SETUP_WINDOW_DAYS] y las pasa por `housekeeping.syncArrivalSetup`, que es
// idempotente: correrlo N veces no duplica ni pisa trabajo hecho. hoy-1 cubre el día que se
// terminó de confirmar tarde (la llegada de ayer que todavía no hizo check-in).
//
// Molde: prearrival-pass-cron.ts. `now` inyectable para fijar la fecha en los tests.

import { SETUP_WINDOW_DAYS } from '../../modules/housekeeping/usecases/arrival-setup'

/** Cada 30 min: la ventana es de días, no hace falta más fino. */
export const ARRIVAL_SETUP_TICK_MS = 30 * 60_000

/** Días hacia atrás desde hoy que también se revisan (llegada de ayer sin check-in aún). */
const LOOKBACK_DAYS = 1

export interface ArrivalSetupCronResult {
  synced: number
  skipped: number
}

/** Fechas UTC (YYYY-MM-DD) de la ventana: `ORM.findMany` filtra sólo por igualdad, una consulta por día. */
export function arrivalSetupDates(now: Date): string[] {
  const dates: string[] = []
  for (let offset = -LOOKBACK_DAYS; offset <= SETUP_WINDOW_DAYS; offset++) {
    dates.push(new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10))
  }
  return dates
}

export function createArrivalSetupCron(
  orm: any,
  resolveModule: (name: string) => any,
  logger: any,
): (now?: Date) => Promise<ArrivalSetupCronResult> {
  return async (now: Date = new Date()): Promise<ArrivalSetupCronResult> => {
    const result: ArrivalSetupCronResult = { synced: 0, skipped: 0 }
    try {
      let housekeeping: any
      try { housekeeping = resolveModule('housekeeping') } catch { housekeeping = null }
      if (!housekeeping || typeof housekeeping.syncArrivalSetup !== 'function') {
        logger.warn('arrival-setup-cron: módulo housekeeping no disponible')
        return result
      }

      for (const checkIn of arrivalSetupDates(now)) {
        const reservations = ((await orm.findMany('Reservations', { status: 'confirmed', checkIn })) ?? []) as any[]
        for (const reservation of reservations) {
          try {
            await housekeeping.syncArrivalSetup(reservation)
            result.synced++
          } catch (e) {
            // Una reserva rota no frena al resto: se loguea y sigue.
            result.skipped++
            logger.warn('arrival-setup-cron: syncArrivalSetup falló', { reservationId: reservation?.id, error: (e as Error).message })
          }
        }
      }

      if (result.synced > 0) logger.info('arrival-setup-cron', result)
      return result
    } catch (e) {
      logger.error('arrival-setup-cron falló', { error: (e as Error).message })
      return result
    }
  }
}
