// connectors/payments-reservas.ts — Todo movimiento de dinero resincroniza el saldo de la reserva.
//
// Hallazgo COR-1 (2026-08-19): `shared/usecases/sync-reservation-pending.ts` sólo lo llamaban las
// mutaciones DE RESERVA. Las mutaciones DE DINERO —`folios.applyPayment`
// (folios/usecases/folio-entries.ts), `facturas.pay` (facturas/usecases/pay-invoice.ts) y el
// settlement del checkout (shared/usecases/settle-folio-at-checkout.ts)— escribían en `payments`
// sin tocar `reservations.pendingAmount`. El listado (`GET /api/reservas`) servía la columna vieja
// mientras `/detail` recalculaba: mismo campo público, dos números.
//
// Se escucha en `payments` y no en cada módulo de origen porque ese es el choke point real: toda
// esa plata nace de `payments.createPayment` (folios-payments, facturas-payments,
// payment-requests-payments) y las devoluciones también (payments/usecases/refund.ts asienta su
// fila `type:'refund'` por el mismo camino).
//
// `onPaymentCreated` cubre el alta; `onRefundProcessed` cubre el cobro original que pasa a
// `refunded`. La resincronización es idempotente (no escribe si el saldo no cambió), así que que
// los dos eventos se pisen no tiene costo.

import type { ConnectorContext } from 'arckode-framework'

interface ReservasModule {
  syncPendingAfterPayment: (row: {
    hotelId?: string | null; folioId?: string | null; invoiceId?: string | null
    reservationId?: string | null
  }) => Promise<number | null>
}

export function paymentsReservasConnector(ctx: ConnectorContext): void {
  const payments = ctx.resolveModule<{ setSockets: (s: Partial<Record<string, unknown>>) => void }>('payments')
  const reservas = ctx.resolveModule<ReservasModule>('reservas')

  // Best-effort: el cobro ya ocurrió (la plata entró). Un fallo acá no puede devolver un error al
  // mostrador — el usecase ya loguea, el `.catch` es la red de contención del socket.
  // `reservationId` es el TERCER vínculo (BUG-ceiling-bypass): el cobro de una reprogramación en
  // efectivo/tarjeta no cuelga de folio ni de factura, así que sin él esa plata entraba a `payments`
  // y el `pendingAmount` de la reserva no se movía.
  // MED-12: fila de `payments` tipada por lo que este resync lee — no `any` a secas.
  const resync = (p?: { hotelId?: string | null; folioId?: string | null; invoiceId?: string | null; reservationId?: string | null }) =>
    reservas.syncPendingAfterPayment({
    hotelId: p?.hotelId, folioId: p?.folioId, invoiceId: p?.invoiceId, reservationId: p?.reservationId,
  }).then(() => {}).catch(() => {})

  payments.setSockets({
    onPaymentCreated: resync,
    onRefundProcessed: resync,
  })
}
