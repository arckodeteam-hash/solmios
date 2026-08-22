// payment-requests/usecases/money-ports.ts — TODO lo que este módulo le pregunta a los dueños
// del dinero, por el connector `payment-requests-money`.
//
// Vive acá (y no inline en service.ts) por la regla GOD_SERVICE del analyzer — mismo patrón que
// `pendingAfterPaymentDeps` en `reservas`: el service wirea, el usecase decide. Fail-closed por
// construcción en TODOS los puertos: contestar defaults sin connector reabre lo que cada uno
// cerró (settledNet → RTC-0.5, liveCharges → el bypass de RTC-8, paidRepos → GH-0.2/STR-A).

import type { ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'
import type { LiveChargesSource } from './charge-ceiling'
import type { SettledNetSource, LiveChargeRowSource, CancelLiveChargeSource } from './clamp-to-ceiling'

/** Lectura reserva → dinero, servida por `folios`/`facturas`/`payments` (STR-A, GH-0.2). */
export interface MoneyPorts {
  paidRepos: ReservationPaidRepos
  /** RTC-7.4 — dinero neto YA asentado a nombre de la reserva, contestado por `payments`. */
  settledNet: SettledNetSource
  /** RTC-8.2 — importe comprometido en sesiones de checkout vivas de la vía charge-card. */
  liveCharges: LiveChargesSource
  /** RTC-8.3 — las filas de esas sesiones y cómo retirarlas, para el clamp. */
  liveChargeRows: LiveChargeRowSource
  cancelLiveCharge: CancelLiveChargeSource
}

const MISSING = 'payment-requests: falta el puerto de dinero (connectors/payment-requests-money no cableado)'

/** Holder fail-closed del puerto de dinero. */
export class MoneyPortsHolder {
  private ports: MoneyPorts | null = null
  set(ports: MoneyPorts): void { this.ports = ports }
  get(): MoneyPorts { if (!this.ports) throw new Error(MISSING); return this.ports }
}
