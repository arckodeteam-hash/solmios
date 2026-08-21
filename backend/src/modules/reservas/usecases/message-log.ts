// reservas/usecases/message-log.ts — Traza de un envío MANUAL al huésped (WhatsApp/SMS/email)
// y proyección segura de `message_logs` hacia el detalle de la reserva.
//
// Regresión (bug 2026-08-19): las plantillas de WhatsApp del modal de reserva abrían `wa.me`
// y no dejaban rastro: "Historial de Envíos" (`message_logs`) solo veía los auto-messages, así
// que nadie podía saber qué se le mandó al huésped desde el mostrador.
//
// El envío es MANUAL (se abre WhatsApp en el navegador del staff): el sistema no puede
// confirmar la entrega. Por eso el log se asienta con `status:'queued'` — "preparado y abierto",
// NO 'sent'. Inventar 'sent' sería mentirle al historial.
//
// La tabla `message_logs` es del módulo marketing, pero reservas ya escribe en ella por los
// mismos motivos (checkin-email, lifecycle-email, lock-code-email) con el mismo repo inyectado.

import type { RepositoryAdapter, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import { assertReservationOwned, type SimpleUser } from './reservation-ownership'
import { MANUAL_MESSAGE_TYPES, MANUAL_MESSAGE_STATUS } from '../validators/schema'

export type ManualMessageType = (typeof MANUAL_MESSAGE_TYPES)[number]
export type ManualMessageStatus = (typeof MANUAL_MESSAGE_STATUS)[number]

export interface LogManualMessageDTO {
  messageType?: string
  recipient?: string
  /** Referencia de qué se mandó (id/título de la plantilla). NO el cuerpo completo. */
  reference?: string
  status?: string
}

export interface LogManualMessageDeps {
  /** Repo de `MessageLogs`. OBLIGATORIO: sin él no hay traza y el endpoint no tiene sentido. */
  messageLogRepo: RepositoryAdapter<any>
  reservationRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  auth: Auth
}

/**
 * Marca del rastro manual dentro de `message_logs.response`.
 *
 * Se guarda como JSON, NO como `manual:tipo:ref:by:userId`: con separadores por concatenación,
 * un `reference` de texto libre ("x:by:otro-user-id") reescribía el autor del envío y el historial
 * atribuía el mensaje a otra persona. En JSON el `reference` es un valor, no puede inventar campos.
 */
interface ManualTrace {
  kind: 'manual'
  reference: string
  byUserId: string
}

function parseTrace(response: unknown): ManualTrace | null {
  if (typeof response !== 'string' || !response.startsWith('{')) return null
  try {
    const parsed = JSON.parse(response) as Partial<ManualTrace>
    if (parsed?.kind !== 'manual') return null
    return { kind: 'manual', reference: String(parsed.reference ?? ''), byUserId: String(parsed.byUserId ?? '') }
  } catch {
    return null
  }
}

/** Lo que el detalle de la reserva puede mostrar de un `message_log`. */
export interface MessageLogView {
  id: string
  messageType: string
  status: string | null
  recipient: string | null
  sentAt: string | null
  /** Plantilla/motivo del envío. Sólo existe en los envíos manuales. */
  reference: string | null
  /** Quién lo mandó desde el panel (`users.id`). Sólo en envíos manuales. */
  sentByUserId: string | null
  manual: boolean
}

/**
 * Proyección segura de una fila de `message_logs`.
 *
 * `response` NO se expone: en los auto-messages guarda el mensaje de error crudo del transporte
 * de email (`checkin-email.ts`, `lifecycle-email.ts`), un dato de infraestructura que hasta ahora
 * sólo se veía con `settings:view` en el módulo marketing. El detalle de la reserva se sirve con
 * `reservations:view`, así que devolver la fila cruda ampliaba quién puede leerlo.
 */
export function toMessageLogView(row: Record<string, any>): MessageLogView {
  const trace = parseTrace(row?.response)
  return {
    id: String(row?.id ?? ''),
    messageType: String(row?.messageType ?? ''),
    status: row?.status ?? null,
    recipient: row?.recipient ?? null,
    sentAt: row?.sentAt ?? row?.createdAt ?? null,
    reference: trace?.reference || null,
    sentByUserId: trace?.byUserId || null,
    manual: !!trace,
  }
}

/**
 * Puerto hacia el módulo `marketing`, dueño de `message_logs` (`marketing/model.ts`).
 *
 * STR-3: reservas leía la tabla con `orm.findMany('MessageLogs', ...)` directo, reimplementando
 * `MarketingService.listMessageLogs` y salteando el connector `reservas-marketing` que ya está
 * cableado en `composition-root.ts`. Regla del proyecto: nunca acceso directo a otro módulo — va
 * por conector. La implementación real la inyecta `connectors/reservas-marketing.ts`.
 */
export type MessageLogSource = (hotelId: string, reservationId: string) => Promise<Record<string, any>[]>

/**
 * Devuelve el puerto o uno que RECHAZA. Sin el connector `reservas-marketing` el historial no se
 * puede leer: devolver `[]` sería un "no se le escribió nunca" falso. Falla fuerte y visible.
 */
export function requireMessageLogSource(port: MessageLogSource | undefined): MessageLogSource {
  if (port) return port
  return () => Promise.reject(new Error('reservas: puerto listMessageLogs sin cablear (connector reservas-marketing)'))
}

/** Proyección + orden (más reciente primero) de las filas que devuelve el puerto. */
export function toMessageLogViews(rows: readonly Record<string, any>[] | null | undefined): MessageLogView[] {
  if (!rows?.length) return []
  return [...rows]
    .sort((a, b) => String(b?.sentAt || b?.createdAt || '').localeCompare(String(a?.sentAt || a?.createdAt || '')))
    .map(toMessageLogView)
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (value === undefined || value === null || value === '') return fallback
  if (!allowed.includes(value as T)) throw new ValidationError(`${field} inválido: ${String(value)}`)
  return value as T
}

/** Asienta la traza de un envío manual. Devuelve la vista segura del registro creado. */
export async function logManualMessage(
  deps: LogManualMessageDeps,
  reservationId: string,
  dto: LogManualMessageDTO,
  user: SimpleUser,
): Promise<MessageLogView> {
  const { messageLogRepo, reservationRepo, userRepo, auth } = deps
  const res = await assertReservationOwned(reservationRepo, userRepo, auth, reservationId, user) // IDOR: mismo patrón que addons

  const messageType = pickEnum(dto.messageType, MANUAL_MESSAGE_TYPES, 'whatsapp', 'messageType')
  const status = pickEnum(dto.status, MANUAL_MESSAGE_STATUS, 'queued', 'status')
  const trace: ManualTrace = {
    kind: 'manual',
    reference: dto.reference || 'libre',
    byUserId: String(user?.id ?? ''),
  }

  const created = await messageLogRepo.create({
    hotelId: res.hotelId,
    reservationId,
    guestId: res.guestId || null,
    messageType,
    status,
    recipient: dto.recipient || null,
    // Quién y con qué plantilla: el historial tiene que poder responder "¿quién le escribió?".
    response: JSON.stringify(trace),
    sentAt: new Date().toISOString(),
  })
  return toMessageLogView(created as Record<string, any>)
}
