// connectors/restaurante-reservas.ts — #208: la reserva de un room service / cargo a habitación tiene
// que existir y ser DEL HOTEL de la comanda. `restaurant` declara `ReservationPort` (usecases/
// reservation-port.ts) y este connector lo cablea con `reservas.getById` — los módulos nunca se
// importan entre sí. Solo DELEGA.
//
// `getById` ya hace ownership: NotFoundError si no existe, AuthError (403) si es de otro hotel. Ambos
// se traducen a `null` acá y el usecase responde el MISMO 404 (no confirmar que el id existe en otro
// hotel). Cualquier otro error (base caída) se propaga: no es "no encontrada".
import type { ConnectorContext } from 'arckode-framework'
import { AuthError, ForbiddenError, NotFoundError } from 'arckode-framework'
import type { ReservationPort, ReservationSummary, InHouseReservation, InHouseSearchResult } from '../modules/restaurant'
import type { InHouseReservation as ReservasInHouseRow, InHouseSearchResult as ReservasInHouseResult } from '../modules/reservas'

interface ReservasModule {
  getById: (id: string, user: { id: string; role: string; hotelId?: string }) => Promise<{ id: string; hotelId: string; guestId?: string | null; roomId?: string | null; status?: string; checkIn?: string; checkOut?: string }>
  // #209: alojados del hotel por habitación/apellido, o una reserva por id (reservas/usecases/in-house.ts).
  searchInHouse: (query: { q?: string; id?: string }, user: { id: string; role: string; hotelId?: string }) => Promise<ReservasInHouseResult>
}

export function restauranteReservasConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<{ setReservationPort: (p: ReservationPort) => void }>('restaurant')
  const reservas = ctx.resolveModule<ReservasModule>('reservas')

  restaurant.setReservationPort({
    findById: async (reservationId, user): Promise<ReservationSummary | null> => {
      try {
        const r = await reservas.getById(reservationId, { id: user.id, role: user.role ?? '', hotelId: user.hotelId ?? undefined })
        // #209: estado y estadía viajan para que `chargeToRoom` rechace (409) una reserva que no está alojada.
        return { id: r.id, hotelId: r.hotelId, guestId: r.guestId ?? null, roomId: r.roomId ?? null, status: r.status, checkIn: r.checkIn, checkOut: r.checkOut }
      } catch (e) {
        if (e instanceof NotFoundError || e instanceof AuthError || e instanceof ForbiddenError) return null
        throw e
      }
    },
    // #209: el hotel ya viene resuelto por el usecase del restaurante y viaja como `hotelId` del usuario
    // (lo único que `reservas.searchInHouse` usa para acotar). El mapeo es campo por campo y tipado
    // contra los DOS lados: un campo nuevo en un espejo y no en el otro no compila.
    searchInHouse: async ({ q, id }, hotelId, user): Promise<InHouseSearchResult> => {
      const res = await reservas.searchInHouse({ q, id }, { id: user.id, role: user.role ?? '', hotelId })
      return { data: res.data.map(toInHouseRow), total: res.total }
    },
  })
}

function toInHouseRow(r: ReservasInHouseRow): InHouseReservation {
  return {
    id: r.id, hotelId: r.hotelId, roomId: r.roomId, roomNumber: r.roomNumber,
    guestId: r.guestId, guestName: r.guestName,
    checkIn: r.checkIn, checkOut: r.checkOut, nights: r.nights, status: r.status,
  }
}
