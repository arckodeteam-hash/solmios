// shared/usecases/channel-appointments-cron.ts — El recordatorio diario de citas con hoteles.
//
// Una cita agendada que nadie mira es peor que no haberla agendado: el hotel se queda esperando la
// llamada y la solicitud envejece en `scheduled` sin que salte ninguna alarma. Este cron le manda
// al soporte de la plataforma, una vez por día, las citas de HOY y las que ya vencieron.
//
// Dedup por `(requestId, appointmentAt)`: la marca `channel_requests.reminderSentFor` guarda la
// cita ya recordada. Correrlo dos veces el mismo día manda un solo correo; reprogramar la cita
// limpia la marca (`scheduleAppointment`) y vuelve a habilitar el aviso para la fecha nueva.
//
// Molde: night-audit-cron.ts / trial-reminder-cron.ts (factory + `now` inyectable + nunca tira).

import { isOverdue, isAppointmentToday, type ChannelRequestRow } from '../../modules/canales/usecases/channel-requests'
import { resolvePlatformIdentity } from '../utils/platform-identity'
import { formatAppointment, mediumLabel } from './notify-channel-request'

/** Hora del servidor a la que sale el recordatorio. El gate del reloj vive en composition-root. */
export const CHANNEL_APPOINTMENT_REMINDER_HOUR = 8

export interface ChannelAppointmentsCronResult {
  today: number
  overdue: number
  sent: boolean
}

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function fila(row: ChannelRequestRow, vencida: boolean): string {
  const { date, time } = formatAppointment(row.appointmentAt)
  const medio = mediumLabel(row.appointmentMedium)
  const quien = [row.contactName, row.contactPhone].filter(Boolean).join(' · ')
  return `<li>${vencida ? '<strong>VENCIDA</strong> — ' : ''}${esc(row.hotelName || row.hotelId)} · ${esc(row.channelName || row.channel)}`
    + ` — ${esc(date)} ${esc(time)}${medio ? ` (${esc(medio)})` : ''}${quien ? ` — ${esc(quien)}` : ''}</li>`
}

/**
 * `orm` se usa solo para leer/escribir las dos tablas del caso, igual que el resto de los crones
 * del proyecto (night-audit, trial-reminder): un cron no pasa por un service porque corre fuera de
 * todo request y no tiene usuario del cual derivar permisos.
 */
export function createChannelAppointmentsCron(
  orm: any,
  emailSender: { enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string }): Promise<string> } | null,
  logger: { info(m: string, meta?: Record<string, unknown>): void; warn(m: string, meta?: Record<string, unknown>): void },
  publicUrl = '',
): (now?: Date) => Promise<ChannelAppointmentsCronResult> {
  return async (now: Date = new Date()): Promise<ChannelAppointmentsCronResult> => {
    const vacio: ChannelAppointmentsCronResult = { today: 0, overdue: 0, sent: false }
    try {
      const rows = (await orm.findMany('ChannelRequests', { status: 'scheduled' })) as ChannelRequestRow[]
      const pendientes = rows.filter((r) =>
        !!r.appointmentAt
        && (isAppointmentToday(r, now) || isOverdue(r, now))
        && r.reminderSentFor !== r.appointmentAt)
      if (!pendientes.length) return vacio

      const vencidas = pendientes.filter((r) => isOverdue(r, now))
      const hoy = pendientes.filter((r) => !isOverdue(r, now))

      const identity = await resolvePlatformIdentity({
        findOne: async (q: Record<string, unknown>) => ((await orm.findMany('Configuration', q)) as any[])[0] ?? null,
      } as any)
      const to = identity.supportEmail.trim()

      let sent = false
      if (to && emailSender) {
        const panel = `${publicUrl.replace(/\/$/, '')}/admin/channels`
        const html = [
          `<p>Citas de conexión de canales para hoy:</p>`,
          vencidas.length ? `<p><strong>Vencidas (${vencidas.length})</strong></p><ul>${vencidas.map((r) => fila(r, true)).join('')}</ul>` : '',
          hoy.length ? `<p><strong>Hoy (${hoy.length})</strong></p><ul>${hoy.map((r) => fila(r, false)).join('')}</ul>` : '',
          panel ? `<p><a href="${esc(panel)}">Abrir la bandeja de solicitudes</a></p>` : '',
        ].filter(Boolean).join('\n')
        try {
          await emailSender.enqueue({
            to,
            subject: `${identity.platformName ? `[${identity.platformName}] ` : ''}Citas de canales: ${hoy.length} hoy · ${vencidas.length} vencidas`,
            html,
            hotelId: 'platform',
            relatedType: 'channel_request:reminder',
          })
          sent = true
        } catch (e: any) {
          logger.warn('channel-appointments-cron: no se pudo encolar el recordatorio', { error: e?.message })
        }
      }

      // La marca se escribe aunque el correo no haya salido: si el envío está roto, reintentar cada
      // hora no lo arregla y sí llena la cola. El caso sigue visible en la bandeja como "Vencida".
      for (const row of pendientes) {
        await orm.update('ChannelRequests', row.id, { reminderSentFor: row.appointmentAt, updatedAt: now.toISOString() })
        try {
          await orm.create('ChannelRequestActivities', {
            id: crypto.randomUUID(),
            requestId: row.id,
            hotelId: row.hotelId,
            kind: 'reminder_sent',
            note: sent ? `Recordatorio enviado a ${to}` : 'Recordatorio pendiente: no hay correo de soporte configurado',
            payload: { appointmentAt: row.appointmentAt ?? '', overdue: isOverdue(row, now) },
            createdAt: now.toISOString(),
          })
        } catch { /* el historial no puede romper el cron */ }
      }

      logger.info('channel-appointments-cron completado', { today: hoy.length, overdue: vencidas.length, sent })
      return { today: hoy.length, overdue: vencidas.length, sent }
    } catch (e: any) {
      logger.warn('channel-appointments-cron falló', { error: e?.message })
      return vacio
    }
  }
}
