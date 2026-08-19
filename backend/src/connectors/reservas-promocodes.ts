// connectors/reservas-promocodes.ts — Wire: reservas (staff) ↔ promo-codes
//
// FIX 2026-07-31 — hallazgo real: el wizard de reserva manual del staff (panel) tenía un
// campo "Código promocional" que se guardaba como texto SIN validar ni aplicar ningún
// descuento — cero efecto en el precio. Solo funcionaba en el widget público (F2.5).
//
// PC-1/PC-2/PC-5 (auditoría 2026-08-19):
//  - El puerto ya no expone `incrementUses` (read-modify-write post-create, vulnerable a
//    doble canje): usa `consumeUse` (CAS ANTES de persistir, 409 si agotado) y `releaseUse`
//    (compensación si el create falla, y devolución del uso al cancelar).
//  - `onReservationCancelled`: una reserva con código canjeado que se cancela devuelve el
//    uso (un POINTS-xxx de CRM ya no queda quemado). La idempotencia de cancel-core (no
//    re-emite el evento si ya estaba cancelada) evita el doble release, igual que con los
//    depósitos. Best-effort: si falla, no rompe la cancelación.
import type { ConnectorContext } from 'arckode-framework'

interface PromoCodesModule {
  validate: (hotelId: string, code: string, subtotal: number) => Promise<{ valid: boolean; discount: number; reason?: string; code?: string }>
  consumeUseByCode: (hotelId: string, code: string) => Promise<void>
  releaseUseByCode: (hotelId: string, code: string) => Promise<void>
}

interface ReservasModule {
  setOrchestrationDeps: (deps: Record<string, unknown>) => void
  setSockets: (s: Record<string, any>) => void
}

export function reservasPromocodesConnector(ctx: ConnectorContext): void {
  const promoCodes = ctx.resolveModule<PromoCodesModule>('promo-codes')
  const reservas = ctx.resolveModule<ReservasModule>('reservas')

  reservas.setOrchestrationDeps({
    promoCodes: {
      validate: (hotelId: string, code: string, subtotal: number) => promoCodes.validate(hotelId, code, subtotal),
      consumeUse: (hotelId: string, code: string) => promoCodes.consumeUseByCode(hotelId, code),
      releaseUse: (hotelId: string, code: string) => promoCodes.releaseUseByCode(hotelId, code),
    },
  })

  // PC-5: reservas.setSockets ACUMULA handlers (merge secuencial) — no pisa a reservas-deposits
  // ni a los demás listeners del mismo evento.
  reservas.setSockets({
    onReservationCancelled: async (data: { reservationId: string; hotelId: string; promoCode?: string | null }) => {
      if (!data?.promoCode) return
      try {
        await promoCodes.releaseUseByCode(data.hotelId, data.promoCode)
      } catch {
        // Best-effort: la cancelación de la reserva ya quedó persistida — el admin puede
        // ajustar `uses` a mano (campo editable por diseño) si esto falla.
      }
    },
  })
}
