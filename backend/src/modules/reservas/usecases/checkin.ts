import { NotFoundError, AuthError, ConflictError } from 'arckode-framework'
import { prepaidLinesFrom, depositOnlyPrepaid, depositPrepaidLine, capPrepaidLines, type PrepaidLine } from '../../../shared/usecases/prepaid-folio-lines'

/**
 * Tasa de impuesto del hotel, para el cargo automático de habitación al check-in.
 *
 * Copia local y no un import de facturas/folios: `reservas` no puede importar otro módulo
 * directo (regla del proyecto — conectores, no imports cruzados), y esta lógica es sencilla.
 * Mismo fallback que facturas/usecases/billing.ts y folios/usecases/folio-math.ts: antes este
 * cargo se posteaba con `taxes: 0` fijo, así que el balance del folio arrancaba sin impuesto
 * desde el primer cargo, ya en el check-in — no era solo un problema de la factura final.
 */
async function taxRateForCheckin(orm: any, hotelId: string): Promise<number> {
  try {
    const rows = await orm.findMany('Configuration', { hotelId, key: 'taxes' })
    const arr: any[] = rows?.[0]?.value ?? []
    const configured = arr.filter((t: any) => t && (t.activo ?? t.active)).reduce((s: number, t: any) => s + Number(t.tasa ?? t.rate ?? 0), 0)
    if (configured > 0) return configured
  } catch { /* cae al fallback */ }
  try {
    const hotel = (await orm.findMany('Hotels', { id: hotelId }))?.[0]
    return Number(hotel?.taxRate) || 0
  } catch {
    return 0
  }
}

export async function checkinValidation(repo: any, id: string, user: any, auth?: any): Promise<any> {
  const hotelId = user?.hotelId
  const r = await repo.findById(id) as any
  if (!r) throw new NotFoundError('Reserva no encontrada')
  if (user.role !== 'super_admin' && r.hotelId !== hotelId) throw new AuthError('No autorizado')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings. Pasarle objetos
  // hace que la comparación `===` nunca dé true y lanza Forbidden SIEMPRE: el check-in quedaba muerto.
  if (auth) auth.assertOwnership(r.hotelId, hotelId, user.role, 'super_admin')
  if (r.status === 'checked_in') throw new ConflictError('La reserva ya tiene check-in')
  if (!['confirmed', 'pending'].includes(r.status)) throw new ConflictError(`No se puede hacer check-in de una reserva ${r.status}`)
  return { reservation: r, hotelId: r.hotelId }
}

export async function checkoutValidation(repo: any, id: string, user: any, auth?: any): Promise<any> {
  const hotelId = user?.hotelId
  const r = await repo.findById(id) as any
  if (!r) throw new NotFoundError('Reserva no encontrada')
  if (user.role !== 'super_admin' && r.hotelId !== hotelId) throw new AuthError('No autorizado')
  if (auth) auth.assertOwnership(r.hotelId, hotelId, user.role, 'super_admin')
  if (r.status !== 'checked_in') throw new ConflictError(`Solo se puede hacer check-out de una reserva con check-in (actual: ${r.status})`)
  return { reservation: r, hotelId: r.hotelId }
}

/**
 * Centinela para abortar cuando otro check-in ganó la carrera. Se traduce a ConflictError afuera
 * de la transacción (el catch genérico de abajo convertiría cualquier throw en un 500 opaco).
 */
class AlreadyCheckedInError extends Error {
  constructor() { super('already_checked_in'); this.name = 'AlreadyCheckedInError' }
}

