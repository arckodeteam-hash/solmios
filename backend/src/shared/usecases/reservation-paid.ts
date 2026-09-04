// shared/usecases/reservation-paid.ts — Lo REALMENTE cobrado de una reserva, derivado de `payments`.
//
// Hallazgo GH-0.2 (gate CHK-20260819): `pendingBalance` tomaba `reservations.deposit` como "lo
// pagado". `deposit` NO es el libro del dinero: lo mueven el motor público (`bookingengine`), el
// webhook de payment-requests y la carga manual del alta, pero NO lo tocan `folios.applyPayment`
// (`folios/usecases/folio-entries.ts`, 0 hits de `deposit`) ni `facturas.pay`
// (`facturas/usecases/pay-invoice.ts`, escribe `invoices` + `payments`) ni el settlement del
// checkout (`shared/usecases/settle-folio-at-checkout.ts`, 0 hits). Quien pagó $300 en efectivo por
// folio quedaba con `deposit = 0`, el modal decía "Pendiente $500" y —peor— `charge-ceiling.ts`
// AUTORIZABA una Checkout Session de Stripe por esos $500 ya cobrados en parte.
//
// La fuente de verdad del dinero es `payments` (CLAUDE.md, "payments es la ÚNICA fuente de verdad
// del dinero"). Se llega a esas filas por TRES vínculos, y hay que recorrer los tres:
//   · `folioId`      → `folios.reservationId`
//   · `invoiceId`    → `invoices.reservationId`
//   · `reservationId`→ la columna directa de `payments`.
//
// BUG-ceiling-bypass: el tercero no existía y la enumeración de este encabezado decía "los dos
// vínculos reales del schema", lo cual era falso. `shared/usecases/charge-reschedule-diff.ts` cobra
// la diferencia de una reprogramación en efectivo o con tarjeta creando una fila
// `type:'charge'`/`status:'completed'` SIN folio y SIN factura — la reserva viajaba sólo en
// `payments.metadata`, que es JSON y no se puede filtrar por WHERE. Resultado: `commitReschedule`
// subía `reservations.totalAmount` con la diferencia, el cobro de esa diferencia no contaba como
// pagado, y el techo de `payment-requests` autorizaba una Checkout Session por plata ya cobrada.
// Es la MISMA clase de bug que GH-0.2, por una ruta que este encabezado no enumeraba.
//
// ¿Por qué no `deposit + payments` ni uno de los dos a secas?
//   - Un cobro por Stripe Checkout suma a las DOS: el webhook bumpea `reservations.deposit` Y
//     asienta la fila en `payments` (`connectors/payment-requests-payments.ts`,
//     `shared/usecases/post-booking-payment.ts`). Sumarlas duplicaría.
//   - Un anticipo cargado a mano en el alta existe SÓLO en `deposit`.
//   - Un cobro en efectivo por folio o factura existe SÓLO en `payments`.
//
// GH-0.5: la versión anterior resolvía esto con `max(deposit, sumPayments)`, y eso SUB-RECONOCE
// cuando las dos fuentes tienen plata DISTINTA: anticipo manual de $200 en `deposit` + $100 en
// efectivo por folio = $300 cobrados, y el `max` devolvía $200. Ese número es el techo de
// `payment-requests/usecases/charge-ceiling.ts`, así que el hotel podía emitir un link de Stripe
// por $100 ya cobrados. El comentario que decía "jamás autoriza volver a cobrar algo ya pagado"
// era falso con las dos fuentes cargadas.
//
// La corrección es dejar de comparar peras con manzanas: se parte `payments` en dos según espeje o
// no a `deposit`, y sólo la parte que lo espeja entra al `max`.
//
//     paid = max(deposit, cobros_que_espejan_deposit) + cobros_independientes − devoluciones
//
// El discriminante es `payments.stripeSessionId`: TODO flujo que bumpea `deposit` es un Checkout de
// Stripe y su fila nace con la sesión (los dos connectors citados arriba). Los cobros que NO tocan
// `deposit` —`folios.applyPayment`, `facturas.pay`, caja— nacen sin ella. Las devoluciones
// (`type:'refund'`, `payments/usecases/refund.ts`) no llevan sesión y no bajan `deposit`: restan
// del total, fuera del `max`, para que devolver un cobro de Stripe no quede escondido detrás del
// `deposit` que nadie decrementó.

import type { RepositoryAdapter } from 'arckode-framework'
import { round2 } from '../utils/money'

/** Fila de `payments` (modules/payments/model.ts) en lo que le importa a esta suma. */
export interface PaymentRowLike {
  id?: string
  type?: string | null
  status?: string | null
  amount?: number | null
  /** Presente ⇔ el cobro entró por Stripe Checkout, el único flujo que además bumpea `deposit`. */
  stripeSessionId?: string | null
}

