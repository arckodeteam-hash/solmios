// connectors/reports-ttlock.ts — Expira el PIN de la puerta al marcar no-show.
//
// Hueco encontrado en producción (2026-08-29): había un código TTLock `active` de una reserva
// `no_show`. `reservas-ttlock` cubre checkout y cancelación, pero el no-show se marca desde
// `reports` (endpoint manual + cron nocturno) y no emitía ningún evento — así que el ausente
// conservaba acceso a una habitación que ese mismo flujo libera para revender.
//
// Best-effort: si ttlock no está registrado o la API está caída, el no-show igual se registra
// (el staff puede revocar a mano desde la reserva).
import type { ConnectorContext } from 'arckode-framework'

export function reportsTtlockConnector(ctx: ConnectorContext): void {
  const reports = ctx.resolveModule<{ setLockCodeExpirer(fn: (id: string) => Promise<void>): void }>('reports')
  if (!reports || typeof reports.setLockCodeExpirer !== 'function') return

  reports.setLockCodeExpirer(async (reservationId: string) => {
    try {
      const ttlock = ctx.resolveModule<{ expireCodesByReservation(id: string): Promise<void> }>('ttlock')
      await ttlock?.expireCodesByReservation?.(reservationId)
    } catch {
      // ttlock no registrado o API caída — el no-show ya persistió.
    }
  })
}
