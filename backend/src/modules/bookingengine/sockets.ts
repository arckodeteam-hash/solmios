// bookingengine/sockets.ts — Hooks OPCIONALES hacia otros módulos
// Los sockets son opcionales. El módulo funciona sin ellos.

import type { PublicBookingDTO, ConversionEventDTO } from './types'

/** #272 — payload de `onBookingCancelled`. Un grupo (token compartido) emite UN solo evento:
 *  `reservationId` es la líder (la que tiene el pago), `reservationIds` son TODAS las filas
 *  canceladas (líder incluida) y `roomIds` sus habitaciones. Reserva simple: un solo id. */
export interface BookingCancelledEvent {
  reservationId: string
  hotelId: string
  refundAmount: number
  cancellationFee: number
  policyApplied: any
  reservationIds: string[]
  roomIds: string[]
  groupId?: string | null
  promoCode?: string | null
}

export interface BookingengineSockets {
  onBookingCreated?: (data: PublicBookingDTO) => Promise<void>
  /** Stripe confirmó el cobro del widget. Es plata real: tiene que asentarse en `payments`. */
  onBookingPaid?: (data: PublicBookingDTO) => Promise<void>
  /** F4/F5 #627 — Auto-cancelación del huésped: notifica a connectors que reaccionan al
   * reembolso (deposits release/refund). Montos exactos del cálculo para que el connector
   * no tenga que recalcular ni releer la reserva. */
  onBookingCancelled?: (data: BookingCancelledEvent) => Promise<void>
  onConversionEvent?: (event: ConversionEventDTO) => Promise<void>
}