/** Repos necesarios para llegar de una reserva a sus filas de `payments`. */
export interface ReservationPaidRepos {
  /** `folios` — tiene `reservationId`. */
  folioRepo: Pick<RepositoryAdapter<any>, 'findMany'>
  /** `invoices` — tiene `reservationId`. */
  invoiceRepo: Pick<RepositoryAdapter<any>, 'findMany'>
  /** `payments` — se consulta por `folioId`, por `invoiceId` y por `reservationId`. */
  paymentRepo: Pick<RepositoryAdapter<any>, 'findMany'>
}

/**
 * Estados que cuentan como dinero recibido.
 * `refunded` marca el cobro ORIGINAL de una devolución total (`payments/usecases/refund.ts` lo
 * pasa a `refunded` y crea aparte una fila `type:'refund'`): si se descartara, la devolución
 * restaría dos veces y el saldo quedaría inflado.
 */
const COUNTED_STATUSES = new Set(['completed', 'refunded'])

/** Tipos que SUMAN. `withdrawal` es un movimiento de caja, no un cobro al huésped: se ignora. */
const CREDIT_TYPES = new Set(['charge', 'deposit'])

/** Desglose de `payments` según su relación con la columna `reservations.deposit` (GH-0.5). */
export interface PaidBreakdown {
  /** Cobros por Stripe Checkout: el MISMO flujo que bumpea `deposit`, así que lo espejan. */
  depositMirror: number
  /** Cobros que no tocan `deposit` (efectivo/transferencia por folio o factura, caja). */
  independent: number
  /** Devoluciones (`type:'refund'`). Restan del total, nunca entran al `max`. */
  refunds: number
}

/** Parte las filas de `payments` en las tres bolsas que la fórmula necesita. */
export function splitPayments(rows: readonly PaymentRowLike[] | null | undefined): PaidBreakdown {
  const out: PaidBreakdown = { depositMirror: 0, independent: 0, refunds: 0 }
  for (const p of rows ?? []) {
    if (!COUNTED_STATUSES.has(String(p?.status ?? ''))) continue
    const amount = Number(p?.amount) || 0
    const type = String(p?.type ?? '')
    if (type === 'refund') { out.refunds += Math.abs(amount); continue }
    if (!CREDIT_TYPES.has(type)) continue
    if (String(p?.stripeSessionId ?? '')) out.depositMirror += amount
    else out.independent += amount
  }
  out.depositMirror = round2(out.depositMirror)
  out.independent = round2(out.independent)
  out.refunds = round2(out.refunds)
  return out
}

/** Suma con signo de filas de `payments`: cobros suman, devoluciones restan. */
export function sumPayments(rows: readonly PaymentRowLike[] | null | undefined): number {
  const b = splitPayments(rows)
  return round2(b.depositMirror + b.independent - b.refunds)
}

/**
 * Combina la columna `deposit` con el desglose de `payments`. Ver el encabezado del archivo.
 * Nunca negativo: un `paid` negativo haría que `pendingBalance` pidiera MÁS que el total cobrable.
 */
export function combinePaid(deposit: number, b: PaidBreakdown): number {
  return round2(Math.max(0, Math.max(deposit, b.depositMirror) + b.independent - b.refunds))
}

/**
 * Lo cobrado de una reserva. Ver el encabezado del archivo para el criterio.
 * Multi-tenancy: TODA query lleva `hotelId` — el `reservationId` puede venir de un payload.
 */
export async function paidForReservation(
  repos: ReservationPaidRepos,
  hotelId: string,
  reservationId: string,
  reservation?: { deposit?: number | null } | null,
): Promise<number> {
  const deposit = Number(reservation?.deposit) || 0
  // COR-4: sin hotel/reserva NO se puede consultar `payments`, y devolver `deposit` en silencio es
  // exactamente el bug que este archivo cierra (el techo del cobro volvería a medirse contra la
  // columna espejo). Es un error de programación del caller —toda fila tiene `hotelId`—, así que
  // se rompe fuerte en vez de degradar sin avisar.
  if (!reservationId) throw new Error('reservation-paid: falta reservationId')
  if (!hotelId) throw new Error(`reservation-paid: falta hotelId de la reserva ${reservationId} (multi-tenancy)`)

  return combinePaid(deposit, splitPayments(await collectReservationPayments(repos, hotelId, reservationId)))
}

/**
 * TODAS las filas de `payments` de una reserva, por sus TRES vínculos, deduplicadas por id.
 *
 * Extraída de `paidForReservation` (2026-08-30) para que el historial que ve el hotel salga de
 * la MISMA recolección que el total cobrado: si fueran dos recorridos distintos, el desglose
 * podría no sumar el número que muestra la reserva.
 *
 * Un mismo pago puede colgar del folio Y de la factura que ese folio generó: sin el `Map` por id
 * el cobro del checkout aparecería (y se contaría) dos veces.
 */
