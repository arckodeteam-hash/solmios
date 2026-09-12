// wallet-pass/usecases/partial-pass.ts — Pase PARCIAL para reservas sin habitación (#262, REQ-HAC-07).
//
// Con HAC-01 la reserva nace con `roomId = null` y la habitación se asigna en recepción. Sin
// habitación TTLock no puede generar código, así que `generate-pass.ts` no persiste nada y el
// cron de pre-llegada no tendría qué mandar. Este usecase le da al cron un pase "de reserva":
// tipo vendido, fechas y horario, con la habitación "Por asignar" y SIN bloque de código.
//
// Persiste la fila en `wallet_passes` con `lockCode: ''` (= parcial; el modelo solo exige
// NOT NULL) y `emailSentAt` seteado, de modo que:
//   - una segunda llamada NO reenvía (la fila ya existe), y
//   - cuando se asigne la habitación, `generatePass` la completa in-place (lockCode + URLs,
//     `emailSentAt: null`) y el cron manda el pase completo.
//
// Best-effort: devuelve false en vez de lanzar (mismo molde que send-pass-now.ts).

import { resolveReservationInfo } from './generate-pass'
import type { GeneratePassDeps } from './generate-pass'
import { sendWalletPassEmail } from './pass-email'
import type { WalletPassDTO } from '../types'

export async function sendPartialPassNow(
  deps: GeneratePassDeps,
  reservationId: string,
): Promise<boolean> {
  const log = deps.logger
  try {
    if (!deps.emailService) return false

    // Ya hay fila (parcial o completa): no se reenvía.
    const existing = await deps.walletPassRepo.findOne({ reservationId }).catch(() => null)
    if (existing) return false

    const info = await resolveReservationInfo(deps, reservationId)
    if (!info?.guestEmail) {
      log.info('partial-pass: reserva sin email de huésped', { reservationId })
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
        checkInTime: info.checkInTime,
        checkOutTime: info.checkOutTime,
        // Sin habitación: se promete el tipo, nunca un número. lockCode '' = sin bloque de código.
        roomType: info.roomType,
        lockCode: '',
      },
    )
    if (result.status !== 'sent') return false

    const now = new Date().toISOString()
    await deps.walletPassRepo.create({
      hotelId: info.hotelId,
      reservationId,
      appleUrl: null,
      googleUrl: null,
      lockCode: '',
      generatedAt: now,
      emailSentAt: now,
    } as Omit<WalletPassDTO, 'id'>)
    log.info('partial-pass: pase parcial enviado', { reservationId, hotelId: info.hotelId })
    return true
  } catch (e) {
    log.warn('partial-pass falló', { reservationId, error: (e as Error).message })
    return false
  }
}
