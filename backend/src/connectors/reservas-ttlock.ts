// connectors/reservas-ttlock.ts — Expira códigos TTLock al checkout y a la cancelación.
//
// C-1 (auditoría 2026-08-19): solo escuchaba onReservationCheckedOut — una reserva pagada
// con código ya generado que se CANCELABA dejaba el PIN de la habitación activo hasta su
// endDate original: el huésped recuperó la plata según política pero conservaba acceso
// físico. onReservationCancelled (panel, sistema, OTA) ahora también expira. best-effort:
// si ttlock no carga o falla, no rompe la cancelación (el staff puede revocar a mano).
import type { ConnectorContext } from 'arckode-framework'

async function expireSafely(ctx: ConnectorContext, reservationId: string): Promise<void> {
  try {
    const ttlock = ctx.resolveModule<{ expireCodesByReservation: (id: string) => Promise<void> }>('ttlock')
    await ttlock.expireCodesByReservation(reservationId)
  } catch {
    // ttlock module may not be registered — that's ok
  }
}

export function reservasTtlockConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{ setSockets: (s: any) => void }>('reservas')
  reservas.setSockets({
    onReservationCheckedOut: async (data: { reservationId: string }) => {
      await expireSafely(ctx, data.reservationId)
    },
    // C-1: cancelar = sin acceso físico. La idempotencia de cancel-core (no re-emite el
    // evento si ya estaba cancelada) evita el doble procesado.
    onReservationCancelled: async (data: { reservationId: string }) => {
      await expireSafely(ctx, data.reservationId)
    },
  })
}