export async function collectReservationPayments(
  repos: ReservationPaidRepos,
  hotelId: string,
  reservationId: string,
): Promise<PaymentRowLike[]> {
  if (!reservationId) throw new Error('reservation-paid: falta reservationId')
  if (!hotelId) throw new Error(`reservation-paid: falta hotelId de la reserva ${reservationId} (multi-tenancy)`)

  const [folios, invoices] = await Promise.all([
    repos.folioRepo.findMany({ hotelId, reservationId } as any),
    repos.invoiceRepo.findMany({ hotelId, reservationId } as any),
  ])

  const rows = new Map<string, PaymentRowLike>()
  const collect = (found: readonly PaymentRowLike[]) => {
    found.forEach((p, i) => rows.set(String(p?.id ?? `anon-${rows.size}-${i}`), p))
  }
  const byFolio = await Promise.all(
    (folios as any[]).map((f) => repos.paymentRepo.findMany({ hotelId, folioId: f?.id } as any)),
  )
  const byInvoice = await Promise.all(
    (invoices as any[]).map((inv) => repos.paymentRepo.findMany({ hotelId, invoiceId: inv?.id } as any)),
  )
  // Tercer vínculo: el cobro que no cuelga de folio ni factura (diferencia de una reprogramación
  // cobrada en efectivo/tarjeta).
  const byReservation = await repos.paymentRepo.findMany({ hotelId, reservationId } as any)
  byFolio.forEach(collect)
  byInvoice.forEach(collect)
  collect(byReservation as PaymentRowLike[])

  return [...rows.values()]
}

/** Fila de `folios`/`invoices` en lo que le importa a `paidAmountsByReservation`: el vínculo a la
 *  reserva dueña. */
export interface OwnedRowLike {
  id?: string
  reservationId?: string | null
}

/**
 * Requerimiento 14/auditoría final (2026-09-04) — versión EN LOTE de `paidForReservation`, para
 * pantallas que listan MUCHAS reservas a la vez (planning/calendario, `dashboard/usecases/
 * dashboard-queries.ts#getPlanning`). Llamar `paidForReservation` una vez POR reserva ahí sería
 * N+1 (folios/invoices/payments por cada fila visible). Acá se piden los folios/invoices/payments
 * del HOTEL una sola vez cada uno (3 queries totales, sin importar cuántas reservas haya) y se
 * agrupan en memoria — MISMA fórmula que `paidForReservation` (`combinePaid`/`splitPayments`),
 * nunca una copia distinta.
 *
 * Encontrado en la auditoría final del Requerimiento 15: `getPlanning` calculaba el estado de pago
 * con `reservations.deposit` (nunca lo tocan `folios.applyPayment`/`facturas.pay`) en vez de esto —
 * el mismo bug GH-0.2 que ya se había resuelto para la vista de detalle (`getExtendedDetail`), pero
 * vivo todavía en el planning/calendario porque esa vista nunca pasó por el mismo fix.
 */
export function paidAmountsByReservation(
  folios: readonly OwnedRowLike[] | null | undefined,
  invoices: readonly OwnedRowLike[] | null | undefined,
  payments: readonly (PaymentRowLike & { reservationId?: string | null; folioId?: string | null; invoiceId?: string | null })[] | null | undefined,
  reservations: readonly { id: string; deposit?: number | null }[],
): Map<string, number> {
  const folioOwner = new Map((folios ?? []).map((f) => [String(f.id ?? ''), f.reservationId ?? null]))
  const invoiceOwner = new Map((invoices ?? []).map((inv) => [String(inv.id ?? ''), inv.reservationId ?? null]))

  // Un pago cuelga de UN SOLO vínculo en la práctica (folio, factura, o directo — BUG-ceiling-bypass
  // arriba), así que resolver en este orden no duplica ni pierde filas frente a los tres `findMany`
  // separados de `collectReservationPayments`.
  const rowsByReservation = new Map<string, PaymentRowLike[]>()
  for (const p of payments ?? []) {
    const reservationId = (p.folioId ? folioOwner.get(String(p.folioId)) : null)
      ?? (p.invoiceId ? invoiceOwner.get(String(p.invoiceId)) : null)
      ?? p.reservationId
      ?? null
    if (!reservationId) continue
    const arr = rowsByReservation.get(reservationId) ?? []
    arr.push(p)
    rowsByReservation.set(reservationId, arr)
  }

  const out = new Map<string, number>()
  for (const r of reservations) {
    out.set(r.id, combinePaid(Number(r.deposit) || 0, splitPayments(rowsByReservation.get(r.id) ?? [])))
  }
  return out
}

/** Fila de reserva mínima que necesita un `PaidSource`: el hotel (multi-tenancy) y el anticipo. */
export interface ReservationTenantLike {
  hotelId?: string | null
  deposit?: number | null
}

/** Fuente de "lo pagado" de una reserva. La consumen los callers que sólo tienen el id + la fila. */
export type PaidSource = (reservationId: string, reservation?: ReservationTenantLike | null) => Promise<number>

/**
 * Arma un `PaidSource` sobre un juego de repos. El hotel sale de la propia fila de la reserva
 * (ya leída y ya validada por ownership en el caller), no de un parámetro suelto que se pueda
 * desincronizar.
 */
export function paidSourceFrom(repos: ReservationPaidRepos): PaidSource {
  return (reservationId, reservation) =>
    paidForReservation(repos, String(reservation?.hotelId ?? ''), reservationId, reservation)
}
