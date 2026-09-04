import { NotFoundError, AuthError } from 'arckode-framework'
import type { ReservasQueries } from './reservas-queries'
import { addonsTotal, chargeableTotal, pendingBalance, creditBalance } from '../../../shared/utils/reservation-balance'
import { paidForReservation } from '../../../shared/usecases/reservation-paid'
import { reservationPaymentHistory, type PaymentHistoryEntry } from '../../../shared/usecases/reservation-payment-history'
import { toMessageLogViews, type MessageLogSource } from './message-log'

export async function getExtendedDetail(
  repo: any, guestRepo: any, roomRepo: any, queries: ReservasQueries, id: string, currentUser: any,
  /** Puerto al módulo marketing (dueño de `message_logs`). OBLIGATORIO: sin él el historial mentiría. */
  listMessageLogs: MessageLogSource,
  /** Repo `Users` — resuelve quién registró cada cobro. Opcional: sin él el nombre va vacío. */
  userRepo?: { findMany(filter: Record<string, unknown>): Promise<any[]> },
): Promise<any> {
  const r = await repo.findById(id) as any
  if (!r) throw new NotFoundError('Reserva no encontrada')
  const hid = currentUser?.hotelId
  if (currentUser?.role !== 'super_admin' && r.hotelId !== hid) throw new AuthError('No autorizado')
  const [guest, room, companions, lockCodes, payments, addons, messageLogs] = await Promise.all([
    r.guestId ? guestRepo.findById(r.guestId) : Promise.resolve(null),
    r.roomId ? roomRepo.findById(r.roomId) : Promise.resolve(null),
    queries.getCompanions(r.id),
    queries.getLockCodes(r.id),
    // SEC3-6: con el hotel de la reserva, nunca sólo por `reservationId` (multi-tenancy).
    queries.getPaymentRequests(r.id, r.hotelId),
    // SEC-4: los extras se leen SIEMPRE con el hotel de la reserva, nunca sólo por `reservationId`.
    queries.getReservationAddons(r.id, r.hotelId),
    // La tarjeta "Envíos registrados" del modal leía `messageLogs` y el detalle NUNCA lo devolvía:
    // salía siempre vacía aunque los auto-messages sí escribieran en `message_logs`. Se pide por el
    // PUERTO del conector, no leyendo la tabla de otro módulo (STR-3).
    listMessageLogs(r.hotelId, r.id),
  ])
  // Lo COBRADO sale de `payments` (GH-0.2), no de `reservations.deposit`: un pago en efectivo por
  // folio o factura no toca `deposit`, y este mismo número es el techo que autoriza el cobro por
  // Stripe (`payment-requests/usecases/charge-ceiling.ts`). Si el modal y el techo no midieran lo
  // mismo, el operador vería "Pendiente $500" sobre una reserva con $300 ya cobrados.
  const paid = await paidForReservation(queries.paidRepos, r.hotelId, r.id, r)
  // Historial de cobros de ESTA reserva (pedido del cliente 2026-08-30): la vista mostraba un
  // total "Pagado" sin decir por dónde entró la plata. Sale de la MISMA recolección que `paid`,
  // así el desglose cuadra con el número de arriba. Best-effort: un fallo acá no puede tumbar
  // el detalle entero de la reserva.
  let paymentHistory: PaymentHistoryEntry[] = []
  try {
    const history = await reservationPaymentHistory(
      { ...queries.paidRepos, userRepo }, r.hotelId, r.id,
    )
    paymentHistory = history.entries
  } catch {
    // Se devuelve vacío: el modal muestra "sin movimientos" en vez de romperse.
  }
  const CARD_FIELDS = ['cardHolder', 'cardBrand', 'cardLast4', 'cardExpMonth', 'cardExpYear']
  const safeReservation = Object.fromEntries(Object.entries(r).filter(([k]) => !CARD_FIELDS.includes(k)))
  // El total cobrable es UNO solo: alojamiento + otros cobros + extras (shared/utils/reservation-balance).
  // Antes acá se calculaba `totalAmount - deposit` a mano y se ignoraban addons/otherCharges, así que
  // el renglón "Pendiente de cobro" del modal y el monto de la Checkout Session de Stripe cobraban de menos.
  return {
    ...safeReservation,
    hasGuaranteeCard: !!(r.hasGuaranteeCard || r.cardLast4),
    guest: guest || null, room: room || null, companions, lockCodes, payments, addons,
    // `response` NO sale del módulo marketing: se proyecta (ver message-log.ts).
    messageLogs: toMessageLogViews(messageLogs as Record<string, any>[]),
    checkinCode: String(r.id).replace(/-/g, '').slice(0, 12),
    addonsTotal: addonsTotal(addons),
    chargeableTotal: chargeableTotal(r, addons),
    pendingAmount: pendingBalance(r, addons, paid),
    /**
     * Lo que el huésped pagó DE MÁS. `pendingAmount` recorta en 0, así que sin este campo un
     * excedente se ve idéntico a una reserva saldada: quien pagó $210 por una estadía que después
     * bajó a $195 quedaba en "Pendiente: 0" y los $15 no aparecían en ninguna pantalla.
     */
    creditAmount: creditBalance(r, addons, paid),
    /** Lo ya cobrado según `payments` (GH-0.2). El modal lo muestra junto al pendiente. */
    paidAmount: paid,
    /** Movimientos de dinero de la reserva: cobros y devoluciones, con método y referencia. */
    paymentHistory,
  }
}

export async function getAuditTrail(repo: any, queries: ReservasQueries, id: string, currentUser: any): Promise<any[]> {
  const r = await repo.findById(id) as any
  if (!r) throw new NotFoundError('Reserva no encontrada')
  const hid = currentUser?.hotelId; const role = currentUser?.role
  if (role !== 'super_admin' && r.hotelId !== hid) throw new AuthError('No autorizado')
  const logs = await queries.getAuditLogs('Reservations', id)
  return logs.filter((l: any) => role === 'super_admin' || l.hotelId === r.hotelId || l.hotelId === 'unknown').sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}
