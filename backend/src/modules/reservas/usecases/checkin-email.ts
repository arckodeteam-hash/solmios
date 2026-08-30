// reservas/usecases/checkin-email.ts — Email de bienvenida al hacer check-in (spec 11.1.1).
//
// Puramente funcional: recibe dependencias del dominio, sin HTTP ni ORM directo.
// Disparado desde el endpoint /api/reservas/:id/checkin Y desde service.update al
// pasar a status='checked_in' (dual path: el frontend hace check-in vía update).
// Si el huésped no tiene email (walk-in), no envía y lo registra como 'skipped'.
//
// message_logs usa el modelo del módulo marketing: messageType/status/recipient/response/sentAt.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../../services/email-sender'
import { resolveGuestLanguage } from '../../../services/guest-language'
import type { GuestSummary, RoomSummary, HotelSummary, MessageLogSummary } from './types'
import { effectiveCheckInTime, effectiveCheckOutTime } from '../../../shared/utils/hotel-schedule'

interface CheckinEmailDeps {
  emailSender: EmailSender
  guestRepo: RepositoryAdapter<GuestSummary>
  roomRepo: RepositoryAdapter<RoomSummary>
  hotelRepo: RepositoryAdapter<HotelSummary>
  messageLogRepo: RepositoryAdapter<MessageLogSummary>
  /** Códigos de acceso (TTLock) de la reserva — para llenar lock_code en el email. Opcional: sin él
   *  el campo queda vacío (comportamiento previo). Read-only, solo para armar el contenido. */
  lockCodeRepo?: RepositoryAdapter<{ reservationId?: string; hotelId?: string; code?: string; status?: string }>
  logger: Logger
}

interface CheckinEmailInput {
  reservationId: string
  hotelId: string
  guestId: string | null | undefined
  roomId: string | null | undefined
  checkIn: string
  checkOut: string
  /** Horario acordado con ESTE huésped ('HH:MM'). Vacío = manda el del hotel. Es lo que abre
   *  la cerradura, así que el correo tiene que decir esa hora y no la general. */
  checkInTime?: string | null
  checkOutTime?: string | null
}

/**
 * Dispara el email de bienvenida al check-in. No-op seguro si faltan dependencias.
 * - Huésped sin email → log 'skipped' (walk-in), no encola.
 * - Tenacy: si guest/room no pertenecen al hotel de la reserva, aborta (defensa IDOR).
 * Registra cada intento en message_logs (status sent/failed/skipped, spec 11.1.1).
 */
export async function sendCheckinEmail(deps: CheckinEmailDeps, input: CheckinEmailInput): Promise<{ status: 'sent' | 'skipped' | 'failed' }> {
  const { emailSender, guestRepo, roomRepo, hotelRepo, messageLogRepo, lockCodeRepo, logger } = deps
  if (!input.guestId) {
    logger.info('checkin-email: sin guestId', { reservationId: input.reservationId })
    return { status: 'skipped' }
  }

  const guest = await guestRepo.findById(input.guestId)
  if (guest?.hotelId && guest.hotelId !== input.hotelId) return { status: 'skipped' } // tenacy
  const room = input.roomId ? await roomRepo.findById(input.roomId) : null
  if (room?.hotelId && room.hotelId !== input.hotelId) return { status: 'skipped' } // tenacy
  const hotel = await hotelRepo.findById(input.hotelId)

  const guestName = guest?.name || guest?.firstName || 'Huésped'
  const language = resolveGuestLanguage(guest ?? {})

  // Walk-in sin email: no se envía, se loggea (spec 11.1.1).
  if (!guest?.email) {
    await messageLogRepo.create({
      hotelId: input.hotelId, reservationId: input.reservationId, messageId: null,
      messageType: 'email', response: `walk-in sin email, no se envió notificación (${guestName})`,
      status: 'skipped', recipient: null, sentAt: null,
    } as Omit<MessageLogSummary, 'id'>)
    logger.info('checkin-email: walk-in sin email', { reservationId: input.reservationId, guestId: input.guestId })
    return { status: 'skipped' }
  }

  // Código de acceso TTLock: se busca el código activo/pendiente de la reserva (LockCodes). Si el hotel
  // no usa cerraduras o aún no se generó, queda vacío (no rompe el email). Read-only para el contenido.
  let lockCode = ''
  if (lockCodeRepo) {
    const codes = await lockCodeRepo.findMany({ reservationId: input.reservationId }).catch(() => [])
    const active = codes.find((c) => c.status === 'active') ?? codes.find((c) => c.status === 'pending')
    if (active?.hotelId && active.hotelId !== input.hotelId) { /* tenacy: ignorar código de otro hotel */ }
    else lockCode = active?.code ?? ''
  }

  // Variables de plantilla 11.1.1. wifi viene del hotel (spec 11.1.4); logo del hotel (spec 11.1.5).
  // pre_checkin_url (F8) queda vacío — depende de fase externa a F11.
  const variables: Record<string, string | number> = {
    guest_name: guestName,
    hotel_name: hotel?.name || 'Hotel',
    hotel_address: hotel?.address ?? '',
    hotel_phone: hotel?.phone ?? '',
    room_number: room?.number ?? '',
    checkin_date: input.checkIn,
    checkout_date: input.checkOut,
    // Horario EFECTIVO: override de la reserva > horario del hotel > default del modelo.
    // Antes leía `hotel.checkInTime`, campo INEXISTENTE (el modelo es `hotel.checkIn`), así que
    // el correo anunciaba 14:00 aunque el hotel tuviera otro horario cargado (fix 2026-08-29).
    checkin_time: effectiveCheckInTime(input as any, hotel as any),
    checkout_time: effectiveCheckOutTime(input as any, hotel as any),
    wifi_network: (hotel as { wifiNetwork?: string } | null)?.wifiNetwork ?? '',
    wifi_password: (hotel as { wifiPassword?: string } | null)?.wifiPassword ?? '',
    logo_url: (hotel as { logo?: string } | null)?.logo ?? '',
    lock_code: lockCode,
    pre_checkin_url: '',
  }

  try {
    const queueId = await emailSender.enqueueNotification({
      to: guest.email, hotelId: input.hotelId, event: 'checkin_welcome', language, variables,
      relatedType: 'checkin', relatedId: input.reservationId,
    })
    // Trazabilidad: response = identificador del evento×idioma (no el subject crudo con placeholders — fix H3).
    await messageLogRepo.create({
      hotelId: input.hotelId, reservationId: input.reservationId, messageId: queueId || null,
      messageType: 'email', response: `notification:checkin_welcome [${language}]`,
      status: 'sent', recipient: guest.email, sentAt: new Date().toISOString(),
    } as Omit<MessageLogSummary, 'id'>)
    logger.info('checkin-email: encolado', { reservationId: input.reservationId, to: guest.email, queueId })
    return { status: 'sent' }
  } catch (e) {
    await messageLogRepo.create({
      hotelId: input.hotelId, reservationId: input.reservationId, messageId: null,
      messageType: 'email', response: (e as Error).message,
      status: 'failed', recipient: guest.email, sentAt: null,
    } as Omit<MessageLogSummary, 'id'>)
    logger.warn('checkin-email: fallo al encolar', { reservationId: input.reservationId, error: (e as Error).message })
    return { status: 'failed' }
  }
}
