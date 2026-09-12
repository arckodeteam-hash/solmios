// reservas/usecases/checkin-link-email.ts — Envío manual del enlace de check-in digital por email (#336).
//
// Disparado desde POST /api/reservas/:id/send-checkin-link-email (botón "Enviar por correo" de la
// tarjeta "Check-in digital" del ReservationModal). Manda al huésped el MISMO enlace que muestra el
// panel (`PUBLIC_URL/checkin/:hash`, hash de shared/utils/checkin-hash.ts — la misma derivación que
// usa auto-messages-cron.ts para `pre_checkin_url`) con el evento `checkin_link` de
// services/notification-defaults.ts, y deja traza en message_logs (sent/failed).
//
// La traza va con el JSON `{kind:'manual', reference, byUserId}` de usecases/message-log.ts
// (`parseTrace`): así el "Historial de Envíos" del modal lo muestra como envío manual con su
// referencia ("email · Enlace de check-in digital") y quién lo mandó.
//
// Valida explícitamente ANTES de encolar para dar mensajes claros:
//  - La reserva existe y pertenece al hotel del usuario (ownership fail-closed → 404 si no).
//  - PUBLIC_URL configurada (sin ella no hay enlace que mandar → 400).
//  - El huésped existe, es del hotel y tiene email cargado (→ 400 si no).

import { NotFoundError, ValidationError } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../../services/email-sender'
import { resolveGuestLanguage } from '../../../services/guest-language'
import { checkinHashFromId } from '../../../shared/utils/checkin-hash'
import type { GuestSummary, HotelSummary, MessageLogSummary } from './types'

interface CheckinLinkEmailDeps {
  reservationRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<GuestSummary>
  /** Resolución fail-closed del hotel del usuario cuando el token no lo trae (R-5). */
  userRepo?: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<HotelSummary>
  emailSender: EmailSender
  messageLogRepo: RepositoryAdapter<MessageLogSummary>
  /** `PUBLIC_URL` del servidor (con o sin barra final). Vacía → no se puede armar el enlace. */
  publicUrl: string
  logger: Logger
}

interface CurrentUser { id: string; hotelId?: string; role?: string }

/** Referencia que ve el historial del modal ("email · Enlace de check-in digital"). */
export const CHECKIN_LINK_REFERENCE = 'Enlace de check-in digital'

/** Mismo enlace que el panel muestra en la tarjeta "Check-in digital" (`/checkin/:hash`). */
export function checkinLinkUrl(publicUrl: string, reservationId: string): string {
  return `${publicUrl.replace(/\/$/, '')}/checkin/${checkinHashFromId(reservationId)}`
}

/**
 * Envía al email del huésped el enlace del formulario de check-in digital de la reserva.
 * Lanza NotFoundError (404) si la reserva no existe o es de otro hotel; ValidationError (400) si
 * falta PUBLIC_URL o el huésped no tiene email; Error genérico si el encolado falla (queda 'failed'
 * en message_logs).
 */
export async function sendCheckinLinkEmail(deps: CheckinLinkEmailDeps, reservationId: string, currentUser: CurrentUser): Promise<{ sentTo: string; checkinUrl: string }> {
  const { reservationRepo, guestRepo, hotelRepo, emailSender, messageLogRepo, publicUrl, logger } = deps

  // 1. Reserva + ownership FAIL-CLOSED (R-5, auditoría 2026-08-19). Mismo patrón que
  // lock-code-email / crud.listReservations: si el token no trae hotel, se resuelve vía userRepo;
  // sin hotel resuelto → rechazar. super_admin (plataforma) sigue pasando.
  const r = await reservationRepo.findById(reservationId)
  if (!r) throw new NotFoundError('Reserva no encontrada')
  if (currentUser.role !== 'super_admin') {
    let hotelId = currentUser.hotelId
    if (!hotelId && deps.userRepo && currentUser.id) {
      const me = await deps.userRepo.findById(currentUser.id) as any
      hotelId = me?.hotelId
    }
    if (!hotelId || r.hotelId !== hotelId) throw new NotFoundError('Reserva no encontrada')
  }

  // 2. Sin URL pública no hay enlace que mandar: mejor un 400 claro que un email con "/checkin/xxx".
  if (!publicUrl) throw new ValidationError('Falta configurar PUBLIC_URL: no se puede armar el enlace de check-in')

  // 3. Huésped con email (tenacy como checkin-email: un guest de otro hotel se trata como inexistente).
  if (!r.guestId) throw new ValidationError('El huésped no tiene email cargado')
  const found = await guestRepo.findById(r.guestId)
  const guest = found?.hotelId && found.hotelId !== r.hotelId ? null : found
  if (!guest?.email) throw new ValidationError('El huésped no tiene email cargado')

  const hotel = await hotelRepo.findById(r.hotelId)
  const checkinUrl = checkinLinkUrl(publicUrl, r.id)
  const locator = r.externalLocator || String(r.id).slice(-8)
  const language = resolveGuestLanguage(guest)
  const variables: Record<string, string | number> = {
    guest_name: guest.name || guest.firstName || 'Huésped',
    hotel_name: hotel?.name || 'Hotel',
    hotel_phone: hotel?.phone ?? '',
    locator,
    checkin_date: r.checkIn,
    checkout_date: r.checkOut,
    checkin_url: checkinUrl,
  }

  // Traza manual (formato de usecases/message-log.ts → toMessageLogView: reference/sentByUserId).
  const trace = { kind: 'manual' as const, reference: CHECKIN_LINK_REFERENCE, byUserId: String(currentUser.id ?? '') }
  const logBase = { hotelId: r.hotelId, reservationId: r.id, guestId: r.guestId, messageType: 'email', recipient: guest.email }

  // Sólo el encolado va dentro del try: si el email YA se encoló y falla el asiento de la traza,
  // no se puede registrar 'failed' (sería mentirle al historial).
  let queueId: string
  try {
    queueId = await emailSender.enqueueNotification({
      to: guest.email, hotelId: r.hotelId, event: 'checkin_link', language, variables,
      relatedType: 'checkin_link', relatedId: r.id,
    })
  } catch (e) {
    await messageLogRepo.create({
      ...logBase, messageId: null, response: JSON.stringify({ ...trace, error: (e as Error).message }),
      status: 'failed', sentAt: null,
    } as Omit<MessageLogSummary, 'id'>)
    logger.warn('checkin-link-email: fallo al encolar', { reservationId: r.id, error: (e as Error).message })
    throw new Error('No se pudo encolar el email. Intentá de nuevo.')
  }

  await messageLogRepo.create({
    ...logBase, messageId: queueId || null, response: JSON.stringify(trace),
    status: 'sent', sentAt: new Date().toISOString(),
  } as Omit<MessageLogSummary, 'id'>)
  logger.info('checkin-link-email: encolado', { reservationId: r.id, to: guest.email, queueId })
  return { sentTo: guest.email, checkinUrl }
}
