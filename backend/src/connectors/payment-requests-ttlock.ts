// connectors/payment-requests-ttlock.ts — Genera el código de cerradura TTLock al pagarse la seña.
//
// Estilo MisterPlan: cuando el huésped paga el Link de Pago de la seña (evento `onPaymentRequestPaid`,
// emitido por el webhook de Stripe tras asentar el cobro y garantizar la reserva), se emite el PIN de
// acceso automáticamente — sin depender de que alguien toque el botón manual (que sigue existiendo).
//
// El connector solo DELEGA: resuelve `ttlock` y llama a `generateCodeIfAbsent` (la idempotencia y la
// generación viven en el service, no acá). No importa el módulo directo.
//
// #258 (REQ-HAC-03): la reserva puede pagarse SIN habitación asignada (se asigna al check-in). En
// ese caso no hay cerradura que programar: se loguea y sale con 0 códigos — el PIN lo genera
// `reservas-ttlock` al dispararse `onRoomAssigned` (la reserva ya figura pagada para entonces).

import type { ConnectorContext, Logger } from 'arckode-framework'

interface TtlockModule {
  generateCodeIfAbsent: (hotelId: string, reservationId: string) => Promise<unknown>
}

interface ReservasModule {
  getById: (id: string, user: { id: string; role: string; hotelId?: string }) => Promise<{ roomId?: string | null } | null>
}

interface PaymentRequestPaid {
  hotelId?: string
  reservationId?: string
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))
/** `resolveModule` tira si el módulo no está registrado en este despliegue. */
function resolveOptional<T>(ctx: ConnectorContext, name: string): T | null {
  try { return ctx.resolveModule<T>(name) } catch { return null }
}

/**
 * ¿La reserva ya tiene habitación? Sin `roomId` no hay cerradura que programar. Si el módulo
 * reservas no resuelve (despliegue parcial / test aislado) no se bloquea: ttlock decide solo.
 */
async function hasRoomAssigned(ctx: ConnectorContext, hotelId: string, reservationId: string): Promise<boolean> {
  const reservas = resolveOptional<ReservasModule>(ctx, 'reservas')
  const res = await reservas?.getById(reservationId, { id: 'system-connector', role: 'super_admin', hotelId })
  return reservas ? Boolean(res?.roomId) : true
}

async function generateForPaidReservation(ctx: ConnectorContext, log: Logger, hotelId: string, reservationId: string): Promise<void> {
  const hasRoom = await hasRoomAssigned(ctx, hotelId, reservationId)
  if (!hasRoom) {
    log.info(`Reserva ${reservationId} pagada sin habitación asignada: el código se genera al asignar (onRoomAssigned)`)
    return
  }
  await ctx.resolveModule<TtlockModule>('ttlock').generateCodeIfAbsent(hotelId, reservationId)
}

export function paymentRequestsTtlockConnector(logger: Logger): (ctx: ConnectorContext) => void {
  const log = logger.child('payment-requests-ttlock')
  return (ctx: ConnectorContext) => {
    const paymentRequests = ctx.resolveModule<{ setSockets: (s: Record<string, unknown>) => void }>('payment-requests')
    paymentRequests.setSockets({
      onPaymentRequestPaid: (pr: PaymentRequestPaid): Promise<void> => {
        if (!pr?.hotelId || !pr?.reservationId) return Promise.resolve()
        // Un fallo acá NO puede tumbar el webhook: si el handler tira, Stripe devuelve 500 y reintenta
        // en loop. Casos esperados que solo se loguean: ttlock no registrado en este despliegue, la
        // habitación sin cerradura asignada, o el hotel sin TTLock conectado.
        return generateForPaidReservation(ctx, log, pr.hotelId, pr.reservationId).then(
          () => undefined,
          (e: unknown) => log.info(`No se generó código TTLock para la reserva ${pr.reservationId}: ${errMsg(e)}`),
        )
      },
    })
  }
}
