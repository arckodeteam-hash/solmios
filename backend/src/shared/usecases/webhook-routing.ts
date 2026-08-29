// shared/usecases/webhook-routing.ts — Una sola URL de webhook por hotel, dos flujos de cobro.
//
// El hotel configura UN endpoint en su cuenta de Stripe, pero el sistema cobra por dos caminos con
// handlers distintos: los links de pago (`payment-requests`) y el motor de reservas público
// (`bookingengine`). El evento que aterriza en el handler equivocado no es basura: es un cobro ya
// confirmado que hay que aplicar. Descartarlo con un 200 hace que Stripe lo dé por entregado y no
// reintente — el huésped paga, se le cobra, y la reserva queda `pending` para siempre.
//
// El ruteo se decide por el `metadata` del evento y NO otorga autoridad: quien recibe el reenvío
// vuelve a verificar la firma con el secreto del hotel. Acá el metadata sólo elige a quién
// despertar; que venga manipulado no sirve de nada, porque el destino igual valida.

/** Reenvía un evento ya recibido al handler del otro flujo, que re-verifica la firma. */
export type WebhookForwarder = (hotelId: string, rawBody: string | Buffer, signature: string) => Promise<unknown>

/** A qué flujo pertenece un evento de Stripe, según su metadata. */
export type PaymentFlow = 'payment-request' | 'reservation' | 'unknown'

/**
 * `paymentRequestId` gana sobre `reservationId`: una sesión de link de pago puede llevar los dos
 * (el link se emite CONTRA una reserva), y en ese caso su dueño es el link.
 */
export function flowOfMetadata(metadata: unknown): PaymentFlow {
  const m = (metadata ?? {}) as Record<string, unknown>
  if (typeof m.paymentRequestId === 'string' && m.paymentRequestId) return 'payment-request'
  if (typeof m.reservationId === 'string' && m.reservationId) return 'reservation'
  return 'unknown'
}

/** Igual que `flowOfMetadata`, pero desde el cuerpo crudo. Un body ilegible es `unknown`. */
export function flowOfRawEvent(rawBody: string | Buffer): PaymentFlow {
  try {
    const parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'))
    return flowOfMetadata(parsed?.data?.object?.metadata)
  } catch {
    return 'unknown'
  }
}
