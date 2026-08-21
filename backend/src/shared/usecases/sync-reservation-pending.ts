// shared/usecases/sync-reservation-pending.ts — Mantiene la columna `reservations.pendingAmount`
// alineada con la fórmula única de `shared/utils/reservation-balance.ts`.
//
// `pendingAmount` es una columna PERSISTIDA que consume el listado (`GET /api/reservas`) y el
// planning, mientras que el detalle la recalcula al vuelo. Si sólo se recalcula en el detalle, el
// mismo campo público devuelve dos números distintos según el endpoint. Todo camino que cambie un
// componente del total cobrable (alta/baja de un addon, `otherCharges`, `totalAmount`, `deposit`)
// tiene que pasar por acá.

import type { RepositoryAdapter } from 'arckode-framework'
import { pendingBalance, type ReservationAddonLike } from '../utils/reservation-balance'
import type { PaidSource } from './reservation-paid'

/** Fuente de los addons de una reserva (repo de `ReservationAddons` o `ReservasQueries`). */
/**
 * Fuente de extras de una reserva. `hotelId` viaja EXPLÍCITO (SEC-4): estos importes entran al
 * saldo cobrable, que es el techo del cobro por Stripe, así que la lectura no puede cruzar tenants.
 */
export type AddonSource = (reservationId: string, hotelId: string) => Promise<readonly ReservationAddonLike[]>

/**
 * Recalcula y persiste `pendingAmount` de una reserva. Devuelve el saldo calculado.
 * No escribe si el valor no cambió (evita un UPDATE por cada lectura).
 *
 * `paidOf` (`shared/usecases/reservation-paid`) es OBLIGATORIO y va ANTES del parámetro opcional a
 * propósito (MED-1): es lo que hace que esta columna diga lo MISMO que el detalle y que el techo del
 * cobro — los tres miden "lo pagado" contra `payments`. Cuando era opcional, quitarlo de los cuatro
 * call sites revertía GH-0.2 entero en la columna persistida y la suite seguía en verde: el saldo
 * volvía a calcularse contra `reservations.deposit`, que no incluye lo cobrado por folio ni por
 * factura. Ahora sacarlo no compila, y `tests/sync-reservation-pending.test.ts` lo ejerce con plata
 * que sólo existe en `payments`.
 */
export async function syncReservationPending(
  reservationRepo: RepositoryAdapter<any>,
  addonsOf: AddonSource,
  reservationId: string,
  paidOf: PaidSource,
  reservation?: Record<string, any> | null,
): Promise<number> {
  let res = reservation ?? (await reservationRepo.findById(reservationId) as any)
  if (!res) return 0
  // La fila que pasa el caller puede ser el retorno de un `update` (sólo los campos tocados). Sin
  // `hotelId` no se puede consultar `payments` sin cruzar tenants, así que se recarga entera en vez
  // de calcular el saldo contra datos incompletos (COR-4).
  if (!res.hotelId) res = (await reservationRepo.findById(reservationId) as any) ?? res
  const addons = await addonsOf(reservationId, String(res.hotelId ?? ''))
  const paid = await paidOf(reservationId, res)
  const pending = pendingBalance(res, addons, paid)
  if (Number(res.pendingAmount ?? NaN) !== pending) {
    await reservationRepo.update(reservationId, { pendingAmount: pending } as any)
  }
  return pending
}
