// payment-requests/usecases/charge-ceiling.ts — Techo del monto de un cobro, decidido por el SERVIDOR.
//
// Hallazgo SEC-1 (2026-08-19): el monto del Checkout de Stripe lo dictaba el cliente. El schema
// sólo pedía `min: 0` y `create-checkout.ts` cobraba `pr.amount` tal cual, así que desde el
// navegador se podía crear un cobro por $1 sobre una reserva de $400 (o por un importe arbitrario
// sobre la reserva de OTRO hotel: `reservationId` viajaba en el body y nadie lo cotejaba contra el
// hotel del JWT). El saldo real ya lo sabe el servidor —`shared/utils/reservation-balance`— así que
// el monto se valida contra él en vez de confiar en lo que llegó.
//
// Hallazgo SEC-2 (2026-08-19, 2ª vuelta): el techo era POR COBRO y no AGREGADO. Cada click del
// botón "Requerir pago" del modal (`ReservationModal.vue:requirePayment`) crea un PaymentRequest
// nuevo por el pendiente COMPLETO, así que tres clicks dejaban tres links de $300 vivos sobre un
// saldo de $300: los tres pasaban el techo individualmente y el huésped podía pagar $900. Ahora el
// techo descuenta lo ya comprometido en los `payment_requests` en estado `pending` de la MISMA
// reserva — el mismo criterio que ya aplicaba `shared/usecases/auto-payment-request.ts` al no crear
// un segundo request si había uno pendiente.
//
// GH-0.3: contar FILAS `pending` sólo equivale a contar SESIONES DE STRIPE VIVAS porque
// `usecases/live-session.ts` sostiene el invariante — una fila `pending` tiene a lo sumo una sesión
// abierta, y la sesión se expira en Stripe ANTES de que la fila salga de `pending` (cancelar,
// expirar, borrar) o de que se emita otra por un importe distinto. Sin ese invariante este filtro
// es un colador: `PUT {status:'cancelled'}` liberaba el techo con el link todavía pagable. Si
// alguna vez se agrega otro camino que saque una fila de `pending`, tiene que pasar por
// `releaseSession` o este techo vuelve a mentir.

import type { RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, ValidationError, AuthError } from 'arckode-framework'
import { pendingBalance } from '../../../shared/utils/reservation-balance'
import { paidForReservation, type ReservationPaidRepos } from '../../../shared/usecases/reservation-paid'
import { round2, BALANCE_EPSILON } from '../../../shared/utils/money'
import type { PaymentRequestDTO } from '../types'

export interface ChargeCeilingDeps {
  reservationRepo: RepositoryAdapter<any>
  addonRepo: RepositoryAdapter<any>
  /** `payment_requests` — para descontar del techo lo ya comprometido en links vivos (SEC-2). */
  requestRepo: RepositoryAdapter<PaymentRequestDTO>
  /** Lectura reserva → `payments` (GH-0.2), servida por los módulos dueños del dinero vía el
   *  connector `payment-requests-money` (STR-A: mismo patrón que `connectors/reservas-money` —
   *  este módulo no abre `OrmRepository` de `invoices`/`payments`). OBLIGATORIA y fail-closed:
   *  sin ella el techo volvería a medirse contra `reservations.deposit` y autorizaría cobrar por
   *  Stripe plata ya cobrada por folio/factura. */
  paidRepos: ReservationPaidRepos
}

/** Suma de los cobros `pending` de la reserva, sin contar el que se está editando. */
async function committedPending(
  deps: ChargeCeilingDeps,
  hotelId: string,
  reservationId: string,
  excludeRequestId?: string,
): Promise<number> {
  const rows = await deps.requestRepo.findMany({ hotelId, reservationId } as any)
  return round2(
    (rows as PaymentRequestDTO[])
      .filter((r) => r.status === 'pending' && r.id !== excludeRequestId)
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
  )
}

/**
 * Valida que `amount` sea un importe cobrable y devuelve el monto aceptado.
 *
 * Sin `reservationId` sólo se puede exigir lo que no depende de la reserva (monto positivo): un
 * cobro suelto no tiene saldo contra el cual toparse. Con `reservationId`:
 * - la reserva tiene que existir y ser del hotel que cobra (IDOR cross-tenant);
 * - el monto no puede superar el saldo pendiente real (alojamiento + otros cobros + extras − pagado)
 *   MENOS lo ya comprometido en otros links de pago `pending` de la misma reserva.
 *   Un cobro parcial (anticipo) sigue siendo válido: el techo es el saldo, no una igualdad.
 *   "Pagado" sale de `payments` vía `shared/usecases/reservation-paid`, NO de la columna
 *   `reservations.deposit`: un cobro en efectivo por folio no toca `deposit` y el techo autorizaba
 *   volver a cobrar por Stripe plata ya cobrada (GH-0.2).
 */
