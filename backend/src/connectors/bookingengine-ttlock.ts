// connectors/bookingengine-ttlock.ts — Wire: bookingengine (widget público) → ttlock.
//
// C-1 (auditoría 2026-08-19): el huésped que cancela DESDE LA WEB (public-cancel emite
// onBookingCancelled) también debe perder el acceso físico — sin esto, cancelar por el
// widget dejaba el PIN vivo mientras que cancelar por el panel lo expiraba. best-effort:
// si ttlock no carga o falla, no rompe la cancelación del huésped.
import type { ConnectorContext, Logger } from 'arckode-framework'

export function bookingengineTtlockConnector(logger: Logger): (ctx: ConnectorContext) => void {
  const log = logger.child('bookingengine-ttlock')
  return (ctx: ConnectorContext) => {
    const bookingengine = ctx.resolveModule<{ setSockets: (s: { onBookingCancelled?: (data: { reservationId: string }) => Promise<void> }) => void }>('bookingengine')

    bookingengine.setSockets({
      onBookingCancelled: async (data: { reservationId: string }) => {
        if (!data?.reservationId) return
        try {
          const ttlock = ctx.resolveModule<{ expireCodesByReservation: (id: string) => Promise<void> }>('ttlock')
          await ttlock.expireCodesByReservation(data.reservationId)
        } catch (e) {
          // ttlock no registrado o API caída — la cancelación ya persistió, pero un PIN vivo
          // sin reserva es acceso físico huérfano: queda logueado para que el staff lo revoque
          // (mismo patrón que payment-requests-ttlock.ts).
          log.warn(`No se expiraron los códigos TTLock al cancelar la reserva ${data.reservationId}: ${e instanceof Error ? e.message : String(e)}`)
        }
      },
    })
  }
}
