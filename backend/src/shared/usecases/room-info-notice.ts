// shared/usecases/room-info-notice.ts — Lógica PURA del aviso "Tu habitación" (issue #297).
//
// Qué es: el hotel configura cuántas horas antes de la llegada se le manda al huésped la
// información de su habitación ASIGNADA — número, nombre, código de acceso de la cerradura,
// horario de acceso y link al check-in digital — por email y/o WhatsApp.
//
// Este archivo no toca ORM ni red: parsea la config, arma los datos, renderiza el correo/texto
// y decide (mirando `message_logs`) si hay que mandar, reintentar o parar. El barrido con el
// ORM vive en `room-info-cron.ts`, que compone estas funciones. Separado así para que todas
// las reglas se prueben con datos en memoria, sin levantar una base.
//
// Moldes: `prearrival-pass-cron.ts` (ventana por horas antes de la llegada, horario efectivo
// desde `hotel-schedule`), `wallet-pass/usecases/pass-email.ts` (HTML + `esc()`) y
// `marketing/usecases/auto-message-dedupe.ts` (dedup por `response` en message_logs).

import { createHash } from 'node:crypto'
import { safeParse } from '../utils/safe-parse'
import { effectiveCheckInTime, effectiveCheckOutTime } from '../utils/hotel-schedule'
import { checkinHashFromId } from '../utils/checkin-hash'

// ─── Configuración por hotel (tabla `configuration`, key `room_info_config`) ───────────────

export interface RoomInfoConfig {
  enabled: boolean
  /** Horas antes de la llegada a partir de las cuales se manda el aviso. */
  hoursBefore: number
  channel: 'email' | 'whatsapp' | 'both'
  /** Plantilla aprobada de Meta para el envío por WhatsApp; vacío = texto libre / sin plantilla. */
  whatsappTemplateId: string
}

export const ROOM_INFO_CONFIG_KEY = 'room_info_config'

/** Apagado por default: un hotel que nunca lo configuró no manda códigos de puerta solos. */
export const ROOM_INFO_DEFAULTS: RoomInfoConfig = {
  enabled: false,
  hoursBefore: 24,
  channel: 'email',
  whatsappTemplateId: '',
}

/** Menos de 1 h no da tiempo a que el envío llegue; más de 7 días y la habitación todavía
 *  puede reasignarse varias veces (cada cambio dispararía un aviso nuevo). */
export const MIN_HOURS_BEFORE = 1
export const MAX_HOURS_BEFORE = 168

const CHANNELS: ReadonlySet<string> = new Set(['email', 'whatsapp', 'both'])

/**
 * Normaliza lo que haya guardado en `configuration.value`. Acepta objeto (el ORM deserializa
 * la columna json solo) o string JSON (escrituras viejas). Null, undefined o basura → defaults.
 * Cada campo se sanea por separado: un valor inválido no descarta el resto de la config.
 */
export function parseRoomInfoConfig(raw: unknown): RoomInfoConfig {
  const value = safeParse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...ROOM_INFO_DEFAULTS }
  const v = value as Record<string, unknown>

  const hours = Math.round(Number(v.hoursBefore))
  const hoursBefore = Number.isFinite(hours)
    ? Math.min(MAX_HOURS_BEFORE, Math.max(MIN_HOURS_BEFORE, hours))
    : ROOM_INFO_DEFAULTS.hoursBefore

  const channel = CHANNELS.has(String(v.channel))
    ? (v.channel as RoomInfoConfig['channel'])
    : ROOM_INFO_DEFAULTS.channel

  return {
    enabled: v.enabled === true || v.enabled === 'true' || v.enabled === 1,
    hoursBefore,
    channel,
    whatsappTemplateId: String(v.whatsappTemplateId ?? '').trim(),
  }
}

// ─── Datos del aviso ────────────────────────────────────────────────────────────────────────

export interface RoomInfoData {
  roomNumber: string
  roomName: string
  /** Código de la cerradura; vacío si el hotel no tiene cerradura inteligente o aún no se generó. */
  accessCode: string
  /** 'HH:MM' desde/hasta la que el código abre — el horario EFECTIVO (override de la reserva
   *  o el del hotel), el mismo que se carga en la cerradura. */
  accessFrom: string
  accessUntil: string
  checkIn: string
  checkOut: string
  /** Link al check-in digital; vacío si ya lo completó o si no hay PUBLIC_URL. */
  preCheckinUrl: string
  guestName: string
  hotelName: string
}

