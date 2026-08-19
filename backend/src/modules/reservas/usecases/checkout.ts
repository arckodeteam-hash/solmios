// reservas/usecases/checkout.ts — Ejecución del check-OUT con guard de carrera (R-1).
//
// Extraído del service (237 líneas → God Object según analyzer). Mismo lugar que su espejo
// `executeCheckin` (usecases/checkin.ts): la casa del flujo de check-out es el usecase.
//
// R-1 (auditoría 2026-08-19): el check-in tenía guard CAS contra la carrera; el check-OUT
// no — dos checkouts concurrentes (doble click / dos recepcionistas) pasaban AMBOS la
// validación (status aún checked_in al leer), corrían el settlement cada uno (doble folio →
// doble pago → doble factura) y ambos escribían el estado. El claim condicional es el mismo
// patrón que executeCheckin: solo UNA transición logra mover checked_in → checked_out; la
// otra ve affected=0 y aborta con 409 antes de tocar nada.
//
// El controller corre esto ANTES del settlement (orden invertido al histórico): si el
// settlement falla después, la reserva queda checked_out con folio open y el staff factura
// desde /panel/billing; lo inverso (settle OK + estado sin mover → reintento cobra de nuevo)
// era el escenario de plata.
import { ConflictError } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import type { ReservasSockets } from '../sockets'

/** Centinela: otro checkout ganó la carrera → se traduce a ConflictError (409) afuera. */
export class AlreadyCheckedOutError extends Error {
  constructor() { super('already_checked_out'); this.name = 'AlreadyCheckedOutError' }
}

/** Lectura mínima de la reserva que este usecase necesita (llega validada por checkoutValidation). */
interface CheckoutReservation {
  id: string
  hotelId: string
  roomId: string
  status: string
  guestId?: string | null
  checkIn?: string
  checkOut?: string
  totalAmount?: number | string
}

/** Transacción ORM usada acá: claim CAS vía updateMany, o re-lectura si el ORM no lo expone. */
interface CheckoutTx {
  updateMany?: (model: string, filters: Record<string, unknown>, changes: Record<string, unknown>) => Promise<number>
  findOne?: (model: string, filters: Record<string, unknown>) => Promise<CheckoutReservation | null>
  update: (model: string, id: string, changes: Record<string, unknown>) => Promise<unknown>
}

export interface CheckoutUsecaseDeps {
  orm: { transaction(fn: (tx: CheckoutTx) => Promise<void>): Promise<void> }
  queries: { createAuditLog: (entry: { id: string; entity: string; entityId: string; action: string; userId: string; hotelId: string; detail: string; createdAt: string }) => Promise<void> }
  sockets: ReservasSockets
  logger: Logger
}

export async function executeCheckout(
  r: CheckoutReservation,
  user: { id: string },
  deps: CheckoutUsecaseDeps,
): Promise<{ ok: boolean; reservationId: string; status: string }> {
  const nowIso = new Date().toISOString()
  // Con el estado que la validación dejó pasar — contra esto se reclama la reserva.
  const expectedStatus = r.status
  // Sin orm no hay claim CAS: el guard anti doble-cobro quedaría APAGADO en silencio si se
  // degradara a un update ciego (mismo criterio que checkin.ts, que no tiene tercer camino).
  if (!deps.orm || typeof deps.orm.transaction !== 'function') {
    throw new Error('executeCheckout requiere orm con transaction: sin claim CAS no hay guard anti doble-cobro (R-1)')
  }
  try {
    await deps.orm.transaction(async (tx) => {
      if (typeof tx.updateMany === 'function') {
        const claimed = await tx.updateMany(
          'Reservations',
          { id: r.id, status: expectedStatus },
          { status: 'checked_out', checkedOutAt: nowIso },
        )
        if (claimed === 0) throw new AlreadyCheckedOutError()
      } else {
        // ORM/mocks sin updateMany: re-lectura (degradación, mismo criterio que checkin).
        const fresh = await tx.findOne?.('Reservations', { id: r.id }).catch(() => null)
        if (fresh && fresh.status !== expectedStatus) throw new AlreadyCheckedOutError()
        await tx.update('Reservations', r.id, { status: 'checked_out', checkedOutAt: nowIso })
      }
    })
  } catch (e) {
    if (e instanceof AlreadyCheckedOutError) throw new ConflictError('La reserva ya tiene check-out')
    throw new Error(`Error interno al procesar check-out: ${e instanceof Error ? e.message : String(e)}`)
  }
  deps.queries.createAuditLog({ id: crypto.randomUUID(), entity: 'Reservations', entityId: r.id, action: 'checkout', userId: user.id, hotelId: r.hotelId, detail: JSON.stringify({ roomId: r.roomId, guestId: r.guestId, checkIn: r.checkIn, checkOut: r.checkOut }), createdAt: nowIso })
  // Los sockets son OPCIONALES por contrato del módulo, y el settlement corre DESPUÉS en el
  // controller: un conector que tire acá (housekeeping, ttlock, CRM) no puede convertir el
  // checkout en un 500 post-claim con el cobro salteado — se degrada a warning con telemetría.
  try {
    await deps.sockets.onReservationCheckedOut?.({ reservationId: r.id, roomId: r.roomId, hotelId: r.hotelId, guestId: r.guestId ?? null, totalAmount: Number(r.totalAmount) || 0 })
  } catch (e) {
    deps.logger.warn('checkout: conector post-checkout falló (la reserva YA quedó checked_out)', { reservationId: r.id, error: e instanceof Error ? e.message : String(e) })
  }
  return { ok: true, reservationId: r.id, status: 'checked_out' }
}
