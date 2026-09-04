// connectors/reservas-bookingengine.ts — Conector entre booking-engine y reservas.
// Bug Playwright (auditoría E2E 2026-09-04): una reserva creada por el motor público escribe
// directo a `Reservations` (bookingengine/usecases/public-booking.ts), sin pasar por el CRUD de
// `reservas` — así que nunca bumpeaba la versión de su caché de listado. Administración podía
// tardar hasta CACHE_TTL (300s) en mostrar un alta pública recién hecha. Mismo patrón que
// reservas-canales.ts/booking-channex.ts: SOLO delega, sin lógica propia.

import type { ConnectorContext } from 'arckode-framework'

export function reservasBookingengineConnector(ctx: ConnectorContext): void {
  const bookingEngine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')

  bookingEngine.setSockets({
    onBookingCreated: async (booking: any) => {
      try {
        const reservas = ctx.resolveModule<{ invalidateListCache: (hotelId: string) => Promise<void> }>('reservas')
        await reservas.invalidateListCache(booking.hotelId).catch((err: unknown) => {
          console.error(`[reservas-bookingengine] invalidateListCache falló (hotel=${booking.hotelId}):`, err instanceof Error ? err.message : err)
        })
      } catch {
        // reservas siempre está cableado (módulo núcleo) — catch defensivo, no debería pegar nunca.
      }
    },
  })
}
