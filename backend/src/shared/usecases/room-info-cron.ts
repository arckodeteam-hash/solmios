// shared/usecases/room-info-cron.ts — Manda al huésped la información de su habitación ASIGNADA
// cuando faltan <= N horas para la llegada (issue #297).
//
// Reemplaza el "24 h fijo" de `prearrival-pass-cron.ts` para reservas de CUALQUIER origen: la
// anticipación, el canal (email / WhatsApp / ambos) y la plantilla de Meta salen de la config
// `room_info_config` de cada hotel (ver `room-info-notice.ts`). El prearrival-pass-cron queda
// sólo para el pase de wallet.
//
// Reglas que se cuidan acá y no en la lógica pura:
//   · Sin habitación asignada NO se manda (CA13): nada de "te avisamos después".
//   · Datos FRESCOS en cada tick: la habitación, el código de la cerradura y el huésped se
//     releen siempre; la huella habitación+código decide si es un aviso nuevo (CA14/CA15).
//   · Todo intento queda en `message_logs` (sent o failed) con `response` = clave de dedup, el
//     mismo esquema que los auto-messages de marketing. Un failed NO bloquea el reintento en el
//     próximo tick (`roomInfoSendState`), hasta ROOM_INFO_MAX_ATTEMPTS por huella + canal.
//
// Moldes: prearrival-pass-cron.ts (ventana por horas antes, `now` inyectable), arrival-setup-
// cron.ts (barrido por fechas: `ORM.findMany` filtra sólo por igualdad, una consulta por día) y
// reservas/usecases/send-whatsapp.ts (validaciones del envío por Meta).

import { hotelToday, reservationAccessWindow } from '../utils/hotel-schedule'
import { toE164 } from '../utils/phone-e164'
import { resolverVariables, slugDeNombre } from '../../modules/reservas/usecases/send-whatsapp'
import {
  ROOM_INFO_CONFIG_KEY,
  parseRoomInfoConfig,
  buildRoomInfo,
  roomInfoFingerprint,
  roomInfoDedupKey,
  renderRoomInfoEmail,
  roomInfoSendState,
  channelsFor,
  type RoomInfoChannel,
} from './room-info-notice'

/** Cada 10 min: la anticipación se configura en horas, 10 min de resolución alcanza. */
export const ROOM_INFO_TICK_MS = 10 * 60_000

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

/** Días hacia atrás desde hoy que también se revisan (llegada de ayer que todavía no hizo check-in). */
const LOOKBACK_DAYS = 1

/**
 * Horas DESPUÉS de la llegada hasta las que todavía tiene sentido avisar: cubre una caída del
 * cron o una habitación asignada tarde el mismo día. Más allá, la llegada es vieja: el huésped
 * o ya hizo check-in (y salió de `confirmed`) o no vino, y mandarle la habitación confunde.
 */
const MAX_HOURS_AFTER_ARRIVAL = 24

/**
 * Sólo `confirmed` (lista blanca): `pending` no pagó y no se le entrega el código de la puerta;
 * `checked_in` ya tiene la habitación en mano; cancelada o no-show no reciben nada.
 */
const DELIVERABLE_STATUS = 'confirmed'

/** Kill-switch operativo para frenar el aviso en TODOS los hoteles sin tocar cada config. */
export function isRoomInfoNoticeDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ROOM_INFO_NOTICE_DISABLED === '1'
}

export interface RoomInfoCronResult {
  sent: number
  failed: number
  skipped: number
}

export interface RoomInfoCronDeps {
  orm: any
  /** 'reservas' → `{ whatsappPort }` (lo inyecta el connector reservas-whatsapp). */
  resolveModule: (name: string) => any
  emailService: {
    enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<string>
  } | null
  logger: any
  publicUrl: string
  /** Entorno (inyectable para tests). Se lee en cada tick. */
  env?: NodeJS.ProcessEnv
}

/**
 * Fechas de llegada ('YYYY-MM-DD') candidatas para un hotel: desde ayer (en la zona del hotel)
 * hasta hoy + ceil(hoursBefore/24) + 1. El día extra absorbe el desfase entre la fecha del
 * hotel y la hora de llegada: con hoursBefore=12 y llegada mañana a las 15:00, a las 20:00 de
 * hoy ya faltan menos de 24 h. Se suma sobre Date.UTC del string para no arrastrar la zona
 * del servidor.
 */
