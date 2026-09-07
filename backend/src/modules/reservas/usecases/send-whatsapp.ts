// reservas/usecases/send-whatsapp.ts — Envío REAL al huésped por la Cloud API de Meta.
//
// Reemplaza el enlace `wa.me` que abría WhatsApp en el navegador del recepcionista y dejaba el
// registro en `status:'queued'` porque el sistema no podía confirmar nada (ver `message-log.ts`).
// Ahora el mensaje sale del servidor, vuelve con acuse, y el estado lo dicta Meta.
//
// Dos reglas de Meta mandan sobre todo lo demás:
//   · Fuera de la ventana de 24 h desde el último mensaje del huésped, SOLO plantilla aprobada.
//   · Cada conversación iniciada se cobra. Un doble click es plata del hotel.

import { ValidationError, ConflictError, NotFoundError } from 'arckode-framework'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { toE164 } from '../../../shared/utils/phone-e164'
import { assertReservationOwned, type SimpleUser } from './reservation-ownership'

/** Lo que este usecase necesita de Meta. Se inyecta para poder testear sin red. */
export interface WhatsappSendPort {
  /** `null` si el hotel no conectó su WhatsApp. */
  credentialsFor(hotelId: string): Promise<{ wabaId: string; phoneNumberId: string; accessToken: string } | null>
  sendTemplate(
    creds: { wabaId: string; phoneNumberId: string; accessToken: string },
    input: { to: string; name: string; language: string; parameters?: string[] },
  ): Promise<{ messageId: string }>
  sendText(
    creds: { wabaId: string; phoneNumberId: string; accessToken: string },
    input: { to: string; text: string },
  ): Promise<{ messageId: string }>
  /** Traduce el error de Meta a algo que el recepcionista pueda accionar. */
  explicarError(err: unknown): string
}

export interface SendWhatsappDeps {
  reservationRepo: RepositoryAdapter<any>
  userRepo: RepositoryAdapter<any>
  guestRepo: RepositoryAdapter<any>
  hotelRepo: RepositoryAdapter<any>
  templateRepo: RepositoryAdapter<any>
  messageLogRepo: RepositoryAdapter<any>
  whatsapp: WhatsappSendPort
  auth: any
  logger: Logger
}

export interface SendWhatsappInput {
  /** Plantilla aprobada a enviar. Obligatoria salvo que la ventana de 24 h esté abierta. */
  templateId?: string
  /** Texto libre. Solo se acepta con la ventana abierta. */
  text?: string
}

/** Ventana de servicio de WhatsApp: 24 h desde el último mensaje ENTRANTE del huésped. */
export const VENTANA_MS = 24 * 60 * 60 * 1000

/** Valores demo que rellenan una variable que la reserva no puede resolver. */
const SIN_DATO = ''

/**
 * Resuelve el valor de cada variable de la plantilla, en el ORDEN en que Meta las numeró.
 * Un orden distinto le pone el nombre del hotel donde va el del huésped, y Meta no lo detecta:
 * manda el mensaje mal armado igual.
 */
export function resolverVariables(
  orden: string[],
  ctx: { guest?: any; hotel?: any; reservation?: any; room?: any },
): string[] {
  const valores: Record<string, string> = {
    guest_name: ctx.guest?.name || ctx.guest?.firstName || 'Huésped',
    hotel_name: ctx.hotel?.name || 'el hotel',
    checkin_date: ctx.reservation?.checkIn || SIN_DATO,
    checkout_date: ctx.reservation?.checkOut || SIN_DATO,
    room_number: ctx.room?.number || ctx.reservation?.roomNumber || SIN_DATO,
    nights: String(ctx.reservation?.nights ?? SIN_DATO),
    total_amount: ctx.reservation?.totalAmount != null ? String(ctx.reservation.totalAmount) : SIN_DATO,
    locator: ctx.reservation?.code || ctx.reservation?.locator || SIN_DATO,
  }
  // Meta rechaza un parámetro vacío, así que un dato que la reserva no tiene va como guión.
  return orden.map((nombre) => valores[nombre] || '—')
}

/** ¿Se puede escribir texto libre? Solo si el huésped escribió hace menos de 24 h. */
export function ventanaAbierta(lastInboundAt: string | null | undefined, ahora = Date.now()): boolean {
  if (!lastInboundAt) return false
  const t = Date.parse(lastInboundAt)
  return Number.isFinite(t) && ahora - t < VENTANA_MS
}

