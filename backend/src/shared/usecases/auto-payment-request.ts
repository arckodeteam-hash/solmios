// shared/usecases/auto-payment-request.ts — Auto-request de pago al crear una reserva
// (automation_config.autoPaymentRequest) + rastro de auditoría de sistema para el ciclo de vida.
//
// SEC3-4/COR-E (gate, 3ª ronda): la fila de `payment_requests` la crea el SERVICE del módulo
// dueño, no un `orm.create` directo. El camino crudo era el CUARTO escritor de la tabla y pasaba
// por arriba las tres garantías que `PaymentRequestsService.create` declara obligatorias:
// `assertChargeableAmount` (techo server-side), `withLock(chargeLockKey)` (sección crítica) y
// `assertCeilingAfterCommit` (compensación anti-carrera). Además leía `PaymentRequests` SIN
// `hotelId`. El dedup ("ya hay un pending") ahora lo hace el propio techo agregado: si existe un
// link vivo, el saldo comprometido se descuenta y el alta se deniega sola.
import { safeParse } from '../utils/safe-parse'
import { pendingBalance } from '../utils/reservation-balance'

/** Lo que este usecase necesita del módulo dueño del cobro (connector reservas-payment-requests). */
export interface PaymentRequestsCreator {
  create(dto: { hotelId?: string; reservationId: string; amount: number; currency?: string }, user: { id: string; role: string; hotelId?: string }): Promise<unknown>
}

export async function handleReservationCreated(orm: any, r: any, paymentRequests?: PaymentRequestsCreator): Promise<void> {
  orm.create('Auditlog', {
    id: crypto.randomUUID(), hotelId: r.hotelId || null, entity: 'Reservations', entityId: r.id, action: 'create',
    userId: null, userName: 'system (auto)', detail: JSON.stringify({ status: r.status, totalAmount: r.totalAmount, roomId: r.roomId }),
  }).catch(() => {})
  try {
    const cfg = (await orm.findMany('Configuration', { hotelId: r.hotelId, key: 'automation_config' }))[0] as any
    const auto = cfg ? safeParse(cfg.value) : {}
    if (!auto?.autoPaymentRequest) return
    // Sin service del módulo dueño no hay garantías que ofrecer: mejor no crear el link que
    // crearlo por fuera del techo (fail-closed, mismo criterio que `requireMoneyPort`).
    if (!paymentRequests?.create) return
    // Mismo criterio que el detalle y el webhook (`shared/utils/reservation-balance`): total
    // cobrable menos lo ya pagado. Acá se resuelve SIN consultar `reservation_addons`: el hook
    // corre en el alta de la reserva, donde por definición todavía no hay extras cargados —
    // ir a la DB por una lista que siempre viene vacía es un roundtrip por cada reserva creada.
    // `otherCharges` sí puede venir en el POST y la fórmula lo contempla.
    const pending = pendingBalance(r)
    if (pending <= 0) return
    await paymentRequests.create(
      { hotelId: r.hotelId, reservationId: r.id, amount: pending, currency: r.currency || 'USD' },
      // Actor de sistema: lo dispara el alta, no un usuario del panel.
      { id: 'system', role: 'super_admin', hotelId: r.hotelId },
    )
  } catch {
    // fire-and-forget
  }
}

export async function handleReservationUpdated(orm: any, r: any): Promise<void> {
  orm.create('Auditlog', {
    id: crypto.randomUUID(), hotelId: r.hotelId || null, entity: 'Reservations', entityId: r.id, action: 'update',
    userId: null, userName: 'system (auto)', detail: JSON.stringify({ status: r.status, totalAmount: r.totalAmount }),
  }).catch(() => {})
}

export async function handleReservationDeleted(orm: any, id: string): Promise<void> {
  orm.create('Auditlog', {
    id: crypto.randomUUID(), hotelId: null, entity: 'Reservations', entityId: id, action: 'delete',
    userId: null, userName: 'system (auto)', detail: null,
  }).catch(() => {})
}