export interface BuildRoomInfoInput {
  reservation: any
  room: any
  hotel: any
  guest?: any
  lockCode?: string | null
  publicUrl?: string
}

export function buildRoomInfo(input: BuildRoomInfoInput): RoomInfoData {
  const { reservation, room, hotel, guest } = input
  const base = String(input.publicUrl ?? '').trim().replace(/\/+$/, '')
  // El link solo tiene sentido si el check-in digital sigue pendiente: mandarlo después de
  // completado confunde al huésped ("¿tengo que hacerlo de nuevo?").
  const preCheckinUrl = base && reservation?.preCheckinStatus !== 'completed'
    ? `${base}/checkin/${checkinHashFromId(String(reservation?.id ?? ''))}`
    : ''

  return {
    roomNumber: String(room?.number ?? ''),
    roomName: String(room?.name ?? ''),
    accessCode: String(input.lockCode ?? '').trim(),
    accessFrom: effectiveCheckInTime(reservation, hotel),
    accessUntil: effectiveCheckOutTime(reservation, hotel),
    checkIn: String(reservation?.checkIn ?? '').slice(0, 10),
    checkOut: String(reservation?.checkOut ?? '').slice(0, 10),
    preCheckinUrl,
    guestName: guest?.name || guest?.firstName || 'Huésped',
    hotelName: hotel?.name || 'Hotel',
  }
}

// ─── Huella y clave de dedup ────────────────────────────────────────────────────────────────

/**
 * Huella de LO QUE se le mandó al huésped: habitación + código. Si se reasigna la habitación
 * o se regenera el código, la huella cambia y el cron vuelve a mandar el aviso con los datos
 * nuevos (CA14); si nada cambió, la misma huella ya figura en message_logs y no se repite
 * (CA15). Va hasheada para no dejar el código de la puerta en texto plano en `response`:
 * message_logs lo lee cualquier usuario del hotel con acceso a marketing.
 */
export function roomInfoFingerprint(roomId: string, accessCode: string): string {
  return createHash('sha256').update(`${roomId}|${accessCode}`).digest('hex').slice(0, 16)
}

/** Clave que se guarda en `message_logs.response`, mismo esquema `auto:{evento}:{...}` que
 *  usan los auto-messages de marketing. */
export function roomInfoDedupKey(fingerprint: string): string {
  return `auto:room_info:${fingerprint}`
}

// ─── Render ─────────────────────────────────────────────────────────────────────────────────

/** Escapa texto para meterlo en HTML de forma segura. Mismo helper que pass-email.ts. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** Frase del horario de acceso, compartida entre HTML y texto plano. */
function accessScheduleLine(info: RoomInfoData): string {
  return `desde las ${info.accessFrom} del ${info.checkIn} hasta las ${info.accessUntil} del ${info.checkOut}`
}

/**
 * Correo "Tu habitación en {hotel}". Misma estética que CONFIRMED_ES (notification-defaults)
 * y la sección de código en mono grande de pass-email.ts. Cada bloque opcional (código,
 * horario, check-in digital) se omite entero si falta el dato: un hotel sin cerradura
 * inteligente no manda un "Código de acceso:" vacío.
 */
