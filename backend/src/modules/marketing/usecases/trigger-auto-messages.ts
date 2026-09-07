// marketing/usecases/trigger-auto-messages.ts — Dispara los auto-mensajes de un evento.
//
// Vive fuera del service porque es, con diferencia, la pieza más larga del módulo: resolución de
// variables, deduplicación por día y encolado, todo en una sola pasada. Con esto adentro, el service
// pasaba el límite de tamaño del analyzer y cualquier agregado quedaba bloqueado.
// El comportamiento es EL MISMO: se movió tal cual, sin cambiar la lógica.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { logsForDedupe, alreadySentToday } from './auto-message-dedupe'
import type { AutoMessageDTO, MessageLogDTO, CreateMessageLogDTO } from '../types'
import type { NotificationEvent, NotificationLanguage } from '../../../services/notification-defaults'
import type { TriggerDeps } from '../service'
import type { MarketingSockets } from '../sockets'

/** Todo lo que el trigger necesita del service, explícito. */
export interface TriggerContext {
  triggerDeps?: TriggerDeps
  autoMsgRepo: RepositoryAdapter<AutoMessageDTO>
  logRepo: RepositoryAdapter<MessageLogDTO>
  logger: Logger
  sockets: MarketingSockets
  createMessageLog(dto: CreateMessageLogDTO): Promise<MessageLogDTO>
}

/**
 * Dispara auto-messages activos para un evento dado.
 * Resuelve variables desde la reserva/huésped/hotel y encola emails via EmailSender.
 */
export async function triggerAutoMessages(
deps: TriggerContext,
params: {
  hotelId: string
  event: string
  /** Triggers de huésped (birthday/win-back) no tienen reserva: deduplican por guestId. */
  reservationId?: string
  guestId?: string
  roomId?: string
  variables?: Record<string, string | number>
},
): Promise<void> {
  if (!deps.triggerDeps?.emailSender) {
    deps.logger.warn('triggerAutoMessages: emailSender no configurado')
    return
  }

  const { hotelId, event, reservationId, guestId, roomId, variables: extraVars } = params

  // Buscar auto-messages activos para este evento
  const allMsgs = await deps.autoMsgRepo.findMany({ hotelId, isActive: 1 } as any)
  const matching = allMsgs.filter(m => m.triggerEvent === event)
  if (matching.length === 0) return

  // Resolver variables del contexto
  const guest = guestId ? await deps.triggerDeps.guestRepo.findById(guestId) : null
  const room = roomId ? await deps.triggerDeps.roomRepo.findById(roomId) : null
  const hotel = await deps.triggerDeps.hotelRepo.findById(hotelId)

  const baseVars: Record<string, string | number> = {
    guest_name: guest?.name || guest?.firstName || 'Huésped',
    hotel_name: hotel?.name || 'Hotel',
    hotel_phone: hotel?.phone || '',
    hotel_address: hotel?.address || '',
    room_number: room?.number || '',
    room_type: room?.type || '',
    logo_url: (hotel as any)?.logo || '',
    ...extraVars,
  }

  // Dedup (spec 11.3.1): el cron corre cada 1h y la condición (checkIn=today AND status=confirmed)
  // se mantiene hasta el check-in real, así que sin este corte cada tick duplicaría el email.
  // message_logs no guarda templateId/channel/metadata (solo response/sentAt/status), por eso
  // usamos `response` como clave de dedup estable: `auto:{event}:{autoMessageId}`.
  // Dedupe mismo-día (usecases/auto-message-dedupe): por reserva o, sin reserva,
  // por huésped (birthday/win-back). Clave: response = `auto:{event}:{msgId}` + sentAt hoy.
  const sentLogs = await logsForDedupe(deps.logRepo, { hotelId, reservationId, guestId })
  const already = (msgId: string) => alreadySentToday(sentLogs as any[], event, msgId)

  for (const msg of matching) {
    try {
      if (already(msg.id || '')) {
        deps.logger.info('Auto-message dedup: ya enviado hoy', { hotelId, event, reservationId, autoMessageId: msg.id })
        continue
      }
      const language = (msg.language || 'es') as any
      const templateEvent = msg.event || 'checkin_welcome'

      const queueId = await deps.triggerDeps.emailSender.enqueueNotification({
        to: guest?.email || '',
        hotelId,
        event: templateEvent as NotificationEvent,
        language: language as NotificationLanguage,
        variables: baseVars,
        relatedType: 'auto_message',
        relatedId: msg.id,
      })

      // Log del envío. response = clave de dedup (event×autoMessage) — persiste en message_logs.
      await deps.createMessageLog({
        hotelId,
        reservationId: reservationId || null,
        guestId: guestId || null,
        messageType: 'email',
        status: queueId ? 'sent' : 'failed',
        recipient: guest?.email || null,
        response: `auto:${event}:${msg.id || ''}`,
        sentAt: new Date().toISOString(),
      } as any)

      deps.logger.info('Auto-message encolado', { hotelId, event, guest: guest?.email, queueId })
    } catch (e) {
      deps.logger.warn('Error en auto-message', { hotelId, event, error: (e as Error).message })
    }
  }
}

