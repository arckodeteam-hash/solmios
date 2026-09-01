// connectors/booking-channex.ts — Conector entre booking-engine y canales (Channex).
// Una reserva confirmada del motor público baja la disponibilidad OTA del tipo afectado.
// Bug fix: llamaba pushAvailability con un objeto cuando el service espera (hotelId, ...)
// → TypeError silencioso tragado por el catch vacío: el push jamás se ejecutaba y una reserva
// web no bajaba la disponibilidad de las OTAs.

import type { ConnectorContext } from 'arckode-framework'

export function bookingChannexConnector(ctx: ConnectorContext): void {
  const bookingEngine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')

  bookingEngine.setSockets({
    onBookingCreated: async (booking: any) => {
      if (booking.status === 'confirmed') {
        try {
          const canales = ctx.resolveModule<{ pushAvailabilityByRoom: (hotelId: string, roomId: string) => Promise<unknown> }>('canales')
          // Por roomId: la variante resuelve el room type real de la habitación reservada.
          // Socket post-respuesta: el await no bloquea al usuario; el catch loguea (nada silencioso).
          await canales.pushAvailabilityByRoom(booking.hotelId, booking.roomId).catch((err: unknown) => {
            console.error(`[booking-channex] push de disponibilidad falló (hotel=${booking.hotelId} room=${booking.roomId}):`, err instanceof Error ? err.message : err)
          })
        } catch {
          // canales puede no estar disponible (módulo desactivado). No rompe el alta de la reserva.
        }
      }
    },
  })
}
