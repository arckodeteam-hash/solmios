// connectors/reservas-bookingengine.ts — Conector entre booking-engine y reservas.
// Bug Playwright (auditoría E2E 2026-09-04): una reserva creada por el motor público escribe
// directo a `Reservations` (bookingengine/usecases/public-booking.ts), sin pasar por el CRUD de
// `reservas` — así que nunca bumpeaba la versión de su caché de listado. Administración podía
// tardar hasta CACHE_TTL (300s) en mostrar un alta pública recién hecha. Mismo patrón que
// reservas-canales.ts: SOLO delega, sin lógica propia.

import type { ConnectorContext } from 'arckode-framework'

export function reservasBookingengineConnector(ctx: ConnectorContext): void {
  const bookingEngine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')

  const invalidate = async (hotelId: string): Promise<void> => {
    try {
      const reservas = ctx.resolveModule<{ invalidateListCache: (hotelId: string) => Promise<void> }>('reservas')
      await reservas.invalidateListCache(hotelId).catch((err: unknown) => {
        console.error(`[reservas-bookingengine] invalidateListCache falló (hotel=${hotelId}):`, err instanceof Error ? err.message : err)
      })
    } catch {
      // reservas siempre está cableado (módulo núcleo) — catch defensivo, no debería pegar nunca.
    }
  }

  bookingEngine.setSockets({
    onBookingCreated: async (booking: any) => { await invalidate(booking.hotelId) },
    // #272 — la cancelación pública (bookingengine/usecases/public-cancel.ts) también escribe
    // `Reservations` directo (status/cancelledAt/refundAmount de todo el grupo): mismo agujero,
    // el listado mostraba la reserva viva hasta CACHE_TTL.
    onBookingCancelled: async (event: any) => { await invalidate(event.hotelId) },
  })
}
