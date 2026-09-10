// shared/usecases/notify-channel-request.ts — Los avisos del caso "conectame Booking" (REQ-CAN-07).
//
// Antes el aviso al admin era una línea de log (`canales/index.ts`): el hotel apretaba "Solicitar
// Conexión", veía "listo, te contactamos" y del otro lado no pasaba absolutamente nada hasta que
// alguien entraba a la bandeja por casualidad. Y el hotel nunca se enteraba de nada más: ni de la
// cita, ni de que su canal quedó conectado, ni de por qué lo rechazaron.
//
// La lógica de QUÉ se avisa vive acá (shared, testeable); el cableado —quién manda el correo, quién
// crea la notificación in-app— lo inyecta el composition-root / el connector `canales-notificaciones`.
//
// Todo es best-effort por diseño: un correo que no sale no puede perder la solicitud ni deshacer un
// cambio de estado (misma regla que ya tenía `requestChannel`).

import { platformEmailVariables, type PlatformIdentity } from '../utils/platform-identity'
import type { ChannelRequestRow } from '../../modules/canales/usecases/channel-requests'
import { CHANNEL_REQUEST_MEDIUM_LABELS, type ChannelRequestMedium } from '../../modules/canales/usecases/channel-requests'

/** Los 3 eventos de plantilla editable que el hotel recibe. */
export const CHANNEL_REQUEST_EMAIL_EVENTS = {
  scheduled: 'channel_request_scheduled',
  rescheduled: 'channel_request_scheduled',
  connected: 'channel_request_connected',
  rejected: 'channel_request_rejected',
} as const

export type ChannelRequestNotifyEvent = keyof typeof CHANNEL_REQUEST_EMAIL_EVENTS

export interface ChannelRequestEmailSender {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string }): Promise<string>
}

export interface ChannelRequestNotificationPort {
  create(dto: Record<string, unknown>, user: { id: string; role: string; hotelId: string }): Promise<unknown>
}

export interface ChannelRequestNotifyDeps {
  /** Cola de correo genérica: la usa SOLO el aviso al admin (no es plantilla editable). */
  emailSender?: ChannelRequestEmailSender
  /** `platform-emails.sendEvent` — las 3 plantillas que ve el hotel. */
  sendPlatformEvent?: (event: string, to: string, hotelId: string, vars: Record<string, string>) => Promise<{ sent: boolean }>
  /** Campanita del panel. La inyecta el connector `canales-notificaciones`. */
  notificaciones?: ChannelRequestNotificationPort
  /** Los usuarios de la plataforma (userType `admin`) que reciben el aviso in-app. */
  findAdminUsers?: () => Promise<Array<{ id: string; name?: string; email?: string }>>
  /** `hotels` del hotel que pidió: correo de respaldo cuando la solicitud no trae uno. */
  findHotel?: (hotelId: string) => Promise<{ name?: string; email?: string; phone?: string } | null>
  platformIdentity: () => Promise<PlatformIdentity>
  publicUrl?: string
  logger?: { warn(message: string, meta?: Record<string, unknown>): void }
}

