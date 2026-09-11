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
import type { ReservationPort, ReservationSummary } from '../modules/restaurant'

interface ReservasModule {
  getById: (id: string, user: { id: string; role: string; hotelId?: string }) => Promise<{ id: string; hotelId: string; guestId?: string | null; roomId?: string | null }>
}

export function restauranteReservasConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<{ setReservationPort: (p: ReservationPort) => void }>('restaurant')
  const reservas = ctx.resolveModule<ReservasModule>('reservas')

  restaurant.setReservationPort({
    findById: async (reservationId, user): Promise<ReservationSummary | null> => {
      try {
        const r = await reservas.getById(reservationId, { id: user.id, role: user.role ?? '', hotelId: user.hotelId ?? undefined })
        return { id: r.id, hotelId: r.hotelId, guestId: r.guestId ?? null, roomId: r.roomId ?? null }
      } catch (e) {
        if (e instanceof NotFoundError || e instanceof AuthError || e instanceof ForbiddenError) return null
        throw e
      }
    },
  })
}