export function roomInfoDates(hotel: any, now: Date, hoursBefore: number): string[] {
  const today = hotelToday(hotel, now)
  const [y, m, d] = today.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const ahead = Math.ceil(Math.max(0, Number(hoursBefore) || 0) / 24) + 1
  const dates: string[] = []
  for (let offset = -LOOKBACK_DAYS; offset <= ahead; offset++) {
    dates.push(new Date(base + offset * MS_PER_DAY).toISOString().slice(0, 10))
  }
  return dates
}

interface SendOutcome {
  ok: boolean
  recipient: string
  errorMessage?: string
  templateId?: string
  providerMessageId?: string
}

export function createRoomInfoCron(deps: RoomInfoCronDeps): (now?: Date) => Promise<RoomInfoCronResult> {
  const { orm, logger } = deps

  /**
   * Registro en `message_logs`. `response` = clave de dedup (huella habitación+código), mismo
   * esquema `auto:{evento}:{...}` que los auto-messages; `roomInfoSendState` la lee en el tick
   * siguiente. Un failed no bloquea el reintento: hasta ROOM_INFO_MAX_ATTEMPTS por huella+canal.
   */
  async function logSend(
    reservation: any, channel: RoomInfoChannel, key: string, outcome: SendOutcome, now: Date,
  ): Promise<void> {
    await orm.create('MessageLogs', {
      hotelId: reservation.hotelId,
      reservationId: reservation.id,
      guestId: reservation.guestId || null,
      channel,
      messageType: channel === 'email' ? 'email' : 'whatsapp',
      status: outcome.ok ? 'sent' : 'failed',
      recipient: outcome.recipient,
      templateId: outcome.templateId,
      providerMessageId: outcome.providerMessageId,
      errorMessage: outcome.errorMessage ?? '',
      response: key,
      sentAt: now.toISOString(),
    })
  }

  async function sendEmail(reservation: any, guest: any, info: ReturnType<typeof buildRoomInfo>): Promise<SendOutcome> {
    const to = String(guest?.email ?? '').trim()
    if (!deps.emailService) return { ok: false, recipient: to, errorMessage: 'servicio de email no configurado' }
    if (!to) return { ok: false, recipient: to, errorMessage: 'el huésped no tiene email' }
    const { subject, html } = renderRoomInfoEmail(info)
    try {
      await deps.emailService.enqueue({
        to, subject, html, hotelId: reservation.hotelId, relatedType: 'room_info', relatedId: reservation.id,
      })
      return { ok: true, recipient: to }
    } catch (e) {
      return { ok: false, recipient: to, errorMessage: (e as Error).message || 'error al encolar el email' }
    }
  }

  async function sendWhatsapp(
    reservation: any, room: any, hotel: any, guest: any,
    info: ReturnType<typeof buildRoomInfo>, templateId: string,
  ): Promise<SendOutcome> {
    let reservas: any
    try { reservas = deps.resolveModule('reservas') } catch { reservas = null }
    const port = reservas?.whatsappPort
    const recipient = String(guest?.phone ?? '')
    if (!port) return { ok: false, recipient, errorMessage: 'envío por WhatsApp no disponible' }

    const creds = await port.credentialsFor(reservation.hotelId)
    if (!creds) return { ok: false, recipient, errorMessage: 'el hotel no conectó su WhatsApp' }
    if (!templateId) return { ok: false, recipient, errorMessage: 'sin plantilla de WhatsApp configurada' }

    // Misma regla que send-whatsapp.ts: plantilla del MISMO hotel y aprobada por Meta. Fuera de
    // la ventana de 24 h sólo se puede iniciar con plantilla aprobada, y este aviso siempre inicia.
    const plantilla = await orm.findById('WhatsappTemplates', templateId)
    if (!plantilla || plantilla.hotelId !== reservation.hotelId || plantilla.approvalStatus !== 'approved') {
      return { ok: false, recipient, errorMessage: 'la plantilla de WhatsApp no está aprobada por Meta', templateId }
    }

    const destino = toE164(guest?.phone, hotel?.country)
    if (!destino) return { ok: false, recipient, errorMessage: 'el huésped no tiene un teléfono válido', templateId }

    // Una plantilla arranca una conversación, y eso es lo que Meta cobra: acá va el tope del hotel.
    if (typeof port.assertPuedeIniciar === 'function') {
      try {
        await port.assertPuedeIniciar(reservation.hotelId)
      } catch (e) {
        return { ok: false, recipient: destino, errorMessage: (e as Error).message || 'cupo de WhatsApp agotado', templateId }
      }
    }

    try {
      const envio = await port.sendTemplate(creds, {
        to: destino,
        name: plantilla.metaTemplateName || slugDeNombre(plantilla.name),
        language: plantilla.language || 'es',
        parameters: resolverVariables(plantilla.metaVariableOrder || [], {
          guest, hotel, room,
          // El horario efectivo (override de la reserva o el del hotel), el mismo que va en el email.
          reservation: { ...reservation, checkInTime: info.accessFrom },
          lockCodes: info.accessCode,
        }),
      })
      return { ok: true, recipient: destino, templateId, providerMessageId: envio?.messageId }
    } catch (err) {
      const motivo = typeof port.explicarError === 'function' ? port.explicarError(err) : (err as Error).message
      return { ok: false, recipient: destino, errorMessage: motivo, templateId }
    }
  }

  return async (now: Date = new Date()): Promise<RoomInfoCronResult> => {
    const result: RoomInfoCronResult = { sent: 0, failed: 0, skipped: 0 }
    if (isRoomInfoNoticeDisabled(deps.env ?? process.env)) {
      logger.info('room-info-cron: desactivado por ROOM_INFO_NOTICE_DISABLED=1')
      return result
    }
    try {
      const hotels = ((await orm.findMany('Hotels', {})) ?? []) as any[]
      for (const hotel of hotels) {
        const cfgRows = ((await orm.findMany('Configuration', { hotelId: hotel.id, key: ROOM_INFO_CONFIG_KEY })) ?? []) as any[]
        const cfg = parseRoomInfoConfig(cfgRows[0]?.value)
        if (!cfg.enabled) continue

        for (const checkIn of roomInfoDates(hotel, now, cfg.hoursBefore)) {
          const reservations = ((await orm.findMany('Reservations', {
            hotelId: hotel.id, checkIn, status: DELIVERABLE_STATUS,
          })) ?? []) as any[]

          for (const reservation of reservations) {
            try {
              // Instante REAL de la llegada en la zona del hotel: el mismo criterio con el que se
              // abre el código de la cerradura.
              const arrivalMs = reservationAccessWindow(reservation, hotel).startMs
              if (!Number.isFinite(arrivalMs)) { result.skipped++; continue }
              const hoursLeft = (arrivalMs - now.getTime()) / MS_PER_HOUR
              if (hoursLeft > cfg.hoursBefore) { result.skipped++; continue }
              if (hoursLeft < -MAX_HOURS_AFTER_ARRIVAL) { result.skipped++; continue }

              // CA13: sin habitación asignada no se manda información incompleta.
              if (!reservation.roomId) { result.skipped++; continue }
              // @ignore IDOR_RISK — el roomId sale de la propia fila de la reserva (dato del sistema).
              const room = await orm.findById('Rooms', reservation.roomId)
              if (!room) { result.skipped++; continue }

              // Datos frescos en cada tick: código vigente y huésped actual.
              const lockRows = ((await orm.findMany('LockCodes', { reservationId: reservation.id, status: 'active' })) ?? []) as any[]
              const lockCode = lockRows[0]?.code ?? null
              // @ignore IDOR_RISK — idem, guestId sale de la reserva.
              const guest = reservation.guestId ? await orm.findById('Guests', reservation.guestId) : null
              const info = buildRoomInfo({ reservation, room, hotel, guest, lockCode, publicUrl: deps.publicUrl })
              const key = roomInfoDedupKey(roomInfoFingerprint(String(reservation.roomId), info.accessCode))

              const logs = ((await orm.findMany('MessageLogs', { hotelId: hotel.id, reservationId: reservation.id })) ?? []) as any[]
              for (const channel of channelsFor(cfg)) {
                const state = roomInfoSendState(logs, key, channel)
                if (state !== 'pending') { result.skipped++; continue }

                const outcome = channel === 'email'
                  ? await sendEmail(reservation, guest, info)
                  : await sendWhatsapp(reservation, room, hotel, guest, info, cfg.whatsappTemplateId)
                await logSend(reservation, channel, key, outcome, now)
                if (outcome.ok) {
                  result.sent++
                } else {
                  result.failed++
                  logger.warn('room-info-cron: envío fallido', { reservationId: reservation.id, channel, motivo: outcome.errorMessage })
                }
              }
            } catch (e) {
              // Una reserva rota no frena al resto: se loguea y sigue.
              result.skipped++
              logger.warn('room-info-cron: reserva salteada', { reservationId: reservation?.id, error: (e as Error).message })
            }
          }
        }
      }

      if (result.sent || result.failed) logger.info('room-info-cron', result)
      return result
    } catch (e) {
      logger.error('room-info-cron falló', { error: (e as Error).message })
      return result
    }
  }
}
