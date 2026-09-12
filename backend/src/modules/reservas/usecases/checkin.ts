import { NotFoundError, AuthError, ConflictError } from 'arckode-framework'
import { roomChargeRate } from '../../../shared/usecases/room-charge-rate'
import { prepaidLinesFrom, depositOnlyPrepaid, depositPrepaidLine, capPrepaidLines, type PrepaidLine } from '../../../shared/usecases/prepaid-folio-lines'
import { buildAddonFolioCharges, addonChargesTotal, addonChargesBase } from '../../../shared/usecases/addon-folio-charges'

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

/**
 * `opts.roomId` (REQ-HAC-04, #259): el body de POST /checkin puede traer la unidad a asignar en el
 * mismo paso. Acá sólo se releva el 409 `room_not_assigned`: la asignación real (solape, tipo,
 * vendibilidad, auditoría) la hace el controller con `assignRoom` ANTES de `executeCheckin`, que
 * sigue exigiendo `roomId` en la fila (invariante checked_in ⇒ roomId).
 */
export async function checkinValidation(repo: any, id: string, user: any, auth?: any, opts?: { roomId?: string | null }): Promise<any> {
  const hotelId = user?.hotelId
  const r = await repo.findById(id) as any
  if (!r) throw new NotFoundError('Reserva no encontrada')
  if (user.role !== 'super_admin' && r.hotelId !== hotelId) throw new AuthError('No autorizado')
  // assertOwnership recibe (dueño, solicitante, rol, rolAdmin) — todos strings. Pasarle objetos
  // hace que la comparación `===` nunca dé true y lanza Forbidden SIEMPRE: el check-in quedaba muerto.
  if (auth) auth.assertOwnership(r.hotelId, hotelId, user.role, 'super_admin')
  // El estado va ANTES que la habitación: si el body trae `roomId`, el controller la asigna al
  // pasar esta validación, y asignar una unidad a una reserva cancelled/checked_in sería un efecto
  // lateral de un check-in que igual iba a fallar.
  if (r.status === 'checked_in') throw new ConflictError('La reserva ya tiene check-in')
  if (!['confirmed', 'pending'].includes(r.status)) throw new ConflictError(`No se puede hacer check-in de una reserva ${r.status}`)
  if (!opts?.roomId) assertRoomAssigned(r)
  return { reservation: r, hotelId: r.hotelId }
}

/**
 * HAC-01 (#258): la reserva nace con `roomId = null` y la unidad se elige en recepción. Sin
 * habitación NO hay check-in: el folio nacería sin `roomId`, el cargo de la noche se postearía
 * con `Rooms` vacío y el check-out reventaría en `connectors/reservas-housekeeping.ts`
 * (`habitaciones.update(null)`). Mismo formato de 409 que `assign-room.ts`: `details.reason`
 * (`room_not_assigned`, REQ-HAC-04 #259) le dice al panel que lo que falta es asignar — abre
 * "Asignar habitación" desde el botón Check-in —, no que el estado esté mal.
 */
export function assertRoomAssigned(r: { roomId?: string | null }): void {
  if (r.roomId) return
  throw new ConflictError('La reserva no tiene habitación asignada: asigne una antes del check-in', { reason: 'room_not_assigned' })
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

/**
 * Lectura dentro de la transacción si el handle la soporta; si no, por el ORM (los harnesses
 * viejos y algún driver no exponen `findMany` en `tx`). Una lectura que devuelve null/undefined
 * cuenta como "sin filas" → []. Un ERROR de la lectura se propaga: aborta la transacción y el
 * check-in falla con el "Error interno" de abajo. Antes se tragaba y devolvía [] — el check-in
 * commiteaba con el folio SIN los extras y el tope del prepago sólo en la noche, o sea, el mismo
 * bug de #269 pero silencioso. Sin extras posteados no hay check-in.
 */
async function findManyIn(tx: any, orm: any, model: string, filter: Record<string, unknown>): Promise<any[]> {
  const reader = typeof tx?.findMany === 'function' ? tx : orm
  const rows = await reader.findMany(model, filter)
  return Array.isArray(rows) ? rows : []
}

export async function executeCheckin(r: any, user: any, deps: {
  orm: any; logger: any; repo: any; queries?: any
}): Promise<any> {
  const nowIso = new Date().toISOString()
  // Se fija ACÁ, antes del primer `await`: es el estado con el que entramos y contra el que se
  // reclama la reserva más abajo. Leerlo dentro de la transacción sería tarde — si el objeto
  // que nos pasaron es compartido, para entonces ya podría haberlo mutado el check-in rival.
  const expectedStatus = r.status
  // Defensa en profundidad: `checkinValidation` ya lo rechazó, pero este usecase también lo
  // llaman harnesses/callers que no pasan por ahí. Va ANTES del try: adentro se volvería un 500.
  assertRoomAssigned(r)
  let guestId = r.guestId
  let folioId = ''
  let extrasCharge = 0

  const room = (await deps.orm.findMany('Rooms', { id: r.roomId }))[0] as any
  // La noche del ingreso se cobra por la MISMA cadena que cotizó la reserva (temporada →
  // room_rates → rooms.basePrice). Antes era `rooms.basePrice` a secas y el folio ignoraba la
  // temporada: ver shared/usecases/room-charge-rate.ts.
  const roomRate = await roomChargeRate(deps.orm, {
    hotelId: r.hotelId,
    date: String(r.checkIn).slice(0, 10),
    roomType: String(room?.type || ''),
    guests: Number(r.adults) || 1,
    fallbackPrice: Number(room?.basePrice || r.totalAmount || 0),
  })

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
      // #269 — Los extras que el huésped pagó online (`reservation_addons` source booking_engine)
      // entran al folio como cargos ANTES de acreditar el prepago: ese prepago los incluye, y sin
      // estas líneas el folio nacía "a favor" del huésped por el importe de los extras.
      // Idempotente por `reference: 'addon:<id>'` contra los cargos que ya tenga el folio.
      const addons = await findManyIn(tx, deps.orm, 'ReservationAddons', { reservationId: r.id, hotelId: r.hotelId })
      const existingCharges = await findManyIn(tx, deps.orm, 'FolioCharges', { folioId })
      const addonRows = buildAddonFolioCharges({
        folioId, hotelId: r.hotelId, addons, taxRate, existingCharges, source: 'checkin', postedAt: nowIso,
      })
      for (const row of addonRows) await tx.create('FolioCharges', row)
      extrasCharge = addonChargesBase(addonRows)
      // Acreditar más de lo consumido dejaría el folio en negativo y la factura con `amountPaid`
      // mayor que su total. El sobrante queda a favor en la reserva, no acá. El tope es la noche
      // MÁS los extras recién posteados (#269): el prepago del motor cubre ambos.
      const acreditables = capPrepaidLines(prepaid, (roomRate > 0 ? roomRate + roomTax : 0) + addonChargesTotal(addonRows))
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
    deps.queries.createAuditLog({ id: crypto.randomUUID(), entity: 'Reservations', entityId: r.id, action: 'checkin', userId: user.id, hotelId: r.hotelId, detail: JSON.stringify({ guestId, roomId: r.roomId, folioId, checkIn: r.checkIn, checkOut: r.checkOut, roomCharge: roomRate, extrasCharge }), createdAt: nowIso })
  }
  return { ok: true, reservationId: r.id, status: 'checked_in', folioId, guestId, roomCharge: roomRate, extrasCharge }
}
