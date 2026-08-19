// reservas/usecases/lock-code-email.ts — Envío manual del código de cerradura por email.
//
// Disparado desde POST /api/reservas/:id/send-lock-code-email (botón "Enviar código por
// email" en ReservationModal del planning). Reusa sendCheckinEmail para NO duplicar la
// lógica de armado de variables, template, encolado y trazabilidad en message_logs: el
// email de bienvenida (checkin_welcome) ya incluye lock_code prominentemente, así que
// delegar en él envía exactamente el código al huésped sin reimplementar el pipeline.
//
// Valida explícitamente (HTTP 400) ANTES de delegar para dar mensajes claros:
//  - La reserva existe y pertenece al hotel del usuario (ownership → 404 si no).
//  - Hay al menos un código de cerradura generado (→ 400 si no).
//  - El huésped tiene email cargado (→ 400 si no).

import { NotFoundError, ValidationError, OrmRepository } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { sendCheckinEmail } from './checkin-email'

interface LockCodeRow { reservationId?: string; hotelId?: string; code?: string; status?: string }

interface LockCodeEmailDeps {
  orm: any
  reservationRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  /** Resolución fail-closed del hotel del usuario cuando el token no lo trae (R-5). */
  userRepo?: RepositoryAdapter<any>
  emailSender: any
  roomRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
  messageLogRepo: RepositoryAdapter<any> | null
  logger: Logger
}

interface CurrentUser { id: string; hotelId?: string; role?: string }

/**
 * Envía el código de cerradura al email del huésped. Delega el envío real en sendCheckinEmail
 * (mismo template + queue + message_logs) tras validar que haya código y email.
 * Lanza ValidationError (400) si falta el email o el código; NotFoundError (404) si la reserva
 * no existe o es de otro hotel.
 */
export async function sendLockCodeEmail(deps: LockCodeEmailDeps, reservationId: string, currentUser: CurrentUser): Promise<{ sentTo: string }> {
  const { orm, reservationRepo, guestRepo, emailSender, roomRepo, hotelRepo, logger } = deps
  const lockCodeRepo = new OrmRepository<LockCodeRow>(orm, 'LockCodes')
  const messageLogRepo = deps.messageLogRepo ?? new OrmRepository<any>(orm, 'MessageLogs')

  // 1. Reserva + ownership FAIL-CLOSED (R-5, auditoría 2026-08-19). Antes:
  // `if (currentUser.hotelId && r.hotelId !== ...)` — un token SIN hotelId pasaba sin
  // NINGÚN check y podía disparar el email de cualquier hotel. Mismo patrón que
  // crud.listReservations: si el token no trae hotel, se resuelve vía userRepo; sin hotel
  // resuelto → rechazar. super_admin (plataforma) sigue pasando.
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

  // 2. Código de cerradura: al menos uno generado (validación temprana → 400 claro).
  const codes = await lockCodeRepo.findMany({ reservationId }).catch(() => [] as LockCodeRow[])
  if (!codes.length) throw new ValidationError('La reserva no tiene códigos de cerradura generados')

  // 3. Email del huésped: obligatorio para enviar.
  if (!r.guestId) throw new ValidationError('El huésped no tiene email cargado')
  const guest = await guestRepo.findById(r.guestId)
  if (!guest?.email) throw new ValidationError('El huésped no tiene email cargado')

  // 4. Delegar en checkin-email: reusa el template (incluye lock_code) + queue + message_logs.
  //    sendCheckinEmail vuelve a buscar el lockCode activo/pendiente vía lockCodeRepo y arma
  //    las variables del email — no se duplica esa lógica.
  const result = await sendCheckinEmail(
    { emailSender, guestRepo, roomRepo, hotelRepo, messageLogRepo, lockCodeRepo, logger },
    { reservationId: r.id, hotelId: r.hotelId, guestId: r.guestId, roomId: r.roomId, checkIn: r.checkIn, checkOut: r.checkOut },
  )
  if (result.status === 'failed') throw new Error('No se pudo encolar el email. Intentá de nuevo.')
  // 'skipped' no debería ocurrir tras la validación de email de arriba, pero se defiende:
  if (result.status === 'skipped') throw new ValidationError('No se pudo enviar el email: falta email del huésped')

  logger.info('lock-code-email enviado', { reservationId, to: guest.email })
  return { sentTo: guest.email }
}
