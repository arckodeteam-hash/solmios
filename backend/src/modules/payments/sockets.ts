// payments/sockets.ts — Hooks hacia otros módulos

import type { PaymentDTO, PaymentLinkDTO, DepositDTO } from './types'

export interface PaymentsSockets {
  onPaymentCreated?: (data: PaymentDTO) => Promise<void>
  onPaymentCompleted?: (data: PaymentDTO) => Promise<void>
  // fix-refund-pos-card: la Checkout Session expiró (checkout.session.expired) sin que se completara
  // el pago. Simétrico a onPaymentCompleted — lo escucha restaurante-payments para revertir la orden.
  onPaymentExpired?: (data: PaymentDTO) => Promise<void>
  onPaymentFailed?: (data: PaymentDTO) => Promise<void>
  onRefundProcessed?: (data: PaymentDTO) => Promise<void>
  onDepositCreated?: (data: DepositDTO) => Promise<void>
  /** Reembolso parcial/total del depósito (ver `DepositsUseCase.refund`) — distinto de `onDepositReleased`. */
  onDepositRefunded?: (data: DepositDTO) => Promise<void>
  onDepositReleased?: (data: DepositDTO) => Promise<void>
  onLinkUsed?: (data: PaymentLinkDTO) => Promise<void>
}

/**
 * Bindings de `settle-webhook`: cada estado terminal del proveedor a su socket. El service
 * arma sus deps con esto (GOD_SERVICE: el wiring repetido crecía el facade).
 */
export function settleHooks(sockets: PaymentsSockets) {
  return {
    onCompleted: (p: PaymentDTO) => sockets.onPaymentCompleted?.(p) ?? Promise.resolve(),
    onExpired: (p: PaymentDTO) => sockets.onPaymentExpired?.(p) ?? Promise.resolve(),
    onFailed: (p: PaymentDTO) => sockets.onPaymentFailed?.(p) ?? Promise.resolve(),
  }
}