const esc = (v: unknown): string => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Fecha y hora de la cita en el formato que el hotelero lee (es-DO). */
export function formatAppointment(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  return {
    date: d.toLocaleDateString('es-DO', { day: '2-digit', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
  }
}

export function mediumLabel(medium?: string | null): string {
  return CHANNEL_REQUEST_MEDIUM_LABELS[medium as ChannelRequestMedium] ?? ''
}

/**
 * Nuevo pedido: correo al soporte de la plataforma + campanita para cada admin.
 *
 * Devuelve qué se pudo hacer para que el llamador lo registre; nunca tira.
 */
export async function notifyAdminOfChannelRequest(
  deps: ChannelRequestNotifyDeps,
  row: ChannelRequestRow,
): Promise<{ emailed: boolean; notified: number }> {
  const identity = await deps.platformIdentity().catch(() => null)
  const platformName = identity?.platformName ?? ''
  const canal = row.channelName || row.channel
  const hotel = row.hotelName || row.hotelId
  let emailed = false
  let notified = 0

  const supportEmail = identity?.supportEmail?.trim() ?? ''
  if (supportEmail && deps.emailSender) {
    // Sin PUBLIC_URL no se arma el enlace: un `href="/admin/channels"` relativo dentro de un
    // correo no lleva a ninguna parte, y un botón que no funciona es peor que no tenerlo.
    const base = (deps.publicUrl || '').replace(/\/$/, '')
    const panel = base ? `${base}/admin/channels` : ''
    const html = [
      `<p><strong>${esc(hotel)}</strong> pidió conectar <strong>${esc(canal)}</strong>.</p>`,
      row.requestedByName || row.requestedByEmail
        ? `<p>Lo pidió: ${esc(row.requestedByName || '')} ${row.requestedByEmail ? `&lt;${esc(row.requestedByEmail)}&gt;` : ''}</p>`
        : '',
      row.contactPhone ? `<p>Teléfono de contacto: ${esc(row.contactPhone)}</p>` : '',
      row.message ? `<p>Mensaje del hotel:<br>${esc(row.message).replace(/\n/g, '<br>')}</p>` : '',
      panel ? `<p><a href="${esc(panel)}">Abrir la bandeja de solicitudes</a></p>` : '',
    ].filter(Boolean).join('\n')
    try {
      await deps.emailSender.enqueue({
        to: supportEmail,
        subject: `${platformName ? `[${platformName}] ` : ''}${hotel} pidió conectar ${canal}`,
        html,
        hotelId: row.hotelId,
        relatedType: 'channel_request:created',
      })
      emailed = true
    } catch (e) {
      deps.logger?.warn('No se pudo encolar el aviso de solicitud de canal', { error: (e as Error).message })
    }
  }

  if (deps.notificaciones && deps.findAdminUsers) {
    try {
      const admins = await deps.findAdminUsers()
      for (const admin of admins) {
        await deps.notificaciones.create({
          // El aviso es de la PLATAFORMA, no del hotel que pidió: si llevara el hotelId del hotel,
          // aparecería en la campanita de ese hotel (que no tiene por qué ver el trabajo interno).
          hotelId: 'platform',
          userId: admin.id,
          type: 'system',
          title: `${hotel} pidió conectar ${canal}`,
          message: row.message ? String(row.message).slice(0, 300) : 'Sin mensaje del hotel',
          read: 0,
          date: new Date().toISOString(),
        }, { id: 'system', role: 'super_admin', hotelId: 'platform' })
        notified++
      }
    } catch (e) {
      deps.logger?.warn('No se pudo crear la notificación in-app de la solicitud', { error: (e as Error).message })
    }
  }

  return { emailed, notified }
}

/**
 * Aviso al hotel: cita agendada/reprogramada, canal conectado o pedido rechazado.
 *
 * Usa las plantillas editables de plataforma (`platform-emails`), así el texto lo cambia el dueño
 * de la plataforma sin tocar código y el nombre sale de `{platform_name}`, nunca escrito a mano.
 */
export async function notifyHotelOfChannelRequest(
  deps: ChannelRequestNotifyDeps,
  row: ChannelRequestRow,
  event: ChannelRequestNotifyEvent,
): Promise<{ sent: boolean; to?: string }> {
  if (!deps.sendPlatformEvent) return { sent: false }

  const hotel = deps.findHotel ? await deps.findHotel(row.hotelId).catch(() => null) : null
  const to = (row.contactEmail || row.requestedByEmail || hotel?.email || '').trim()
  if (!to) return { sent: false }

  const { date, time } = formatAppointment(row.appointmentAt)
  const identity = await deps.platformIdentity().catch(() => null)
  const vars: Record<string, string> = {
    ...(identity ? platformEmailVariables(identity) : {}),
    hotel_name: row.hotelName || hotel?.name || '',
    channel_name: row.channelName || row.channel,
    appointment_date: date,
    appointment_time: time,
    appointment_medium: mediumLabel(row.appointmentMedium),
    contact_name: row.contactName || '',
    agent_name: row.contactName || '',
    reason: row.resolutionReason || '',
    link: `${(deps.publicUrl || '').replace(/\/$/, '')}/panel/channel-manager`,
  }

  try {
    const result = await deps.sendPlatformEvent(CHANNEL_REQUEST_EMAIL_EVENTS[event], to, row.hotelId, vars)
    return { sent: Boolean(result?.sent), to }
  } catch (e) {
    deps.logger?.warn('No se pudo avisar al hotel del cambio en su solicitud', { error: (e as Error).message })
    return { sent: false }
  }
}
