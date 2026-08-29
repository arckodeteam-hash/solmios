// wallet-pass/usecases/send-pass-now.ts — Manda el correo "pase + código" de un pase YA generado.
//
// Lo usa `prearrival-pass-cron.ts` 24 h antes de la llegada (pedido del cliente 2026-08-29):
// el pase y el PIN se crean al pagar, pero el correo con el NÚMERO DE HABITACIÓN y el código
// sale recién cuando la habitación está firme. Reusa los datos frescos de la reserva, así que
// si la habitación se reasignó entre el pago y la víspera, el correo lleva la nueva.
//
// Best-effort: devuelve false en vez de lanzar. El cron solo marca `emailSentAt` si dio true,
// de modo que un fallo se reintenta en el tick siguiente.

import { resolveReservationInfo } from './generate-pass'
import type { GeneratePassDeps } from './generate-pass'
import { sendWalletPassEmail } from './pass-email'

export async function sendPassEmailNow(
  deps: GeneratePassDeps,
  reservationId: string,
): Promise<boolean> {
  const log = deps.logger
  try {
    if (!deps.emailService) return false
    const pass = await deps.walletPassRepo.findOne({ reservationId }).catch(() => null)
    if (!pass) return false

    const info = await resolveReservationInfo(deps, reservationId)
    if (!info?.guestEmail) {
      log.info('send-pass-now: reserva sin email de huésped', { reservationId })
      return false
    }

    const result = await sendWalletPassEmail(
      { emailService: deps.emailService, logger: log },
      {
        to: info.guestEmail,
        hotelId: info.hotelId,
        reservationId,
        hotelName: info.hotelName,
        guestName: info.guestName,
        checkIn: info.checkIn,
        checkOut: info.checkOut,
        // Número FRESCO: si la habitación se reasignó después del pago, va la nueva.
        roomNumber: info.roomNumber,
        lockCode: String((pass as { lockCode?: unknown }).lockCode ?? ''),
        appleUrl: (pass as { appleUrl?: string }).appleUrl,
        googleUrl: (pass as { googleUrl?: string }).googleUrl,
      },
    )
    return result.status === 'sent'
  } catch (e) {
    log.warn('send-pass-now falló', { reservationId, error: (e as Error).message })
    return false
  }
}
