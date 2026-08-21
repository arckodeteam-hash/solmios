// connectors/reservas-money.ts — `reservas` lee el dinero de una reserva SIN tocar tablas ajenas.
//
// Regla del proyecto (CLAUDE.md): un módulo no importa ni consulta a otro directo — va por
// conector. `reservas/usecases/reservas-queries.ts` la violaba justo en el camino del dinero: su
// getter `paidRepos` hacía `orm.findMany('Folios')`, `orm.findMany('Invoices')` y
// `orm.findMany('Payment')`, tres tablas de tres módulos ajenos, mientras
// `reservas/usecases/message-log.ts` escribía la regla textual en el mismo diff.
//
// Acá sólo se wirea: la lectura la hacen los dueños (`folios`/`facturas`/`payments`, cada uno en su
// `usecases/reservation-money.ts`) y el puerto lo arma `buildReservationMoneyPort`.

import type { ConnectorContext } from 'arckode-framework'
import { buildReservationMoneyPort, type MoneyOwners, type ReservationMoneyPort } from '../modules/reservas/usecases/money-port'

interface ReservasModule {
  setOrchestrationDeps(deps: { moneyPort: ReservationMoneyPort }): void
}

export function reservasMoneyConnector(ctx: ConnectorContext): void {
  const owners: MoneyOwners = {
    folios: ctx.resolveModule<MoneyOwners['folios']>('folios'),
    facturas: ctx.resolveModule<MoneyOwners['facturas']>('facturas'),
    payments: ctx.resolveModule<MoneyOwners['payments']>('payments'),
  }
  ctx.resolveModule<ReservasModule>('reservas').setOrchestrationDeps({ moneyPort: buildReservationMoneyPort(owners) })
}
