// connectors/reservas-wallet.ts — Wallet pass al confirmar la reserva (F3 3.8).
//
// Spec: wallet-pass/spec.md "Generación automática al confirmar". El webhook Stripe confirma
// la reserva → bookingengine emite `onBookingPaid({ id: reservationId })` → este connector
// dispara `walletPassService.generatePass(reservationId)` que orquesta TTLock + Apple + Google
// + persist + email.
//
// Best-effort: try/catch — NO rompe el webhook de confirmación si el pass falla. La reserva
// queda `confirmed` aunque el pass no se haya generado (spec.md "Best-effort, no bloquea
// webhook"). El error se loguea dentro del usecase; aquí re-buffer por si todo el usecase
// crashea (defensa en profundidad).
//
// #262 (REQ-HAC-07): con HAC-01 la reserva nace sin habitación y `generatePass` al pagar no
// puede obtener lockCode (no persiste nada; el cron de pre-llegada manda el pase parcial). Por
// eso también se escucha `reservas.onRoomAssigned`: al asignar la habitación se genera (o
// completa in-place la fila parcial) el pase; el correo lo manda el cron de pre-llegada.
//
// Patrón idéntico a `bookingengine-payments.ts` (que escucha el mismo socket para asentar
// el dinero): setSockets compone, no pisa. La llamamos `reservas-wallet` porque el pass
// conceptualmente pertenece al dominio de reservas (es un artefacto del huésped confirmado),
// aunque el trigger salga de bookingengine.
import type { ConnectorContext } from 'arckode-framework'

type WalletPort = { generatePass(reservationId: string, sendEmail?: boolean): Promise<unknown> }

/**
 * Genera (o completa in-place la fila parcial) el pase de la reserva SIN mandar el correo.
 * `false`: el pase y el PIN de la cerradura se crean AHORA (para que existan), pero el correo
 * con habitación + código NO sale todavía. La habitación puede reasignarse hasta el día antes
 * de la llegada; avisarla al momento de pagar es prometer un número que el hotel aún no puede
 * sostener (pedido del cliente 2026-08-29). Lo manda `prearrival-pass-cron.ts` 24 h antes. Al
 * pagar va el correo de confirmación de pago (`booking-paid-email.ts`), sin habitación ni código.
 *
 * Best-effort: el evento que lo dispara (webhook de pago, asignación) ya hizo su trabajo; el
 * pase es bonus y si falla se reintenta en el próximo trigger. Nunca lanza.
 */
async function generatePassQuietly(ctx: ConnectorContext, reservationId: string | undefined): Promise<void> {
  if (!reservationId) return
  // Promise.resolve().then(...) también atrapa un throw SÍNCRONO (módulo no registrado).
  await Promise.resolve()
    .then(() => ctx.resolveModule<WalletPort>('wallet-pass')?.generatePass?.(reservationId, false))
    .catch(() => undefined)
}

export function reservasWalletConnector(ctx: ConnectorContext): void {
  const bookingengine = ctx.resolveModule<{ setSockets: (s: any) => void }>('bookingengine')
  const reservas = ctx.resolveModule<{ setSockets: (s: any) => void }>('reservas')

  bookingengine.setSockets({
    onBookingPaid: (data: { id?: string } | { id: string }) => generatePassQuietly(ctx, (data as { id?: string })?.id),
  })

  // #262 — al asignar la habitación se genera (o completa) el pase; el correo lo manda el cron
  // de pre-llegada. `setSockets` de reservas ACUMULA (reservas-ttlock también escucha esto).
  // Desasignar (roomId null) no genera nada: sin habitación no hay cerradura.
  reservas.setSockets({
    onRoomAssigned: (data: { reservationId: string; roomId: string | null }) =>
      generatePassQuietly(ctx, data.roomId ? data.reservationId : undefined),
  })
}
