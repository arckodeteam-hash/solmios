// shared/usecases/prearrival-pass-cron.ts — Manda el pase + código de acceso 24 h antes.
//
// Por qué (pedido del cliente, 2026-08-29): antes el correo con el NÚMERO DE HABITACIÓN y el
// código de la puerta salía al confirmarse el pago. Pero la habitación puede reasignarse hasta
// el día antes de la llegada, así que ese número llegaba sin estar firme. Ahora al pagar va la
// confirmación de pago (`booking-paid-email.ts`, sin habitación ni código) y este cron manda el
// pase cuando la llegada ya está a menos de 24 h.
//
// Molde: trial-reminder-cron.ts. Dedup con `wallet_passes.emailSentAt` — sin esa marca el cron
// reenviaría el mismo correo en cada tick.
//
// `now` inyectable para poder fijar la fecha en los tests sin tocar el reloj global.

import { reservationAccessWindow } from '../utils/hotel-schedule'

const MS_PER_HOUR = 60 * 60 * 1000

/** Ventana de disparo: la llegada está a <= 24 h. */
export const PREARRIVAL_WINDOW_HOURS = 24

/**
 * Estados a los que SÍ se les manda el código. Lista blanca a propósito: cualquier estado
 * nuevo queda fuera por default, en vez de colarse por no estar en una lista negra.
 * `pending` (sin pagar) está excluida — el código de la puerta no se entrega sin cobro.
 */
const DELIVERABLE_STATUS: ReadonlySet<string> = new Set(['confirmed', 'checked_in'])

export interface PrearrivalCronResult {
  sent: number
  skipped: number
}

export function createPrearrivalPassCron(
  orm: any,
  resolveModule: (name: string) => any,
  logger: any,
): (now?: Date) => Promise<PrearrivalCronResult> {
  return async (now: Date = new Date()): Promise<PrearrivalCronResult> => {
    const result: PrearrivalCronResult = { sent: 0, skipped: 0 }
    try {
      const wallet = resolveModule('wallet-pass')
      if (!wallet || typeof wallet.sendPassEmailNow !== 'function') {
        logger.warn('prearrival-pass-cron: módulo wallet-pass no disponible')
        return result
      }

      // Solo las que todavía no recibieron el aviso. Un pase obsoleto (habitación reasignada)
      // se saltea: el flujo de reasignación genera uno nuevo, y mandar el viejo daría un código
      // que ya no abre.
      const passes = (await orm.findMany('WalletPasses', {})) as any[]
      for (const pass of passes) {
        if (pass.emailSentAt || pass.obsoleteAt) { result.skipped++; continue }

        // @ignore IDOR_RISK — el reservationId sale de la propia fila del pase (dato del
        // sistema, no de un request): el cron recorre TODOS los pases pendientes de aviso.
        const reservation = await orm.findById('Reservations', pass.reservationId)
        if (!reservation || !reservation.checkIn) { result.skipped++; continue }

        // Solo reservas VIGENTES y ya comprometidas. Lista blanca, no negra: una `pending`
        // (reservada pero sin pagar) NO puede recibir el código de la puerta — sería dar acceso
        // a la habitación a alguien que todavía no pagó. Cancelada o ya salida tampoco.
        if (!DELIVERABLE_STATUS.has(String(reservation.status ?? ''))) {
          result.skipped++
          continue
        }

        const hotel = await orm.findById('Hotels', reservation.hotelId)
        const arrivalMs = arrivalInstant(reservation, hotel)
        if (!Number.isFinite(arrivalMs)) { result.skipped++; continue }

        const hoursLeft = (arrivalMs - now.getTime()) / MS_PER_HOUR
        // Todavía falta: se manda en un tick posterior. Ya pasó la llegada: igual se manda —
        // el huésped que llega necesita su código, y sin esto una caída del cron lo dejaría
        // sin nada. Por eso el corte es solo por arriba.
        if (hoursLeft > PREARRIVAL_WINDOW_HOURS) { result.skipped++; continue }

        const ok = await wallet.sendPassEmailNow(pass.reservationId)
        if (ok) {
          await orm.update('WalletPasses', pass.id, { emailSentAt: now.toISOString() })
          result.sent++
        } else {
          result.skipped++
        }
      }

      if (result.sent > 0) logger.info('prearrival-pass-cron', result)
      return result
    } catch (e) {
      logger.error('prearrival-pass-cron falló', { error: (e as Error).message })
      return result
    }
  }
}

/** Instante real de la llegada, en la zona del hotel — el MISMO criterio con el que se abre
 *  el código de la cerradura, así el aviso y el acceso no se calculan de dos maneras. */
function arrivalInstant(reservation: any, hotel: any): number {
  return reservationAccessWindow(reservation, hotel).startMs
}
