// reservas/usecases/reservation-notifications.ts — Dispatch de emails transaccionales de reserva.
// Extrae los side-effects de email del service para mantenerlo <200 líneas (gate arckode: no God Object).
// Envuelve los usecases de dominio (reservation-email) ensamblando las dependencias.
// NOTA: dispatchCheckinEmail fue removido (12.8.1). El email de check-in SOLO se envía
// desde POST /api/reservas/:id/checkin, no desde el update genérico.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { EmailSender } from '../../../services/email-sender'
import { enqueueReservationEmail } from './reservation-email'
import type { CreateReservasDTO, UpdateReservasDTO, ReservasDTO } from '../types'
import type { GuestSummary, RoomSummary, HotelSummary, MessageLogSummary } from './types'

export interface NotifyDeps {
  emailSender: EmailSender
  messageLogRepo: RepositoryAdapter<MessageLogSummary> | null
  guestRepo: RepositoryAdapter<GuestSummary>
  roomRepo: RepositoryAdapter<RoomSummary>
  hotelRepo: RepositoryAdapter<HotelSummary>
  logger: Logger
  /** `Configuration` KV para `{platform_name}` (#270). Opcional: sin él, el default. */
  configRepo?: Pick<RepositoryAdapter<any>, 'findOne'> | null
}

/** Email de confirmación/pre-venta al crear reserva (spec 6.1.4). Fire-and-forget. */
export function dispatchCreateEmail(deps: NotifyDeps, dto: CreateReservasDTO, item: ReservasDTO): void {
  enqueueReservationEmail(
    { emailSender: deps.emailSender, guestRepo: deps.guestRepo, roomRepo: deps.roomRepo, hotelRepo: deps.hotelRepo, logger: deps.logger, configRepo: deps.configRepo ?? null },
    dto, item,
  ).catch((e) => deps.logger.warn('Error encolando email de reserva', { error: (e as Error).message }))
}