export async function assertChargeableAmount(
  deps: ChargeCeilingDeps,
  params: { hotelId: string; reservationId?: string | null; amount: unknown; excludeRequestId?: string },
): Promise<number> {
  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('El monto del cobro debe ser mayor a 0')
  }
  // Un PaymentRequest sin reserva no tiene saldo de referencia. El monto positivo SÍ se exige
  // igual: antes esta rama se salteaba entera y dejaba pasar 0 y negativos (SEC-3).
  if (!params.reservationId) return round2(amount)

  const reservation = await deps.reservationRepo.findById(params.reservationId) as any
  if (!reservation) throw new NotFoundError('Reserva no encontrada')
  if (reservation.hotelId !== params.hotelId) throw new AuthError('La reserva no pertenece a este hotel')

  const addons = await deps.addonRepo.findMany({ reservationId: params.reservationId, hotelId: params.hotelId })
  // Lo cobrado sale del libro del dinero (`payments`), no del espejo parcial `deposit` (GH-0.2).
  const paid = await paidForReservation(deps.paidRepos, params.hotelId, params.reservationId, reservation)
  const balance = pendingBalance(reservation, addons as any[], paid)
  if (balance <= 0) throw new ValidationError('La reserva no tiene saldo pendiente de cobro')

  const committed = await committedPending(deps, params.hotelId, params.reservationId, params.excludeRequestId)
  const ceiling = round2(balance - committed)
  if (ceiling <= 0) {
    throw new ValidationError(
      `La reserva ya tiene links de pago pendientes por $${committed} sobre un saldo de $${balance}: cobrá o cancelá esos antes de crear otro`,
    )
  }
  if (amount > ceiling + BALANCE_EPSILON) {
    const detail = committed > 0 ? ` (saldo $${balance} − $${committed} ya solicitados)` : ''
    throw new ValidationError(`El monto ($${amount}) supera el saldo cobrable de la reserva ($${ceiling})${detail}`)
  }
  return round2(amount)
}

// ── COR-3: el par leer-techo → crear tiene que ser atómico ──────────────────────────────────────
//
// El techo agregado se leía (`committedPending`), se validaba, y recién después `service.ts` hacía
// el `create`. Sin transacción ni constraint, dos clicks concurrentes de "Requerir pago" leían el
// mismo `committedPending = 0` y creaban dos links que juntos superaban el saldo: exactamente el
// escenario que el comentario de SEC-2 dice haber cerrado.
//
// Se cierra en dos capas, porque no hay una sola que alcance:
//   1. `withLock` (`shared/utils/async-lock.ts`) serializa por reserva DENTRO del proceso. Es un
//      ATAJO, no la garantía: no sobrevive a un reinicio ni a un segundo proceso. El backend hoy
//      corre como un único servicio systemd (`solmios-backend.service`), así que en la práctica
//      ésta es la que atrapa el doble click, que es el 99% de los casos reales. Es el MISMO lock
//      que usa `payments/usecases/deposits.ts` (DT-11): un solo registry in-memory para todos los
//      caminos de dinero, no dos implementaciones gemelas que hay que auditar por separado.
//   2. `assertCeilingAfterCommit` es LA GARANTÍA: re-lee el agregado DESPUÉS de persistir y revierte
//      el link si se pasó. Si dos procesos crearan a la vez, cada uno ve al otro ya committeado en
//      la re-lectura y se echa atrás — puede fallar de más (los dos se revierten y el usuario
//      reintenta), nunca de menos (jamás quedan dos links vivos por encima del saldo). Cubierto en
//      `tests/charge-ceiling-concurrency.test.ts`, incluido el caso sin lock compartido.
//
// STR-B: ¿por qué NO `orm.transaction`, que es el patrón vigente del repo (`landing/index.ts`,
// `bookingengine/usecases/public-booking.ts`, `promo-codes/usecases/promo-atomic.ts`)? Porque acá
// el invariante es un AGREGADO (Σ de los `pending` de la reserva), no una fila:
//   · en Postgres READ COMMITTED una transacción NO serializa dos lecturas agregadas — las dos
//     leen `committedPending = 0` y las dos insertan, exactamente el bug;
//   · y meter la re-verificación DENTRO de la transacción la vuelve ciega: no ve las filas todavía
//     no committeadas del otro proceso, así que perdería justo el caso que atrapa hoy.
// Los usos citados del repo son distintos: `promo-atomic` serializa con un CAS `WHERE uses = ?`
// sobre UNA fila, y `landing` usa la transacción por atomicidad (delete-all + insert-all), no por
// aislamiento. El equivalente honesto acá sería un CAS sobre un contador en `reservations` —
// campo nuevo + migración — o un `SELECT ... FOR UPDATE` sobre la reserva, que el ORM del framework
// no expone. Queda anotado como deuda en el change; el par lock + compensación no deja pasar el
// escenario mientras tanto.

/** Clave del lock: una reserva de un hotel. Sin reserva no hay techo agregado que proteger. */
export function chargeLockKey(hotelId: string, reservationId?: string | null): string {
  return `${hotelId}::${reservationId ?? ''}`
}

/**
 * Re-verifica el techo con el link YA persistido y lo revierte si se pasó (ver el bloque de arriba).
 * `rollback` es la compensación: borrar el link recién creado, o devolver el monto anterior.
 */
export async function assertCeilingAfterCommit(
  deps: ChargeCeilingDeps,
  committed: { id: string; hotelId: string; reservationId?: string | null; amount: number },
  rollback: () => Promise<void>,
): Promise<void> {
  if (!committed.reservationId) return
  try {
    await assertChargeableAmount(deps, {
      hotelId: committed.hotelId,
      reservationId: committed.reservationId,
      amount: committed.amount,
      excludeRequestId: committed.id,
    })
  } catch (e) {
    await rollback()
    // BUG-3: no toda denegación de la re-verificación es una carrera. Reserva borrada
    // (`NotFoundError`) o cobro cross-tenant (`AuthError`) son causas reales con su propio
    // mensaje; envolverlas en "otro cobro se creó al mismo tiempo" era un diagnóstico mentiroso
    // que mandaba al staff a buscar una carrera que no existía. Sólo la superación del techo
    // (que SÍ es la carrera o un saldo que bajó en el medio) se relata como tal.
    if (e instanceof NotFoundError || e instanceof AuthError) throw e
    throw new ValidationError(
      'Otro cobro de esta reserva se creó al mismo tiempo y juntos superan el saldo: no se emitió el link. Revisá los cobros pendientes y volvé a intentar.',
    )
  }
}
