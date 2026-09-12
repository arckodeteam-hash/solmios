// reservas/usecases/reservation-email.ts — Encolar email transaccional al crear reserva.
// Puramente funcional: recibe dependencias del dominio, sin HTTP ni ORM directo.
// Verifica tenacy: solo usa datos de entidades que pertenecen al hotel de la reserva.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../../services/email-sender'
import { resolveGuestLanguage } from '../../../services/guest-language'
import type { NotificationLanguage } from '../../../services/notification-defaults'
import { confirmationVariableDefaults, confirmationFragments } from '../../../shared/usecases/confirmation-email-variables'
import { resolvePlatformIdentity, DEFAULT_PLATFORM_IDENTITY } from '../../../shared/utils/platform-identity'
import type { CreateReservasDTO } from '../types'
import type { GuestSummary, RoomSummary, HotelSummary } from './types'

interface ReservationEmailDeps {
  emailSender: EmailSender
  guestRepo: RepositoryAdapter<GuestSummary>
  roomRepo: RepositoryAdapter<RoomSummary>
  hotelRepo: RepositoryAdapter<HotelSummary>
  logger: Logger
  /** `Configuration` KV: de acá sale `{platform_name}` (Configuración → Plataforma). Sin él, el default. */
  configRepo?: Pick<RepositoryAdapter<any>, 'findOne'> | null
}

/**
 * Encola el email de confirmación/pre-venta según `dto.communicateClient`.
 * No-op si communicateClient no es un tipo de email, o si falta guestId/email del huésped,
 * o si el huésped/habitación no pertenece al hotel de la reserva (defensa IDOR).
 */
export async function enqueueReservationEmail(
  deps: ReservationEmailDeps,
  dto: CreateReservasDTO,
  item: { id: string; locator?: string },
): Promise<void> {
  const { emailSender, guestRepo, roomRepo, hotelRepo, logger } = deps
  const type = dto.communicateClient
  // Solo 'email_confirmation' y 'email_presaless' disparan envío. Cualquier otro valor (incl. typos/sms/whatsapp) → no-op.
  if ((type !== 'email_confirmation' && type !== 'email_presaless') || !dto.guestId) return

  const guest = await guestRepo.findById(dto.guestId)
  if (!guest?.email) return
  if (guest.hotelId && dto.hotelId && guest.hotelId !== dto.hotelId) return // tenacy

  const room = await roomRepo.findById(dto.roomId)
  if (room?.hotelId && dto.hotelId && room.hotelId !== dto.hotelId) return // tenacy

  const hotel = await hotelRepo.findById(dto.hotelId)
  const hotelName = hotel?.name || 'Hotel'

  const language = resolveGuestLanguage(guest) as NotificationLanguage
  // `{platform_name}` es el nombre que cargó el super-admin, no una marca fija: mismo origen que
  // el correo de pago del motor público.
  const platformName = deps.configRepo
    ? (await resolvePlatformIdentity(deps.configRepo)).platformName
    : DEFAULT_PLATFORM_IDENTITY.platformName
  // Variables de plantilla del spec 6.1.4. Las que este flujo no conoce (desglose, enlaces
  // públicos, huéspedes — #270) salen de la base neutra: el renderer dejaría el `{placeholder}`
  // literal en el correo si faltaran. Sin enlaces públicos ni recibo, los botones "Ver mi
  // reserva"/"Descargar recibo" y la mención al recibo no se emiten (fragmentos vacíos).
  const PAYMENT_LABELS: Record<string, string> = {
    transfer: 'Transferencia', card: 'Tarjeta', cash: 'Efectivo', link: 'Link de pago',
  }
  const total = Number(dto.totalAmount ?? 0)
  const deposit = Number(dto.deposit ?? 0)
  const pending = Math.max(0, total - deposit)
  const adults = Number(dto.adults ?? 0) || 0
  const children = Number(dto.children ?? 0) || 0
  const variables: Record<string, string | number> = {
    ...confirmationVariableDefaults(language, platformName),
    ...confirmationFragments(language, { adults, children, childrenAges: dto.childrenAges ?? [] }),
    guest_name: guest.name || guest.firstName || 'Huésped',
    hotel_name: hotelName,
    checkin_date: dto.checkIn,
    checkout_date: dto.checkOut,
    room_number: room?.number ?? '',
    room_type: room?.type ?? '',
    room_capacity: room?.maxGuests ?? '',
    room_base_price: room?.basePrice ? `$${room.basePrice}` : '',
    adults: adults ? String(adults) : '',
    children: children ? String(children) : '',
    children_ages: (dto.childrenAges ?? []).map((a) => String(a)).join(', '),
    total_amount: total ? `$${total}` : '',
    payment_method: PAYMENT_LABELS[dto.paymentMethod ?? ''] || dto.paymentMethod || '—',
    deposit_amount: deposit ? `$${deposit}` : '—',
    pending_amount: pending ? `$${pending}` : '—',
    wifi_network: '',
    wifi_password: '',
    lock_code: '',
    hotel_phone: hotel?.phone ?? '',
    locator: item.locator ?? '',
  }

  const event = type === 'email_confirmation' ? 'reservation_confirmed' : 'reservation_presale'

  await emailSender.enqueueNotification({
    to: guest.email, hotelId: dto.hotelId, event, language, variables,
    relatedType: 'reservation', relatedId: item.id,
  })
  logger.info('Email encolado', { to: guest.email, type, event, language, reservationId: item.id })
}
