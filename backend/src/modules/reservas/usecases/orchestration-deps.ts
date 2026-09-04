// reservas/usecases/orchestration-deps.ts — Puertos cross-módulo que le inyecta el
// composition-root a través de los connectors de `src/connectors/`.
//
// Vive fuera del service (que es una fachada y tiene su límite de tamaño en el analyzer) porque es
// un TIPO, no comportamiento: la lista de todo lo que reservas necesita de otros módulos sin
// importarlos. Cada campo es opcional a propósito — el módulo tiene que arrancar aunque el
// connector que lo cablea esté desactivado.

import type { SettleFolioPort } from './settle-port'
import type { RescheduleChargePort, RescheduleCreditPort } from './reschedule'
import type { PromoCodePort } from './crud'
import type { ReservationMoneyPort } from './money-port'
import type { PaymentRequestsCeilingPort } from './ceiling-guard'

export interface ReservasOrchestrationDeps {
  pushAvailabilityToChannex?: (hotelId: string, roomId: string) => void
  sendCheckinEmail?: (deps: any, data: any) => Promise<void>
  dispatchLifecycleEmail?: (deps: any, data: any) => Promise<void>
  /** Ver `usecases/settle-port.ts` — el actor va TIPADO: `any` acá reabre el agujero de DEBT-1. */
  settleFolio?: SettleFolioPort
  chargeReschedule?: RescheduleChargePort
  /** connectors/reservas-reschedule-charge.ts — qué se hace con lo que el huésped pagó de más. */
  creditReschedule?: RescheduleCreditPort
  promoCodes?: PromoCodePort // FIX 2026-07-31 — connectors/reservas-promocodes.ts
  /** STR-3 — connectors/reservas-marketing.ts: `message_logs` es del módulo marketing. */
  listMessageLogs?: (hotelId: string, reservationId: string) => Promise<Record<string, any>[]>
  moneyPort?: ReservationMoneyPort // connectors/reservas-money.ts (tablas de otros módulos)
  /** SEC3-2/SEC3-3/RTC-8.7 (connectors/reservas-payment-requests.ts): clamp/liberación de links vivos. */
  paymentRequestsCeiling?: PaymentRequestsCeilingPort
}
