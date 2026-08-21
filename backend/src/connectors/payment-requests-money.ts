// connectors/payment-requests-money.ts — `payment-requests` lee el dinero de una reserva SIN
// abrir repos de tablas ajenas.
//
// STR-A (gate, 3ª ronda): el mismo diff que sacaba de `reservas` la lectura cruda de
// `invoices`/`payments` (connectors/reservas-money.ts) la AGREGABA acá — dos arquitecturas
// contradictorias para el mismo camino reserva→dinero. Ahora el techo del cobro
// (usecases/charge-ceiling.ts) y el bridge del webhook (usecases/stripe-webhook.ts) consumen el
// MISMO puerto que `reservas`, armado por los módulos dueños.
//
// Acá sólo se wirea: la lectura la hacen `folios`/`facturas`/`payments` (cada uno en su
// usecases/reservation-money.ts) y el shim `RepositoryAdapter` lo arma `paidReposFrom`.

import type { ConnectorContext } from 'arckode-framework'
import { buildReservationMoneyPort, paidReposFrom, type MoneyOwners } from '../modules/reservas/usecases/money-port'

interface PaymentRequestsModule {
  setMoneyDeps(deps: { paidRepos: ReturnType<typeof paidReposFrom> }): void
}

export function paymentRequestsMoneyConnector(ctx: ConnectorContext): void {
  const owners: MoneyOwners = {
    folios: ctx.resolveModule<MoneyOwners['folios']>('folios'),
    facturas: ctx.resolveModule<MoneyOwners['facturas']>('facturas'),
    payments: ctx.resolveModule<MoneyOwners['payments']>('payments'),
  }
  ctx.resolveModule<PaymentRequestsModule>('payment-requests')
    .setMoneyDeps({ paidRepos: paidReposFrom(buildReservationMoneyPort(owners)) })
}
