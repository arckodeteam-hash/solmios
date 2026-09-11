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
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { CurrentUser } from '../types'

export interface ReservationSummary {
  id: string
  hotelId: string
  guestId?: string | null
  roomId?: string | null
}

export interface ReservationPort {
  /** Devuelve la reserva o `null` si no existe o el usuario no la puede ver. El 404 lo decide el usecase. */
  findById(reservationId: string, user: CurrentUser): Promise<ReservationSummary | null>
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
