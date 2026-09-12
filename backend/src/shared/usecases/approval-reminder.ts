// shared/usecases/approval-reminder.ts — Recordatorio al hotel de reservas pagadas sin aprobar (#271 MR-06).
//
// Con aprobación manual, una reserva web queda `approvalStatus: 'pending'` después de que el
// huésped PAGÓ, esperando que alguien del hotel la apruebe o rechace. Si nadie mira el panel, el
// huésped se queda sin respuesta. Este barrido (puro, puertos inyectados) detecta las que llevan
// más horas pendientes que el plazo del hotel (`booking_config.approvalDeadlineHours`, default 24)
// y avisa por las vías del hotel (campanita, correo al buzón, push — `notifyApprovalOverdue`).
//
// NO auto-aprueba ni auto-rechaza: la decisión sigue siendo del hotel. Sólo avisa, UNA sola vez
// por reserva: `reservations.approvalReminderAt` es el marcador de dedup y se escribe únicamente
// después de que el aviso salió sin tirar (si el aviso falla, queda sin marcar y se reintenta en la
// próxima corrida).
//
// Grupos (`groupId`): el aviso al hotel ya resume el grupo entero ("hab. ×N"), así que se avisa una
// sola vez por grupo por corrida (la hermana pendiente más antigua) y se marca `approvalReminderAt`
// en TODAS las hermanas pendientes, para que ninguna vuelva a disparar.

import type { Logger } from 'arckode-framework'

type Row = Record<string, any>

/**
 * Mismo valor que `DEFAULT_APPROVAL_DEADLINE_HOURS` en modules/bookingengine/usecases/config.ts.
 * Duplicado a propósito: shared/ no importa desde un módulo.
 */
export const DEFAULT_APPROVAL_DEADLINE_HOURS = 24

export interface ApprovalReminderNotifyInput {
  deadlineHours: number
  pendingSince: string
}

export interface ApprovalReminderDeps {
  reservations: {
    findMany(q: Record<string, unknown>): Promise<any[]>
    update(id: string, data: Record<string, unknown>): Promise<unknown>
  }
  bookingConfig: { findMany(q: Record<string, unknown>): Promise<any[]> }
  /** `notifyApprovalOverdue` ya cableado con sus deps (composition-root). */
  notify: (ref: { id: string; hotelId: string }, input: ApprovalReminderNotifyInput) => Promise<unknown>
  logger: Logger
}

export interface ApprovalReminderResult {
  scanned: number
  reminded: number
  skipped: number
  errors: Array<{ reservationId: string; reason: string }>
}

const HOUR_MS = 3_600_000
const ms = (v: unknown): number => (v ? new Date(v as string).getTime() : NaN)
const errMessage = (e: unknown): string => (e as Error)?.message ?? String(e)

/** Plazo del hotel en horas: fila `booking_config` del hotel o el default. Cacheado por corrida. */
async function deadlineHoursFor(deps: ApprovalReminderDeps, cache: Map<string, number>, hotelId: string): Promise<number> {
  const cached = cache.get(hotelId)
  if (cached !== undefined) return cached
  const rows = (await deps.bookingConfig.findMany({ hotelId })) as Row[]
  const raw = Number(rows[0]?.approvalDeadlineHours)
  const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_APPROVAL_DEADLINE_HOURS
  cache.set(hotelId, hours)
  return hours
}

/** Candidata = pendiente de aprobación, viva y sin recordatorio previo. */
const isCandidate = (r: Row): boolean =>
  r.approvalStatus === 'pending' && r.status !== 'cancelled' && !r.approvalReminderAt

/**
 * Barrido: una pasada por todas las `approvalStatus: 'pending'`. Nunca tira: un error por reserva
 * va a `errors` y se sigue con la siguiente.
 */
export async function runApprovalReminder(
  deps: ApprovalReminderDeps,
  now: Date = new Date(),
): Promise<ApprovalReminderResult> {
  const result: ApprovalReminderResult = { scanned: 0, reminded: 0, skipped: 0, errors: [] }
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const deadlineCache = new Map<string, number>()

  const candidates = ((await deps.reservations.findMany({ approvalStatus: 'pending' })) as Row[]).filter(isCandidate)
  result.scanned = candidates.length

  // Grupo → hermanas pendientes (todas las de la corrida), para avisar una vez y marcar a todas.
  const groups = new Map<string, Row[]>()
  for (const r of candidates) {
    if (!r.groupId) continue
    const key = `${r.hotelId}:${r.groupId}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const seenGroups = new Set<string>()

  for (const r of candidates) {
    // Id que se reporta en `errors`: en grupo es la representante (`oldest`, la que se pasa a
    // `notify`), no la hermana que tocó iterar — si no, el log manda a mirar la reserva equivocada.
    let reportedId = String(r.id)
    try {
      const groupKey = r.groupId ? `${r.hotelId}:${r.groupId}` : null
      if (groupKey && seenGroups.has(groupKey)) continue // ya contabilizada con la hermana más antigua

      // En grupo, la más antigua decide (la que primero venció) y representa al aviso.
      const batch = groupKey ? groups.get(groupKey) ?? [r] : [r]
      const oldest = batch.reduce((a, b) => (ms(b.createdAt) < ms(a.createdAt) ? b : a), batch[0])
      if (groupKey) seenGroups.add(groupKey)
      reportedId = String(oldest.id)

      const pendingSinceMs = ms(oldest.createdAt)
      if (!Number.isFinite(pendingSinceMs)) {
        result.skipped += batch.length
        result.errors.push({ reservationId: String(oldest.id), reason: 'createdAt inválido' })
        continue
      }
      const deadlineHours = await deadlineHoursFor(deps, deadlineCache, String(oldest.hotelId))
      if (nowMs - pendingSinceMs < deadlineHours * HOUR_MS) {
        result.skipped += batch.length
        continue
      }

      const pendingSince = new Date(pendingSinceMs).toISOString()
      // Si el aviso tira, NO se marca: se reintenta en la próxima corrida.
      await deps.notify({ id: String(oldest.id), hotelId: String(oldest.hotelId) }, { deadlineHours, pendingSince })
      result.reminded++

      for (const item of batch) {
        const itemId = String(item.id)
        try {
          await deps.reservations.update(itemId, { approvalReminderAt: nowIso })
        } catch (e) {
          result.errors.push({ reservationId: itemId, reason: `no se pudo marcar approvalReminderAt: ${errMessage(e)}` })
        }
      }
    } catch (e) {
      result.errors.push({ reservationId: reportedId, reason: errMessage(e) })
    }
  }

  deps.logger.info(`approval-reminder: recordadas: ${result.reminded}`, { ...result })
  return result
}
