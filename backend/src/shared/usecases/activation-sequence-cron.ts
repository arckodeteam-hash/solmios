// shared/usecases/activation-sequence-cron.ts — Secuencia de activación por comportamiento
// (REQ-PIPE-08, #149) y rescate de trial vencido + perdido automático (REQ-PIPE-09, #150).
//
// Molde: trial-reminder-cron.ts. Corre una vez al día sobre el pipeline de ventas que ya calcula
// `sales-leads.getPipeline()` (etapa, señales, días de trial, último contacto humano) — no
// recalcula nada: la regla que decide "qué le mando hoy a este hotel" lee la misma fila que ve
// ventas en /admin/leads-ventas. Lo único que persiste es el dedup en
// `sales_prospects.sequenceSent` (`{ [evento]: fechaISO }`) y, a +14 días sin señales de vida,
// `lostAt`/`lostReason='no_response'`.
//
// Reglas que no conviene romper:
// - MÁXIMO UN correo por hotel por corrida: primera regla que aplique, en el orden de la tabla.
// - `contactedAt` en los últimos 2 días ⇒ silencio. Hay una persona hablando con ese hotel y un
//   correo automático encima la desautoriza.
// - Un rescate cuenta como enviado solo si salió DESPUÉS del vencimiento vigente: extender el
//   trial mueve `trialEndsAt` al futuro, con lo que los `trial_rescue_*` viejos quedan por debajo
//   y la secuencia arranca de cero sin que `extend-trial` tenga que conocer esta tabla.
// - Perdido automático solo cuando no hay NADA: ni actividad en el producto ni contacto humano
//   desde que venció. Con cualquiera de las dos, sigue en `expired` y lo decide una persona.
import { platformEmailVariables, resolvePlatformIdentity } from '../utils/platform-identity'

const DAY_MS = 24 * 60 * 60 * 1000
/** Ventana de silencio tras un contacto humano. */
export const CONTACT_QUIET_DAYS = 2
/** Umbrales del rescate (días desde el vencimiento). */
export const RESCUE_1_DAYS = 2
export const RESCUE_2_DAYS = 7
export const AUTO_LOST_DAYS = 14

export type ActivationEvent =
  | 'activation_no_rooms' | 'activation_no_rates' | 'activation_no_channel' | 'trial_offer'
  | 'trial_rescue_1' | 'trial_rescue_2'

/** Lo que el cron necesita de cada fila del pipeline (subset de `SalesPipelineRow`, copiado, no importado). */
export interface SequenceRow {
  hotelId: string | null
  hotelName: string | null
  email: string | null
  stage: string
  subscriptionStatus: string | null
  trialEndsAt: string | null
  daysLeft: number | null
  registeredAt: string | null
  contactedAt: string | null
  lostAt: string | null
  signals: { rooms: number; rates: number; channels: number; reservations: number; lastActivityAt: string | null } | null
}

export interface ActivationSequenceResult {
  sent: Partial<Record<ActivationEvent, number>>
  lost: number
  skipped: number
}

const daysBetween = (fromIso: string | null | undefined, now: Date): number | null => {
  if (!fromIso) return null
  const t = Date.parse(fromIso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / DAY_MS)
}

const parseSent = (raw: unknown): Record<string, string> => {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, string> } catch { return {} }
  }
  return raw && typeof raw === 'object' ? { ...(raw as Record<string, string>) } : {}
}

/** Regla de activación que aplica hoy (la primera de la tabla del issue), o null. */
export function activationEventFor(row: SequenceRow, now: Date): ActivationEvent | null {
  const s = row.signals
  if (!s) return null
  const daysSince = daysBetween(row.registeredAt, now) ?? 0
  if (daysSince >= 1 && s.rooms === 0) return 'activation_no_rooms'
  if (s.rooms > 0 && s.rates === 0 && daysSince >= 2) return 'activation_no_rates'
  if (s.rates > 0 && s.channels === 0 && daysSince >= 3) return 'activation_no_channel'
  if (row.stage === 'activated' && row.daysLeft !== null && row.daysLeft <= 3) return 'trial_offer'
  return null
}

/** Un rescate vale solo si salió después del vencimiento vigente (extender el trial lo reinicia). */
export function rescueAlreadySent(sent: Record<string, string>, event: ActivationEvent, trialEndsAt: string | null): boolean {
  const at = sent[event]
  if (!at) return false
  const sentMs = Date.parse(at)
  const endMs = trialEndsAt ? Date.parse(trialEndsAt) : NaN
  if (Number.isNaN(sentMs) || Number.isNaN(endMs)) return true
  return sentMs >= endMs
}

