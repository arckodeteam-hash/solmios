// connectors/bookingengine-ttlock.ts — Wire: bookingengine (widget público) → ttlock.
//
// C-1 (auditoría 2026-08-19): el huésped que cancela DESDE LA WEB (public-cancel emite
// onBookingCancelled) también debe perder el acceso físico — sin esto, cancelar por el
// widget dejaba el PIN vivo mientras que cancelar por el panel lo expiraba. best-effort:
// si ttlock no carga o falla, no rompe la cancelación del huésped.
import type { ConnectorContext } from 'arckode-framework'

export function bookingengineTtlockConnector(ctx: ConnectorContext): void {
  const bookingengine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')

  bookingengine.setSockets({
    onBookingCancelled: async (data: { reservationId: string }) => {
      if (!data?.reservationId) return
      try {
        const ttlock = ctx.resolveModule<{ expireCodesByReservation: (id: string) => Promise<void> }>('ttlock')
        await ttlock.expireCodesByReservation(data.reservationId)
      } catch {
        // ttlock no registrado o API caída — la cancelación ya persistió.
      }
    },
  })
}