export async function executeCheckin(r: any, user: any, deps: {
  orm: any; logger: any; repo: any; queries?: any
}): Promise<any> {
  const nowIso = new Date().toISOString()
  // Se fija ACÁ, antes del primer `await`: es el estado con el que entramos y contra el que se
  // reclama la reserva más abajo. Leerlo dentro de la transacción sería tarde — si el objeto
  // que nos pasaron es compartido, para entonces ya podría haberlo mutado el check-in rival.
  const expectedStatus = r.status
  let guestId = r.guestId
  let folioId = ''

  const room = (await deps.orm.findMany('Rooms', { id: r.roomId }))[0] as any
  const roomRate = Number(room?.basePrice || r.totalAmount || 0)

  // Lo que el huésped YA pagó (motor web / link de pago) y todavía no está en ningún folio.
  // El folio no existe hasta este momento, así que ese cobro quedaba fuera: el folio nacía
  // diciendo que se debía todo, y el settlement del checkout facturaba contra el folio → se
  // cobraba dos veces (reporte de cliente 2026-08-30, reproducido en producción).
  // Se lee ACÁ, fuera de la transacción: el puerto de dinero es de otro módulo.
  let prepaid: PrepaidLine[] = []
  try {
    const repos = deps.queries?.paidRepos
    if (repos?.paymentRepo) {
      const rows = await repos.paymentRepo.findMany({ hotelId: r.hotelId, reservationId: r.id })
      prepaid = prepaidLinesFrom(rows as any[])
      // El anticipo cargado a mano en el alta vive SOLO en `reservations.deposit` y no deja fila
      // en `payments`, así que la línea de arriba no lo ve: el folio nacía diciendo que el huésped
      // debía todo aunque ya hubiera pagado. Se descuenta lo que ya espejan los cobros de Stripe.
      const linea = depositPrepaidLine(r.id, depositOnlyPrepaid((r as any).deposit, rows as any[]))
      if (linea) prepaid.push(linea)
    }
  } catch (e: any) {
    // Best-effort: sin esto el check-in igual procede. El pago sigue en `payments` y el
    // historial de la reserva lo muestra; lo que se pierde es el reflejo en el folio.
    deps.logger?.warn?.('checkin: no se pudieron leer los pagos anticipados', { reservationId: r.id, error: e?.message })
  }
  const checkInDate = String(r.checkIn).slice(0, 10)
  const taxRate = await taxRateForCheckin(deps.orm, r.hotelId)
  const roomTax = Math.round((roomRate * taxRate / 100 + Number.EPSILON) * 100) / 100

  try {
    await deps.orm.transaction(async (tx: any) => {
      // ─── Anti doble cobro ────────────────────────────────────────────────────────────────
      // `checkinValidation` rechaza una reserva ya `checked_in`, pero eso pasa en OTRA función y
      // FUERA de esta transacción. Dos check-in concurrentes (doble click del recepcionista, dos
      // personas en el mostrador, un reintento del cliente) pasaban los dos: se creaban DOS
      // folios y DOS cargos de habitación — el huésped terminaba con la estadía cargada dos
      // veces. Reproducido con un harness concurrente: 2 folios, 2 cargos, total 200 en vez de 100.
      //
      // El UPDATE condicional es el guardián: solo una transacción logra mover la reserva de
      // `confirmed|pending` a `checked_in`. La otra ve `affected = 0` y aborta sin escribir nada.
      // Se hace ANTES de crear folio y cargos, así el rollback no depende del motor.
      if (typeof tx.updateMany === 'function') {
        const claimed = await tx.updateMany(
          'Reservations',
          { id: r.id, status: expectedStatus },
          { status: 'checked_in', checkedInAt: nowIso },
        )
        if (claimed === 0) throw new AlreadyCheckedInError()
      } else {
        const fresh = await tx.findOne?.('Reservations', { id: r.id }).catch(() => null)
        if (fresh && (fresh.status === 'checked_in' || fresh.folioId)) throw new AlreadyCheckedInError()
      }

      // La estadía se cuenta UNA vez, en el checkout (`CrmService.onCheckoutComplete`), donde también
      // se suma `totalSpent`. Acá se contaba de nuevo: cada huésped sumaba +2 estadías por visita,
      // inflando el `tier` y falseando el `avgPerStay` del LTV (totalSpent / totalStays).
      if (!guestId) {
        const guestName = r.externalLocator ? `Pasajero ${r.externalLocator}` : 'Pasajero walk-in'
        const guest = await tx.create('Guests', { id: crypto.randomUUID(), name: guestName, hotelId: r.hotelId, active: 1, totalStays: 0, totalSpent: 0, tier: 'bronze', notes: r.otaNotes || null }) as any
        guestId = guest.id
      }
      folioId = crypto.randomUUID()
      await tx.create('Folios', { id: folioId, hotelId: r.hotelId, reservationId: r.id, guestId, roomId: r.roomId, status: 'open', currency: r.currency || 'USD', invoiceId: null, openedAt: nowIso, closedAt: null })
      if (roomRate > 0) {
        await tx.create('FolioCharges', {
          id: crypto.randomUUID(), folioId, hotelId: r.hotelId,
          description: `Habitación ${room?.number || ''} — ${checkInDate}`,
          category: 'room', kind: 'charge', quantity: 1,
          amount: roomRate, taxes: roomTax, total: roomRate + roomTax,
          source: 'checkin', postedAt: nowIso,
        })
      }
      // Acreditar más de lo consumido dejaría el folio en negativo y la factura con `amountPaid`
      // mayor que su total. El sobrante queda a favor en la reserva, no acá.
      const acreditables = capPrepaidLines(prepaid, roomRate > 0 ? roomRate + roomTax : 0)
      // Pagos ya cobrados → líneas del folio. NO se crean filas nuevas en `payments`: el cobro
      // ya está asentado ahí (fuente de verdad del dinero). `reference` lleva el id del pago,
      // que es la trazabilidad y la clave de idempotencia.
      for (const line of acreditables) {
        await tx.create('FolioCharges', {
          id: crypto.randomUUID(), folioId, hotelId: r.hotelId,
          description: line.description,
          category: 'payment', kind: line.kind, quantity: 1,
          amount: line.amount, taxes: 0, total: line.amount,
          source: 'prepaid', postedAt: nowIso, reference: line.paymentId,
        })
      }
      await tx.update('Reservations', r.id, { status: 'checked_in', checkedInAt: nowIso, folioId, guestId })
      await tx.update('Rooms', r.roomId, { status: 'occupied' })
    })
  } catch (e: any) {
    // El centinela no es un error interno: es "otro se te adelantó" → 409, igual que el guard
    // de `checkinValidation`. Sin esto el catch de abajo lo convertiría en un 500 opaco.
    if (e instanceof AlreadyCheckedInError) throw new ConflictError('La reserva ya tiene check-in')
    throw new Error(`Error interno al procesar check-in: ${e.message}`)
  }
  if (deps.queries) {
    deps.queries.createAuditLog({ id: crypto.randomUUID(), entity: 'Reservations', entityId: r.id, action: 'checkin', userId: user.id, hotelId: r.hotelId, detail: JSON.stringify({ guestId, roomId: r.roomId, folioId, checkIn: r.checkIn, checkOut: r.checkOut, roomCharge: roomRate }), createdAt: nowIso })
  }
  return { ok: true, reservationId: r.id, status: 'checked_in', folioId, guestId, roomCharge: roomRate }
}
