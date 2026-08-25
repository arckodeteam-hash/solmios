// reservas/usecases/ceiling-guard.ts — RTC-8.7/8.8: guards del techo de cobro para el service.
//
// Vive acá (y no inline en service.ts) por la regla GOD_SERVICE del analyzer: el service wirea,
// el usecase decide — mismo patrón que `pendingAfterPaymentDeps`. Fail-closed en ambos usos:
// devolver un guard `undefined` cuando el connector no está cableado dejaba el alta/baja de
// extras sin recorte (RTC-8.8) y la cancelación sin expirar sesiones (RTC-8.7) — en silencio.

/** Lo que `connectors/reservas-payment-requests` cablea en `orchestrationDeps`. */
export interface PaymentRequestsCeilingPort {
  clamp(hotelId: string, reservationId: string): Promise<void>
  releaseAll(hotelId: string, reservationId: string): Promise<void>
  /** RTC-8.7 — expira sesiones abiertas al CANCELAR (sin el 409 del borrado por plata asentada). */
  releaseForCancel(hotelId: string, reservationId: string): Promise<void>
}

/** Guard fail-closed de un op del puerto: sin connector tira fuerte, nunca ausente en silencio. */
export function ceilingGuardOf(port: PaymentRequestsCeilingPort | undefined, op: 'clamp' | 'releaseForCancel') {
  const fn = port?.[op]
  if (!fn) throw new Error('reservas: falta el puerto del techo de cobro (connectors/reservas-payment-requests no cableado)')
  return fn
}
