// connectors/bookingengine-promocodes.ts — Wire: bookingengine (widget público) ↔ promo-codes
//
// PC-5 (auditoría 2026-08-19): el huésped que cancela su reserva desde el motor público
// (public-cancel.ts emite `onBookingCancelled`) también debe recuperar el uso del código que
// consumió al reservar — sin esto, un canje de puntos CRM quedaba quemado al cancelar desde
// la web, mientras que cancelar desde el panel sí lo liberaba (reservas-promocodes).
//
// Best-effort: si promo-codes no carga o falla, NO rompe la cancelación. bookingengine
// .setSockets ACUMULA handlers — no pisa a bookingengine-deposits/tracking.
import type { ConnectorContext } from 'arckode-framework'

interface PromoCodesModule {
  releaseUseByCode: (hotelId: string, code: string) => Promise<void>
}

interface BookingengineModule {
  setSockets: (s: Record<string, any>) => void
}

export function bookingenginePromocodesConnector(ctx: ConnectorContext): void {
  const promoCodes = ctx.resolveModule<PromoCodesModule>('promo-codes')
  const bookingengine = ctx.resolveModule<BookingengineModule>('bookingengine')

  bookingengine.setSockets({
    onBookingCancelled: async (data: { reservationId: string; hotelId: string; promoCode?: string | null }) => {
      if (!data?.promoCode) return
      try {
        await promoCodes.releaseUseByCode(data.hotelId, data.promoCode)
      } catch {
        // Best-effort: no bloquear la cancelación del huésped por el contador del promo.
      }
    },
  })
}
