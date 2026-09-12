// reservas/usecases/approval-email.ts — Email al huésped cuando el hotel aprueba o rechaza una
// reserva pendiente de aprobación (#271, MR-06).
//
// Contraparte de `lifecycle-email.ts` para los eventos `reservation_approved` /
// `reservation_rejected`: mismo patrón fail-soft (sin email → message_logs 'skipped'; tenacy
// guest/room; 'sent'/'failed' en message_logs; NUNCA tira — la aprobación o el rechazo ya están
// hechos cuando esto corre y un SMTP caído no los deshace).
//
// Diferencia con lifecycle-email: `input.variables` viaja desde el usecase que lo llama
// (`reject.ts` manda `rejection_reason` y `refund_amount`) y se MERGEA sobre las variables base
// (guest_name, hotel_name, ...). Este archivo es quien tipa el evento: `reject.ts` lo pasa como
// string para poder typechequear solo (ver RejectNotifyInput).

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../../services/email-sender'
import { resolveGuestLanguage } from '../../../services/guest-language'
import type { RejectNotifyInput, RejectNotifyPort } from './reject'
import type { GuestSummary, RoomSummary, HotelSummary, MessageLogSummary } from './types'

export type ApprovalEmailEvent = 'reservation_approved' | 'reservation_rejected'

export interface ApprovalEmailDeps {
  emailSender: EmailSender
  guestRepo: RepositoryAdapter<GuestSummary>
  roomRepo: RepositoryAdapter<RoomSummary>
  hotelRepo: RepositoryAdapter<HotelSummary>
  /** `null` antes de `setEmailDeps` (email-bootstrap): se encola igual, sólo no queda rastro en message_logs. */
  messageLogRepo: RepositoryAdapter<MessageLogSummary> | null
  logger: Logger
}

export interface ApprovalEmailInput extends RejectNotifyInput {
  event: ApprovalEmailEvent
}

const EVENTS: ReadonlySet<string> = new Set<ApprovalEmailEvent>(['reservation_approved', 'reservation_rejected'])

/** Fila de message_logs; sin repo (pre-bootstrap) no registra, y un fallo del log tampoco tira. */
async function log(deps: ApprovalEmailDeps, input: RejectNotifyInput, row: Partial<MessageLogSummary>): Promise<void> {
  if (!deps.messageLogRepo) return
  try {
    await deps.messageLogRepo.create({
      hotelId: input.hotelId, reservationId: input.reservationId, messageId: null,
      messageType: 'email', recipient: null, sentAt: null, ...row,
    } as Omit<MessageLogSummary, 'id'>)
  } catch (e) {
    deps.logger.warn('approval-email: no se pudo registrar en message_logs', { reservationId: input.reservationId, error: (e as Error).message })
  }
}

/**
 * Dispara el email de aprobación/rechazo al huésped. Nunca tira.
 * - Evento desconocido o sin guestId / sin email → no encola (log 'skipped' cuando hay huésped sin email).
 * - Tenacy: si guest/room no pertenecen al hotel de la reserva, aborta.
 * Registra cada intento en message_logs (si el repo está cableado).
 */
export async function dispatchApprovalEmail(deps: ApprovalEmailDeps, input: RejectNotifyInput): Promise<void> {
  const { emailSender, guestRepo, roomRepo, hotelRepo, logger } = deps
  if (!EVENTS.has(input.event)) {
    logger.warn('approval-email: evento no soportado', { reservationId: input.reservationId, event: input.event })
    return
  }
  const event = input.event as ApprovalEmailEvent
  if (!input.guestId) {
    logger.info('approval-email: sin guestId', { reservationId: input.reservationId, event })
    return
  }

  try {
    const guest = await guestRepo.findById(input.guestId)
    if (guest?.hotelId && guest.hotelId !== input.hotelId) return // tenacy
    const room = input.roomId ? await roomRepo.findById(input.roomId) : null
    if (room?.hotelId && room.hotelId !== input.hotelId) return // tenacy
    const hotel = await hotelRepo.findById(input.hotelId)

    if (!guest?.email) {
      await log(deps, input, { response: `sin email, no se envió (${event})`, status: 'skipped' })
      return
    }

    const language = resolveGuestLanguage(guest ?? {})
    const variables: Record<string, string | number> = {
      guest_name: guest.name || guest.firstName || 'Huésped',
      hotel_name: hotel?.name || 'Hotel',
      hotel_phone: hotel?.phone ?? '',
      room_number: room?.number ?? '',
      checkin_date: input.checkIn,
      checkout_date: input.checkOut,
      logo_url: (hotel as { logo?: string } | null)?.logo ?? '',
      ...(input.variables ?? {}),
    }

    try {
      const queueId = await emailSender.enqueueNotification({
        to: guest.email, hotelId: input.hotelId, event, language, variables,
        relatedType: event, relatedId: input.reservationId,
      })
      await log(deps, input, { messageId: queueId || null, response: `notification:${event} [${language}]`, status: 'sent', recipient: guest.email, sentAt: new Date().toISOString() })
      logger.info('approval-email: encolado', { reservationId: input.reservationId, event, to: guest.email, queueId })
    } catch (e) {
      await log(deps, input, { response: (e as Error).message, status: 'failed', recipient: guest.email })
      logger.warn('approval-email: fallo al encolar', { reservationId: input.reservationId, event, error: (e as Error).message })
    }
  } catch (e) {
    // Un repo caído (guest/room/hotel) tampoco puede propagar: el que llama ya cerró su transacción.
    logger.warn('approval-email: fallo al resolver datos', { reservationId: input.reservationId, event, error: (e as Error).message })
  }
}

/** Puerto listo para `approve.ts` / `reject.ts` (`notifyGuest`): el service lo arma con `notifyDeps()`. */
export function approvalNotifier(deps: ApprovalEmailDeps): RejectNotifyPort {
  return (input) => dispatchApprovalEmail(deps, input)
}
