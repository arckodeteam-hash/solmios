// canales/usecases/booking-ingestion.ts
// Aplica una revisión de booking OTA al PMS: dedupe por locator, resolución de roomType, persistencia.
// Extraído del service para mantenerlo <200 líneas. Lógica preservada de la POC Channex.
//
// Cancelaciones → refrescan la reserva existente.
// Modificaciones → se ack sin sobreescribir datos en vivo (requiere reconciliación humana).

import type { ORM } from 'arckode-framework'
import type { ChannexUseCase } from './channex'
import type { BookingRevisionDTO } from '../types'
import { localRoomTypeFromTitle } from '../../../shared/utils/room-type-titles'

/**
 * Puerto de cancelación hacia `reservas` (lo cablea `connectors/canales-reservas.ts`).
 *
 * `canales` NO puede importar `reservas` (regla del proyecto), así que el tipo es estructural.
 * OBLIGATORIO, no opcional: antes acá se hacía `orm.update('Reservations', id, {status:'cancelled'})`
 * a mano, lo que salteaba la política, el snapshot financiero y —lo caro— el evento
 * `onReservationCancelled`, único disparador del release del depósito retenido. Si el puerto no
 * estuviera cableado, preferimos que la revisión falle (se contabiliza en `errors[]` y NO se
 * ackea → vuelve en el próximo tick) antes que "cancelar" a medias y dejar plata trabada.
 */
export type ReservationCancelPort = (
  reservationId: string,
  hotelId: string,
  reason: string,
  /** `error` es el CÓDIGO (para decidir si reintentar); `message`, el texto para el log. */
) => Promise<{ ok: boolean; error?: string; message?: string; idempotent?: boolean }>

export interface BookingIngestDeps {
  orm: ORM
  channex: ChannexUseCase
  hotelId: string
  apiKey: string
  cancelReservation: ReservationCancelPort
  /** Para dejar rastro de las cancelaciones OTA que no se pueden aplicar (ver más abajo). */
  logger?: { error: (msg: string, meta?: Record<string, unknown>) => void }
  /**
   * #246 — Aviso de ALTA (socket `onOtaBookingIngested` del service). Solo se dispara cuando se
   * crea una reserva nueva: dedupe, modificación y cancelación no avisan. Best-effort: si el aviso
   * falla, la ingesta ya está hecha y la revisión se ackea igual.
   */
  onIngested?: (data: { hotelId: string; reservationId: string; ota: string }) => Promise<void>
}

/** Resultado de aplicar una revisión: distingue reserva creada vs dedupe (ya existía). */
export interface ApplyBookingResult {
  /** true → se creó una reserva nueva; false → dedupe (posiblemente actualizada por cancelación). */
  created: boolean
}

/**
 * DTO de reserva mapeado desde una revisión OTA de Channex.
 * hotelId llega por parámetro (no desde cfg) → permite el path global multi-tenancy.
 */
export interface MappedBookingDTO {
  hotelId: string
  channel: string
  source: string
  externalLocator: string
  checkIn: string
  checkOut: string
  totalAmount: number
  currency: string
  status: string
  adults: number
  children: number
  notes: string
  otaNotes: string
  channexRevisionId: string
  channexBookingId: string
  channexRoomTypeId: string | null
}

/**
 * Mapea una revisión de booking de Channex al DTO de reserva del PMS.
 * Función PURA: sin IO, sin side-effects. El hotelId se inyecta (resolución multi-tenancy
 * la hace el caller vía revision.propertyId → channel_config.channexPropertyId).
 *
 * Preserva el mapeo histórico de channex.ingestBookings (guestName, occupancy, locator, etc.).
 */
export function mapBookingRevision(booking: BookingRevisionDTO, hotelId: string): MappedBookingDTO {
  const guestName = [booking.customer?.name, booking.customer?.surname].filter(Boolean).join(' ') || 'OTA Guest'
  const guestEmail = booking.customer?.mail || ''
  const guestPhone = booking.customer?.phone || ''
  const firstRoom = (booking.rooms || [])[0] || ({} as BookingRevisionDTO['rooms'][number])
  const adults = firstRoom.occupancy?.adults ?? 2
  const children = (firstRoom.occupancy?.children || 0) + (firstRoom.occupancy?.infants || 0)
  return {
    hotelId,
    channel: booking.otaName,
    source: 'ota',
    externalLocator: booking.otaReservationCode || booking.uniqueId,
    checkIn: booking.arrivalDate,
    checkOut: booking.departureDate,
    totalAmount: parseFloat(booking.amount) || 0,
    currency: booking.currency,
    status: booking.status === 'cancelled' ? 'cancelled' : 'confirmed',
    adults,
    children,
    notes: `OTA: ${booking.otaName} | Ref: ${booking.uniqueId}`,
    otaNotes: `Guest: ${guestName} <${guestEmail}> ${guestPhone} | revision ${booking.id} | booking ${booking.bookingId}`,
    channexRevisionId: booking.id,
    channexBookingId: booking.bookingId,
    channexRoomTypeId: firstRoom.roomTypeId || null,
  }
}

/**
 * Primer tipo del hotel para el fallback sin mapeo: el de la unidad con el número más bajo (orden
 * numérico, luego por id). Estable entre corridas para que dos revisiones del mismo booking sin
 * mapeo no caigan en tipos distintos.
 */
