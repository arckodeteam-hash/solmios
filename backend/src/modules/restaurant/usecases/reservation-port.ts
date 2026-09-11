// restaurant/usecases/reservation-port.ts — #208: la reserva de un room service / cargo a habitación
// tiene que ser DEL HOTEL de la comanda. Antes `reservationId` viajaba sin mirarse hasta
// `folios/usecases/open-folio.ts`, que hereda `guestId`/`roomId` de la reserva que le pasen: se podía
// abrir un folio del hotel A con los datos de una reserva del hotel B (IDOR cruzado).
//
// El módulo restaurant NO importa reservas: declara este puerto y `connectors/restaurante-reservas.ts`
// lo cablea con `reservas.getById` (que ya hace su propio ownership). El hotel contra el que se
// compara es el que el usecase RESOLVIÓ (el de la comanda, o el del usuario en BD) — nunca el
// `hotelId` del token: un token viejo sin hotelId (hotel-auth.ts lo sigue aceptando) haría que
// `getById` rechace una reserva que sí es del hotel. Por eso el usuario que viaja al puerto lleva
// ese hotel. Acá se vuelve a comparar `hotelId` igual — un super_admin pasa el ownership de reservas
// con cualquier hotel, y la comanda es de UNO solo. Sin puerto cableado se FALLA CERRADO (misma
// decisión que `ports.chargeToFolio`).
import { ConflictError, NotFoundError, ValidationError } from 'arckode-framework'
import type { CurrentUser } from '../types'
import { stayCoversDate } from '../../../shared/utils/hotel-schedule'

export interface ReservationSummary {
  id: string
  hotelId: string
  guestId?: string | null
  roomId?: string | null
  /** #209: `chargeToRoom` solo carga a una reserva alojada (`checked_in`) o `confirmed` vigente. */
  status?: string
  checkIn?: string
  checkOut?: string
}

/**
 * #209: fila del buscador "quién está alojado" (espejo de `reservas/usecases/in-house.ts`; el conector
 * mapea campo por campo, así un campo nuevo de un lado no pasa desapercibido en el otro). Sin saldo a
 * propósito: el mozo (`restaurant:create`, sin `billing:view`) no tiene por qué ver lo que debe cada
 * huésped, y el buscador no lo necesita para elegir la habitación.
 */
export interface InHouseReservation {
  id: string
  hotelId: string
  roomId: string
  roomNumber: string
  guestId: string | null
  guestName: string
  checkIn: string
  checkOut: string
  nights: number
  /** `checked_in` = alojado; `confirmed` = llega hoy / vigente sin check-in (el POS lo marca "Sin check-in"). */
  status: string
}

export interface InHouseSearchResult {
  data: InHouseReservation[]
  /** Coincidencias reales; `data.length < total` = la lista se recortó y conviene afinar el término. */
  total: number
}

export interface ReservationPort {
  /** Devuelve la reserva o `null` si no existe o el usuario no la puede ver. El 404 lo decide el usecase. */
  findById(reservationId: string, user: CurrentUser): Promise<ReservationSummary | null>
  /**
   * #209: alojados (y confirmadas vigentes) de `hotelId` que coinciden con `q` (número de habitación o
   * apellido), o la reserva `id` del hotel (cualquier estado) si viene. El hotel viaja explícito y
   * resuelto por el usecase, mismo criterio que `findById`. Opcional para no romper los dobles que solo
   * cablean `findById`; sin él, `usecases/in-house.ts` falla cerrado.
   */
  searchInHouse?(query: { q: string; id?: string }, hotelId: string, user: CurrentUser): Promise<InHouseSearchResult>
}

/**
 * Exige que la reserva exista y pertenezca a `hotelId`. Mismo 404 para "no existe" y "es de otro
 * hotel": responder 403 confirmaría que el id existe en otro hotel.
 */
export async function assertReservationOfHotel(
  port: ReservationPort | null | undefined,
  reservationId: string,
  hotelId: string,
  user: CurrentUser,
): Promise<ReservationSummary> {
  if (!port) throw new ValidationError('Validación de reservas no disponible (reservas no conectado)')
  const reservation = await port.findById(reservationId, { ...user, hotelId })
  if (!reservation || reservation.hotelId !== hotelId) throw new NotFoundError('Reserva no encontrada')
  return reservation
}

/**
 * #209: a qué reserva se le puede cargar una cuenta. Solo a un huésped que está en la casa: `checked_in`,
 * o `confirmed` cuya estadía cubre HOY (llegó y todavía no pasó por recepción, REG-1). Una `checked_out`
 * ya tiene el folio cerrado/facturado, una `cancelled`/`no_show` no tiene folio que valga, y una
 * `pending` todavía no es una reserva. Sin `status` (puerto viejo) se falla CERRADO: 409, no cargo.
 * `today` viene en la zona del hotel (shared/utils/hotel-schedule.ts `hotelToday`).
 */
export function assertReservationChargeable(reservation: ReservationSummary, today: string): void {
  const status = reservation.status ?? ''
  if (status === 'checked_in') return
  if (status === 'confirmed' && stayCoversDate(reservation, today)) return
  const label = status === 'confirmed' ? 'confirmada pero fuera de su estadía' : status ? `en estado "${status}"` : 'sin estado'
  throw new ConflictError(`La reserva no está alojada (${label}): solo se carga a habitación una reserva con check-in o confirmada vigente`)
}
