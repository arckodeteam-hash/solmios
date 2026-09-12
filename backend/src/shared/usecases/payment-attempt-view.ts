// shared/usecases/payment-attempt-view.ts — Proyección PURA de `payment_attempts` hacia el
// detalle de la reserva web (REQ-RWP-02): el hotel ve por qué un cobro quedó sin cerrar y salta
// al dashboard del proveedor con un click.
//
// Sin I/O y sin imports de módulos: sólo el TIPO de la fila. Nunca expone el payload crudo del
// proveedor; la fila ya viene acotada a marca + últimos 4 dígitos de la tarjeta.

import type { PaymentAttemptRow, PaymentAttemptKind } from '../../services/payment-gateway/payment-attempts'

/** Lo que el detalle de la reserva puede mostrar de un intento de cobro. */
export interface PaymentAttemptView {
  id: string
  kind: PaymentAttemptKind
  source: string
  provider: string
  mode: 'test' | 'live' | ''
  providerRef: string
  /** Unidades mayores (`amountMinor / 100`, redondeado a 2 decimales). */
  amount: number
  currency: string
  failureCode: string
  failureMessage: string
  cardBrand: string
  cardLast4: string
  receiptUrl: string
  /** Link al pago en el dashboard del proveedor. `''` si no se puede armar. */
  dashboardUrl: string
  occurredAt: string
}

const STRIPE_DASHBOARD = 'https://dashboard.stripe.com'

function str(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/**
 * REQ-RWP-02: link al pago en el dashboard del proveedor.
 *
 * Stripe: `/test/payments/<ref>` en modo test, `/payments/<ref>` en live (o sin modo). Sin
 * `providerRef` no hay a dónde ir. Otros proveedores (azul, cardnet, ...) no tienen deep-link
 * conocido → `''`, y el front no muestra el botón.
 */
export function paymentAttemptDashboardUrl(row: Pick<PaymentAttemptRow, 'provider' | 'mode' | 'providerRef'>): string {
  const ref = str(row?.providerRef).trim()
  if (!ref || str(row?.provider).toLowerCase() !== 'stripe') return ''
  const prefix = row?.mode === 'test' ? '/test' : ''
  return `${STRIPE_DASHBOARD}${prefix}/payments/${encodeURIComponent(ref)}`
}

/** Proyección segura de una fila de `payment_attempts`. Strings faltantes → `''`. */
export function toPaymentAttemptView(row: PaymentAttemptRow & { createdAt?: string }): PaymentAttemptView {
  const minor = Number(row?.amountMinor ?? 0)
  const mode = row?.mode === 'test' || row?.mode === 'live' ? row.mode : ''
  return {
    id: str(row?.id),
    kind: row?.kind,
    source: str(row?.source),
    provider: str(row?.provider),
    mode,
    providerRef: str(row?.providerRef),
    amount: Number.isFinite(minor) ? Math.round(minor) / 100 : 0,
    currency: str(row?.currency),
    failureCode: str(row?.failureCode),
    failureMessage: str(row?.failureMessage),
    cardBrand: str(row?.cardBrand),
    cardLast4: str(row?.cardLast4),
    receiptUrl: str(row?.receiptUrl),
    dashboardUrl: paymentAttemptDashboardUrl(row),
    occurredAt: str(row?.occurredAt || row?.createdAt),
  }
}

/** Proyección + orden (más reciente primero por `occurredAt` || `createdAt`). Tolera `[]` y `null`. */
export function toPaymentAttemptViews(
  rows: readonly (PaymentAttemptRow & { createdAt?: string })[] | null | undefined,
): PaymentAttemptView[] {
  if (!rows?.length) return []
  return [...rows]
    .sort((a, b) => str(b?.occurredAt || b?.createdAt).localeCompare(str(a?.occurredAt || a?.createdAt)))
    .map(toPaymentAttemptView)
}