/** Rescate que toca hoy (+2 → rescue_1, +7 → rescue_2), o null. */
export function rescueEventFor(row: SequenceRow, sent: Record<string, string>, now: Date): ActivationEvent | null {
  const daysExpired = daysBetween(row.trialEndsAt, now)
  if (daysExpired === null) return null
  if (daysExpired >= RESCUE_1_DAYS && !rescueAlreadySent(sent, 'trial_rescue_1', row.trialEndsAt)) return 'trial_rescue_1'
  if (daysExpired >= RESCUE_2_DAYS && !rescueAlreadySent(sent, 'trial_rescue_2', row.trialEndsAt)) return 'trial_rescue_2'
  return null
}

/** +14 días vencido sin actividad en el producto ni contacto humano desde el vencimiento. */
export function shouldAutoLose(row: SequenceRow, now: Date): boolean {
  const daysExpired = daysBetween(row.trialEndsAt, now)
  if (daysExpired === null || daysExpired < AUTO_LOST_DAYS) return false
  const endMs = Date.parse(row.trialEndsAt!)
  const after = (iso: string | null): boolean => {
    const t = iso ? Date.parse(iso) : NaN
    return !Number.isNaN(t) && t >= endMs
  }
  if (after(row.contactedAt)) return false
  if (after(row.signals?.lastActivityAt ?? null)) return false
  return true
}

const contactedRecently = (row: SequenceRow, now: Date): boolean => {
  const d = daysBetween(row.contactedAt, now)
  return d !== null && d < CONTACT_QUIET_DAYS
}

export function createActivationSequenceCron(
  orm: any,
  resolveModule: (name: string) => any,
  logger: any,
): (now?: Date) => Promise<ActivationSequenceResult> {
  return async (now: Date = new Date()): Promise<ActivationSequenceResult> => {
    const result: ActivationSequenceResult = { sent: {}, lost: 0, skipped: 0 }
    try {
      const platformEmails = resolveModule('platform-emails')
      const salesLeads = resolveModule('sales-leads')
      if (!platformEmails?.sendEvent || !salesLeads?.getPipeline) {
        logger.warn('activation-sequence-cron: platform-emails o sales-leads no disponible')
        return result
      }

      const { data: rows } = (await salesLeads.getPipeline()) as { data: SequenceRow[] }
      const identity = await resolvePlatformIdentity({
        findOne: async (where: Record<string, unknown>) => ((await orm.findMany('Configuration', where)) as any[])[0] ?? null,
      })
      const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
      const commonVars = platformEmailVariables(identity)

      for (const row of rows) {
        if (!row.hotelId || !row.email) continue
        if (row.stage === 'lost' || row.lostAt) continue
        if (row.subscriptionStatus !== 'trialing') continue
        if (contactedRecently(row, now)) { result.skipped++; continue }

        // @ignore IDOR_RISK — hotelId sale del pipeline (dato del sistema), no de un request.
        const prospect = ((await orm.findMany('SalesProspects', { hotelId: row.hotelId })) as any[])[0] ?? null
        const sent = parseSent(prospect?.sequenceSent)

        let event: ActivationEvent | null = null
        let patch: Record<string, unknown> | null = null

        if (row.stage === 'expired') {
          if (shouldAutoLose(row, now)) {
            patch = { lostAt: now.toISOString(), lostReason: 'no_response' }
            result.lost++
          } else {
            event = rescueEventFor(row, sent, now)
          }
        } else if (row.stage === 'registered' || row.stage === 'activated') {
          const candidate = activationEventFor(row, now)
          if (candidate && !sent[candidate]) event = candidate
        }

        if (event) {
          const link = `${base}/panel/dashboard`
          const vars: Record<string, string> = {
            ...commonVars, hotel_name: row.hotelName ?? '', link,
            days_left: String(Math.max(row.daysLeft ?? 0, 0)),
          }
          // Solo cuenta como enviado si la cola lo tomó: sin plantilla (o inactiva) `sendEvent`
          // devuelve `sent:false` y NO se marca — si no, un seed que corre después del primer
          // tick dejaría a esos hoteles sin el correo para siempre.
          const outcome = await platformEmails.sendEvent(event, row.email, row.hotelId, vars)
          if (outcome?.sent) {
            sent[event] = now.toISOString()
            patch = { sequenceSent: sent }
            result.sent[event] = (result.sent[event] ?? 0) + 1
          } else {
            result.skipped++
          }
        }

        if (patch) {
          if (prospect) await orm.update('SalesProspects', prospect.id, patch)
          else await orm.create('SalesProspects', {
            hotelId: row.hotelId, leadId: null, nextStepAt: null, nextStepNote: null, assignedTo: null,
            contactedAt: null, lostAt: null, lostReason: null, notes: null, sequenceSent: {}, ...patch,
          })
        }
      }

      logger.info('activation-sequence-cron completado', result)
      return result
    } catch (e: any) {
      logger.warn('activation-sequence-cron falló', { error: e.message })
      return result
    }
  }
}