export function renderRoomInfoEmail(info: RoomInfoData): { subject: string; html: string } {
  const hotelName = esc(info.hotelName)
  const guestName = esc(info.guestName)
  const roomNumber = esc(info.roomNumber)
  const roomName = info.roomName ? `<p style="margin:4px 0 0;font-size:15px;color:#4b5563;">${esc(info.roomName)}</p>` : ''

  const codeBlock = info.accessCode
    ? `<div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:bold;">🔑 Código de acceso</p>
      <p style="margin:0;font-family:'Courier New',monospace;font-size:28px;letter-spacing:4px;color:#1a2b4c;font-weight:bold;text-align:center;background:#f3f4f6;padding:12px;border-radius:6px;">${esc(info.accessCode)}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280;text-align:center;">Ingresá este código en el teclado de la puerta.</p>
    </div>`
    : ''

  const scheduleBlock = info.accessFrom
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px;">Horario de acceso: ${esc(accessScheduleLine(info))}.</p>`
    : ''

  const checkinBlock = info.preCheckinUrl
    ? `<div style="margin:16px 0 8px;text-align:center;">
      <a href="${esc(info.preCheckinUrl)}" style="display:inline-block;background:#1a2b4c;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold;font-size:14px;">Completar check-in digital</a>
      <p style="font-size:13px;color:#6b7280;margin:8px 0 0;">Completalo antes de llegar y evitás la espera en recepción.</p>
    </div>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1a2b4c;color:white;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:24px;">🏨 ${hotelName}</h1>
    <p style="margin:5px 0 0;opacity:0.8;">Tu habitación</p>
  </div>
  <div style="background:#f8f9fa;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;">Hola <strong>${guestName}</strong>,</p>
    <p>Ya tenemos tu habitación lista. Estos son los datos para tu llegada:</p>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;text-align:center;">
      <p style="margin:0;font-size:22px;font-weight:bold;color:#1a2b4c;">Habitación ${roomNumber}</p>
      ${roomName}
    </div>
    <div style="background:white;border-radius:8px;padding:16px;margin:16px 0;border:1px solid #e5e7eb;">
      <table style="width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Check-in</td><td style="padding:6px 0;font-weight:bold;text-align:right;">${esc(info.checkIn)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Check-out</td><td style="padding:6px 0;font-weight:bold;text-align:right;">${esc(info.checkOut)}</td></tr>
      </table>
    </div>
    ${codeBlock}
    ${scheduleBlock}
    ${checkinBlock}
    <p style="font-size:13px;color:#6b7280;">¡Te esperamos!</p>
  </div>
</body>
</html>`

  return { subject: `Tu habitación en ${info.hotelName}`, html }
}

/** Versión texto plano: WhatsApp en texto libre y fallback del correo. Mismas reglas de
 *  "sólo si está" que el HTML. */
export function renderRoomInfoText(info: RoomInfoData): string {
  const lines: string[] = [
    `Hola ${info.guestName}, ya tenemos tu habitación lista en ${info.hotelName}.`,
    '',
    `Habitación ${info.roomNumber}${info.roomName ? ` — ${info.roomName}` : ''}`,
    `Check-in: ${info.checkIn}`,
    `Check-out: ${info.checkOut}`,
  ]
  if (info.accessCode) lines.push(`Código de acceso: ${info.accessCode}`)
  if (info.accessFrom) lines.push(`Horario de acceso: ${accessScheduleLine(info)}.`)
  if (info.preCheckinUrl) lines.push('', `Completar check-in digital: ${info.preCheckinUrl}`)
  lines.push('', '¡Te esperamos!')
  return lines.join('\n')
}

// ─── Dedup y reintento contra message_logs ──────────────────────────────────────────────────

/**
 * Tope de fallos por huella y canal. Un fallo transitorio se reintenta en el tick siguiente
 * (CA20), pero un fallo PERMANENTE —plantilla de WhatsApp no aprobada, teléfono inválido,
 * SMTP sin configurar— no puede generar una fila failed cada 10 minutos hasta la llegada.
 * El tope se reinicia solo si cambia la huella (habitación o código nuevos): ahí el aviso es
 * otro y vuelve a merecer sus intentos.
 */
export const ROOM_INFO_MAX_ATTEMPTS = 3

/** Valores de `message_logs.channel` que este aviso escribe y consulta. */
export type RoomInfoChannel = 'email' | 'whatsapp_api'

export interface RoomInfoLog {
  response?: string | null
  channel?: string | null
  status?: string | null
}

const DELIVERED_STATUS: ReadonlySet<string> = new Set(['sent', 'queued'])

export function roomInfoSendState(
  logs: RoomInfoLog[],
  dedupKey: string,
  channel: RoomInfoChannel,
): 'sent' | 'exhausted' | 'pending' {
  const mine = logs.filter(l => l.response === dedupKey && l.channel === channel)
  if (mine.some(l => DELIVERED_STATUS.has(String(l.status)))) return 'sent'
  const failed = mine.filter(l => String(l.status) === 'failed').length
  return failed >= ROOM_INFO_MAX_ATTEMPTS ? 'exhausted' : 'pending'
}

/** Canales de envío que pide la config, en el vocabulario de `message_logs.channel`. */
export function channelsFor(cfg: RoomInfoConfig): RoomInfoChannel[] {
  if (cfg.channel === 'whatsapp') return ['whatsapp_api']
  if (cfg.channel === 'both') return ['email', 'whatsapp_api']
  return ['email']
}
