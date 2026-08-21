// shared/usecases/charge-reschedule-diff.ts
// Cobra la diferencia de una reserva reprogramada/extendida según el método elegido (regla del negocio):
//   - folio: hay cuenta abierta → se agrega como cargo (se salda en el checkout).
//   - cash:  sin folio → se cobra en efectivo (entra a caja vía connector payments-caja).
//   - card:  se toma de la tarjeta → Stripe Checkout (el sistema NO cobra off-session a tarjeta guardada).
// El dinero se asienta UNA sola vez por la vía correspondiente; no se orquesta desde el frontend.
//
// BUG-ceiling-bypass: las vías `cash` y `card` crean la fila de `payments` SIN `folioId` ni
// `invoiceId`, que eran los dos únicos caminos por los que `shared/usecases/reservation-paid.ts`
// llegaba de una reserva a su dinero. Esa plata quedaba fuera de "lo cobrado" y el techo de
// `payment-requests/usecases/charge-ceiling.ts` autorizaba recobrarla por Stripe. Por eso las dos
// vías escriben ahora `payments.reservationId` (columna indexada, no `metadata`).

import type { RescheduleChargeParams, RescheduleChargeResult } from '../../modules/reservas/usecases/reschedule'

export async function chargeRescheduleDiff(
  folios: any,
  payments: any,
  params: RescheduleChargeParams,
  user: any,
): Promise<RescheduleChargeResult> {
  const desc = `Cambio de reserva${params.reason ? ` — ${params.reason}` : ''}`

  if (params.method === 'folio') {
    const list = await folios.list({ reservationId: params.reservationId, status: 'open' }, user)
    let folio = list.data?.[0]
    if (!folio) {
      folio = await folios.open({ hotelId: params.hotelId, reservationId: params.reservationId, guestId: params.guestId, roomId: params.roomId, currency: params.currency }, user)
    }
    const charge = await folios.postCharge(folio.id, { amount: params.amount, description: desc, category: 'room', source: 'reschedule' }, user)
    return { method: 'folio', applied: true, target: 'folio', folioId: folio.id, chargeId: charge.id }
  }

  if (params.method === 'cash') {
    const payment = await payments.createPayment({
      hotelId: params.hotelId, type: 'charge', method: 'cash', amount: params.amount,
      currency: params.currency, description: desc, guestId: params.guestId || undefined,
      // `reservationId` es COLUMNA, no sólo metadata (BUG-ceiling-bypass): esta fila no cuelga de
      // ningún folio ni factura, y `shared/usecases/reservation-paid.ts` sólo llegaba a `payments`
      // por esos dos caminos. Con la reserva únicamente en `metadata` (JSON, no filtrable por
      // WHERE) el cobro era invisible para el techo de `payment-requests`, que autorizaba volver a
      // cobrar por Stripe la misma diferencia. La metadata se conserva por el tag `source`.
      reservationId: params.reservationId,
      status: 'completed', metadata: { reservationId: params.reservationId, source: 'reschedule' },
    })
    return { method: 'cash', applied: true, target: 'cash', paymentId: payment.id }
  }

  // card → Stripe Checkout. Si Stripe no está configurado, devuelve applied:false con el motivo
  // (el frontend muestra "cobrar en efectivo/POS"), sin romper el cambio de fechas ya aplicado.
  try {
    const { payment, checkoutUrl } = await payments.chargeCard({
      hotelId: params.hotelId, amount: params.amount, currency: params.currency, description: desc,
      // Mismo motivo que el efectivo: sin la columna, el cobro con tarjeta de la reprogramación no
      // tiene ningún vínculo con la reserva y el techo lo ignora (BUG-ceiling-bypass).
      reservationId: params.reservationId,
      guestId: params.guestId || undefined, successUrl: params.successUrl || '', cancelUrl: params.cancelUrl || '',
    })
    return { method: 'card', applied: true, target: 'card', paymentId: payment.id, checkoutUrl }
  } catch (e: any) {
    return { method: 'card', applied: false, target: 'card', message: e?.message || 'No se pudo generar el cobro con tarjeta' }
  }
}
