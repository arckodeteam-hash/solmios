import { OrmRepository } from 'arckode-framework'
import { dispatchLifecycleEmail } from '../../reservas/usecases/lifecycle-email'
import type { EmailSender } from '../../../services/email-sender'

export function createNoShowCron(
  orm: any,
  emailSender: EmailSender,
  logger: any,
  /**
   * Expira los códigos TTLock de la reserva. Un no-show conserva el PIN de la habitación
   * hasta su endDate original: alguien que no se presentó (y cuya habitación se liberó y se
   * puede revender) seguía pudiendo abrir la puerta. `reservas-ttlock` cubre checkout y
   * cancelación, pero el no-show lo marca ESTE cron y no emitía ningún evento.
   * Opcional y best-effort: si falla, el no-show igual se registra.
   */
  expireLockCodes?: (reservationId: string) => Promise<void>,
): () => Promise<number> {
  return async (): Promise<number> => {
    const todayStr = new Date().toISOString().split('T')[0]
    // Antes traía TODAS las reservas de TODOS los hoteles (findMany sin filtro) cada 24h y las
    // descartaba en JS. Solo pending/confirmed pueden ser no-show: se filtran por status en la
    // query (#276). Reduce de "todo el histórico" a las que realmente pueden vencer.
    const [pending, confirmed] = await Promise.all([
      orm.findMany('Reservations', { status: 'pending' }) as Promise<any[]>,
      orm.findMany('Reservations', { status: 'confirmed' }) as Promise<any[]>,
    ])
    const reservas = [...pending, ...confirmed]
    let count = 0
    for (const r of reservas) {
      const ci = String(r.checkIn || '').slice(0, 10)
      if (ci && ci < todayStr) {
        await orm.update('Reservations', r.id, { status: 'no_show' })
        // BUG FIX: liberar la habitación asociada (mismo fix que markNoShows del endpoint) — antes
        // quedaba occupied/reserved y Channex la mostraba fuera de inventario → overbooking.
        if (r.roomId) await orm.update('Rooms', r.roomId, { status: 'available' })
        count++
        if (expireLockCodes) {
          await expireLockCodes(r.id).catch((e: any) =>
            logger.warn('no-show: no se pudo expirar el código', { reservationId: r.id, error: (e as Error).message }))
        }
        dispatchLifecycleEmail(
          { emailSender, guestRepo: new OrmRepository<any>(orm, 'Guests'), roomRepo: new OrmRepository<any>(orm, 'Rooms'), hotelRepo: new OrmRepository<any>(orm, 'Hotels'), messageLogRepo: new OrmRepository<any>(orm, 'MessageLogs'), logger },
          { reservationId: r.id, hotelId: r.hotelId, guestId: r.guestId, roomId: r.roomId, checkIn: r.checkIn, checkOut: r.checkOut, event: 'no_show' },
        ).catch((e: any) => logger.warn('no-show email', { reservationId: r.id, error: (e as Error).message }))
      }
    }
    return count
  }
}