/**
 * Manda el mensaje y deja el rastro en `message_logs`.
 *
 * La fila se crea con `status:'queued'` ANTES de llamar a Meta. Si se creara después, un proceso
 * que muere en el medio dejaría al huésped con un mensaje que el hotel no ve en ningún lado — y el
 * mismo mensaje se volvería a mandar, y a cobrar.
 */
export async function sendWhatsappForReservation(
  deps: SendWhatsappDeps,
  reservationId: string,
  input: SendWhatsappInput,
  user: SimpleUser,
): Promise<Record<string, unknown>> {
  const reserva = await assertReservationOwned(deps.reservationRepo, deps.userRepo, deps.auth, reservationId, user)

  const creds = await deps.whatsapp.credentialsFor(reserva.hotelId)
  if (!creds) {
    throw new ConflictError('Este hotel todavía no conectó su WhatsApp. Conectalo en Configuración → Integraciones.')
  }

  // @ignore IDOR_RISK — el huésped y el hotel salen de la reserva ya validada arriba.
  const guest = reserva.guestId ? await deps.guestRepo.findById(reserva.guestId) : null
  // @ignore IDOR_RISK — idem.
  const hotel = await deps.hotelRepo.findById(reserva.hotelId)

  const destino = toE164(guest?.phone, hotel?.country)
  if (!destino) {
    throw new ValidationError(
      'El huésped no tiene un teléfono válido. Cargalo con el prefijo del país (por ejemplo +1 809 555 0000) y volvé a intentar.',
    )
  }

  const plantilla = input.templateId ? await deps.templateRepo.findById(input.templateId) : null
  if (input.templateId) {
    if (!plantilla) throw new NotFoundError('Plantilla no encontrada')
    if (plantilla.hotelId !== reserva.hotelId) throw new NotFoundError('Plantilla no encontrada')
    if (plantilla.approvalStatus !== 'approved') {
      throw new ConflictError('Meta todavía no aprobó esa plantilla. Elegí una aprobada o esperá la revisión.')
    }
  }

  // Sin bandeja de entrada todavía no hay mensajes entrantes registrados, así que la ventana se
  // asume CERRADA. Es la respuesta segura: asumir lo contrario produce un rechazo de Meta y una
  // conversación cobrada que no se entrega.
  if (!input.templateId) {
    if (!input.text?.trim()) throw new ValidationError('Escribí el mensaje o elegí una plantilla.')
    if (!ventanaAbierta(reserva.lastInboundAt)) {
      throw new ConflictError(
        'Pasaron más de 24 horas desde el último mensaje del huésped: para escribirle hay que usar una plantilla aprobada.',
      )
    }
  }

  const ahora = new Date().toISOString()
  const log = await deps.messageLogRepo.create({
    hotelId: reserva.hotelId,
    reservationId,
    guestId: reserva.guestId || null,
    channel: 'whatsapp_api',
    messageType: 'whatsapp',
    status: 'queued',
    recipient: destino,
    templateId: input.templateId || null,
    sentAt: ahora,
  })

  try {
    const envio = plantilla
      ? await deps.whatsapp.sendTemplate(creds, {
          to: destino,
          name: plantilla.metaTemplateName || slugDeNombre(plantilla.name),
          language: plantilla.language || 'es',
          parameters: resolverVariables(plantilla.metaVariableOrder || [], { guest, hotel, reservation: reserva }),
        })
      : await deps.whatsapp.sendText(creds, { to: destino, text: String(input.text) })

    await deps.messageLogRepo.update(log.id, {
      status: 'sent',
      providerMessageId: envio.messageId,
      errorMessage: '',
    })
    deps.logger.info('WhatsApp enviado', { reservationId, hotelId: reserva.hotelId, wamid: envio.messageId })
    // @ignore IDOR_RISK — relectura post-escritura del MISMO id.
    return (await deps.messageLogRepo.findById(log.id)) as Record<string, unknown>
  } catch (err) {
    const motivo = deps.whatsapp.explicarError(err)
    await deps.messageLogRepo.update(log.id, { status: 'failed', errorMessage: motivo })
    deps.logger.warn('WhatsApp no enviado', { reservationId, motivo })
    throw new ConflictError(motivo)
  }
}

/** Mismo criterio que `metaTemplateName` de marketing: Meta solo acepta minúsculas y guión bajo. */
function slugDeNombre(nombre: string): string {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'plantilla'
}
