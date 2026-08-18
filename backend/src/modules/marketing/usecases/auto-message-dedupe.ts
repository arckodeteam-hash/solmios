// marketing/usecases/auto-message-dedupe.ts — Dedupe mismo-día de auto-messages.
// Clave estable: response = `auto:{event}:{autoMessageId}` + sentAt de HOY. Por reserva
// (eventos de reserva) o por huésped (birthday/win-back, sin reserva).
import type { RepositoryAdapter } from 'arckode-framework'

export interface DedupeLog {
  response?: string | null
  status?: string | null
  sentAt?: string | null
}

export async function logsForDedupe(
  logRepo: Pick<RepositoryAdapter<any>, 'findMany'>,
  p: { hotelId: string; reservationId?: string; guestId?: string },
): Promise<DedupeLog[]> {
  if (p.reservationId) return logRepo.findMany({ hotelId: p.hotelId, reservationId: p.reservationId } as any)
  if (p.guestId) return logRepo.findMany({ hotelId: p.hotelId, guestId: p.guestId } as any)
  return []
}

export function alreadySentToday(logs: DedupeLog[], event: string, msgId: string, now = new Date()): boolean {
  const todayPrefix = now.toISOString().slice(0, 10)
  return logs.some((l) =>
    l.response === `auto:${event}:${msgId}`
    && ['sent', 'queued'].includes(String(l.status))
    && String(l.sentAt || '').slice(0, 10) === todayPrefix,
  )
}