function firstRoomType(rooms: any[]): string | undefined {
  const sorted = [...rooms].sort((a, b) =>
    String(a.number ?? '').localeCompare(String(b.number ?? ''), undefined, { numeric: true }) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
  const first = sorted.find((r) => r?.type && String(r.type).trim())
  return first ? String(first.type) : undefined
}

/**
 * Aplica UNA revisión de booking al PMS.
 * - Dedupe por externalLocator (ota_reservation_code / unique id de Channex).
 * - Cancelación OTA (status 'cancelled') → actualiza la reserva existente.
 * - Creación → la reserva nace POR TIPO y SIN unidad (REQ-HAC-05, #260): `roomType` sale del
 *   roomTypeId de Channex traducido al código local; `roomId` queda null hasta el assign-room.
 * - Nunca dropea un booking OTA: sin mapeo se ingesta con el primer tipo del hotel + flag.
 */
export async function applyBookingRevision(deps: BookingIngestDeps, dto: any): Promise<ApplyBookingResult> {
  const { orm, channex, hotelId, apiKey, cancelReservation } = deps

  // Dedupe por locator externo.
  if (dto.externalLocator) {
    const existing = await orm.findMany('Reservations', { hotelId, externalLocator: dto.externalLocator })
    if (existing && existing.length > 0) {
      if (dto.status === 'cancelled') {
        // Cancelación REAL vía el módulo reservas: aplica política, persiste el snapshot
        // (cancelledAt/cancellationFee/refundAmount/policyApplied) y emite onReservationCancelled
        // → connectors/reservas-deposits.ts libera el depósito/garantía retenido.
        // Idempotente del otro lado: si la reserva ya estaba `cancelled` (el feed reprocesa
        // revisiones repetidas), es no-op — no recalcula ni vuelve a liberar el depósito.
        const res = await cancelReservation(existing[0].id, hotelId, `Cancelada por el canal ${dto.channel || 'OTA'}`)
        // Reintentar solo lo que PUEDE mejorar. `invalid_state` (el canal cancela una reserva que
        // ya hizo check-in) y `not_found` son definitivos: el próximo tick daría exactamente lo
        // mismo, así que lanzar acá dejaba la revisión reintentándose para siempre, quemando el
        // feed y enterrando las revisiones sanas detrás. Se registra y se ackea: es una anomalía
        // que necesita ojo humano (el huésped está adentro), no un reintento.
        // Cualquier otro fallo (puerto sin cablear, BD caída) SÍ es transitorio → que reintente,
        // antes que "cancelar" a medias y dejar el depósito trabado.
        if (!res.ok) {
          const permanent = res.error === 'invalid_state' || res.error === 'not_found'
          if (!permanent) throw new Error(`No se pudo cancelar la reserva ${existing[0].id}: ${res.message || res.error || 'error desconocido'}`)
          deps.logger?.error('Cancelación OTA imposible de aplicar — requiere revisión manual', {
            hotelId, reservationId: existing[0].id, externalLocator: dto.externalLocator,
            channel: dto.channel, reason: res.error, detail: res.message,
          })
        }
      }
      return { created: false }
    }
  }

  // Resolver roomType: Channex referencia roomTypeId (tipo); la fila del PMS lleva ese tipo.
  const { channexRoomTypeId, channexRevisionId, channexBookingId, ...payload } = dto
  // REQ-HAC-05 (#260): la OTA vende un TIPO, no una unidad. Antes acá se elegía habitación
  // (`availableOfType` + `rooms[0]` de fallback) y dos OTA del mismo tipo con las mismas fechas
  // terminaban en la misma unidad o marcadas como overbooking cuando en realidad había cupo. Ahora
  // la reserva nace con `roomType` y `roomId` null, igual que el widget y el panel: la unidad la
  // asigna recepción (assign-room) y la disponibilidad por tipo la cuenta `availableOfType` sobre
  // las filas con `roomType`. La ingesta NUNCA rechaza — la OTA ya cobró esa noche.
  let roomType: string | undefined
  let channexTitle = ''
  if (channexRoomTypeId) {
    const rt = await channex.getRoomTypeById(apiKey, channexRoomTypeId)
    channexTitle = rt?.title || ''
    if (channexTitle) {
      // El room type de Channex se publica con título vendible ("Twin Room"); la habitación local
      // guarda el código del enum ('twin'). Sin traducir, ninguna reserva OTA encontraba su tipo.
      const localType = localRoomTypeFromTitle(channexTitle)
      const rooms = localType ? await orm.findMany('Rooms', { hotelId, type: localType }) : []
      // Sólo vale un tipo que el hotel efectivamente tenga: un mapeo viejo a un tipo que ya no
      // existe dejaría la reserva sin contra qué contar disponibilidad. Se guarda `rooms.type`
      // tal cual está en la BD (mismo código que el panel y el widget), no el título traducido.
      if (rooms?.length) roomType = String(rooms[0].type || localType)
    }
  }
  if (!roomType) {
    // Sin mapeo (sin roomTypeId, título desconocido o tipo sin unidades en el hotel): primer tipo
    // del hotel + flag para que recepción lo corrija. Determinístico: la unidad de número más bajo.
    const any = await orm.findMany('Rooms', { hotelId })
    roomType = firstRoomType(any || [])
    if (roomType) payload.notes = [payload.notes, `⚠ TIPO SIN MAPEAR (${channexTitle || channexRoomTypeId || 'sin room type'})`].filter(Boolean).join(' | ')
  }
  if (!roomType) throw new Error(`Sin habitaciones para el hotel ${hotelId}`)

  payload.id = crypto.randomUUID()
  payload.roomId = null
  payload.roomType = roomType
  await orm.create('Reservations', payload)
  // La reserva ya está guardada: un aviso que falla no la deshace ni frena el ack de la revisión.
  try {
    await deps.onIngested?.({ hotelId, reservationId: payload.id, ota: dto.channel || 'OTA' })
  } catch (e) {
    deps.logger?.error('No se pudo avisar la reserva OTA ingresada', {
      hotelId, reservationId: payload.id, externalLocator: dto.externalLocator, channel: dto.channel, error: (e as Error).message,
    })
  }
  return { created: true }
}
