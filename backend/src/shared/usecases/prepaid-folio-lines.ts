// shared/usecases/prepaid-folio-lines.ts — Lleva al folio lo que el huésped YA pagó.
//
// Por qué (reporte de cliente, 2026-08-30: "el pago de Stripe no está conectado con nada"):
// el motor web cobra ANTES del check-in, así que cuando el huésped llega todavía no existe folio.
// El check-in creaba el folio con el cargo de la habitación y CERO pagos, aunque en `payments`
// hubiera un cobro completado por el total de la estadía. El folio decía que el huésped debía
// todo, y como el settlement del checkout factura contra el folio (`settle-folio-at-checkout`),
// se le volvía a cobrar plata ya cobrada.
//
// Reproducido en producción: reserva pagada 613,60 por Stripe → folio con 1 cargo de 153,40 y
// 0 pagos.
//
// Qué NO hace: crear filas nuevas en `payments`. El cobro YA está asentado ahí (es la fuente de
// verdad del dinero); acá solo se refleja en el folio como línea `kind:'payment'`, con el id del
// pago en `reference` para poder trazarlo y para no duplicarlo si se corre de nuevo.

import { round2 } from '../utils/money'
import { splitPayments } from './reservation-paid'

/** Estados que representan dinero efectivamente recibido (mismo criterio que reservation-paid). */
const SETTLED = new Set(['completed', 'refunded'])
/** Tipos que suman. `withdrawal` es movimiento de caja, no un cobro al huésped. */
const CREDIT_TYPES = new Set(['charge', 'deposit'])

export interface PrepaidLine {
  /** `payments.id` — va al `reference` de la línea del folio. Es la clave de idempotencia. */
  paymentId: string
  /**
   * `payment` para un cobro; `charge` para una DEVOLUCIÓN.
   *
   * No es un capricho: `folio-math.computeTotals` suma los pagos con `Math.abs()`, así que una
   * línea de pago negativa acreditaría de más en vez de restar. Una devolución vuelve a poner
   * plata en el debe del huésped, que es exactamente un cargo.
   */
  kind: 'payment' | 'charge'
  /** Siempre POSITIVO. El signo lo lleva `kind`. */
  amount: number
  method: string
  description: string
}

export interface PrepaidSourceRow {
  id?: string
  type?: string | null
  status?: string | null
  method?: string | null
  amount?: number | null
  folioId?: string | null
  reference?: string | null
  description?: string | null
}

/**
 * Convierte los cobros ya existentes de una reserva en líneas de pago para un folio nuevo.
 *
 * - Solo cobros liquidados. Un `pending` no es plata recibida y no puede bajar el saldo.
 * - Las devoluciones entran como CARGO (ver `PrepaidLine.kind`), así el folio no acredita
 *   plata que se devolvió.
 * - Se excluyen los pagos que ya cuelgan de un folio: ese folio ya los refleja, y traerlos acá
 *   los contaría dos veces.
 * - `alreadyReferenced` son los `reference` ya presentes en el folio: correr esto dos veces sobre
 *   el mismo folio no duplica líneas.
 */
export function prepaidLinesFrom(
  rows: readonly PrepaidSourceRow[] | null | undefined,
  alreadyReferenced: readonly string[] = [],
): PrepaidLine[] {
  const seen = new Set(alreadyReferenced.filter(Boolean).map(String))
  const lines: PrepaidLine[] = []

  for (const p of rows ?? []) {
    const id = String(p?.id ?? '')
    if (!id || seen.has(id)) continue
    if (!SETTLED.has(String(p?.status ?? ''))) continue
    // Ya asentado en un folio (el suyo): no se replica.
    if (String(p?.folioId ?? '')) continue

    const type = String(p?.type ?? '')
    const isRefund = type === 'refund'
    if (!isRefund && !CREDIT_TYPES.has(type)) continue

    const amount = Math.abs(Number(p?.amount) || 0)
    if (amount <= 0) continue

    seen.add(id)
    lines.push({
      paymentId: id,
      kind: isRefund ? 'charge' : 'payment',
      amount: round2(amount),
      method: String(p?.method || 'card'),
      description: isRefund
        ? 'Devolución de pago anticipado'
        : `Pago anticipado${p?.method ? ` (${p.method})` : ''}`,
    })
  }

  return lines
}

/** Neto que el folio va a acreditar: cobros menos devoluciones. */
export function prepaidTotal(lines: readonly PrepaidLine[]): number {
  return round2(lines.reduce((acc, l) => acc + (l.kind === 'payment' ? l.amount : -l.amount), 0))
}

/**
 * La parte del anticipo que vive SOLO en `reservations.deposit` y que ninguna fila de `payments`
 * espeja. Sin esto el folio la ignora por completo.
 *
 * Un anticipo cargado a mano en el alta ("el huésped ya transfirió") no genera fila en `payments`
 * —está documentado en `reservation-paid.ts`— y `prepaidLinesFrom` lee `payments`. Resultado
 * verificado en dev el 2026-09-04: huésped que pagó 195 por adelantado, folio al check-in con
 * "cargos 76,70 · pagos 0". El sistema le pedía en el check-out plata que ya había pagado.
 *
 * Un cobro por Stripe Checkout SÍ bumpea `deposit` además de asentar el pago (`depositMirror`),
 * así que se resta: sumarlo entero acreditaría dos veces el mismo dinero.
 */
export function depositOnlyPrepaid(
  deposit: number | null | undefined,
  rows: readonly PrepaidSourceRow[] | null | undefined,
): number {
  const dep = Number(deposit) || 0
  if (dep <= 0) return 0
  const { depositMirror } = splitPayments(rows as any[])
  return round2(Math.max(0, dep - depositMirror))
}

/** Línea de folio para ese anticipo. `reference` estable: correr el check-in dos veces no duplica. */
export function depositPrepaidLine(reservationId: string, amount: number): PrepaidLine | null {
  if (!(amount > 0)) return null
  return {
    paymentId: `deposit:${reservationId}`,
    kind: 'payment',
    amount: round2(amount),
    method: 'manual',
    description: 'Anticipo de la reserva',
  }
}

/**
 * Recorta las líneas para que el folio NO quede en negativo.
 *
 * Un huésped que pagó la estadía entera y después la acortó tiene más plata puesta que consumo:
 * acreditarla toda dejaba el folio con saldo negativo (verificado en dev: cargos 100,30 · pagos
 * 255 · saldo −154,70), y el cierre emitía una factura con `amountPaid` mayor que su propio total.
 *
 * El sobrante NO se pierde ni se inventa como pago de este folio: queda a favor en la RESERVA
 * (`creditBalance`), que es donde se ve y desde donde se devuelve. Las devoluciones (`kind:'charge'`)
 * no se tocan: suben el debe, nunca lo bajan.
 */
export function capPrepaidLines(lines: readonly PrepaidLine[], maxCredit: number): PrepaidLine[] {
  let restante = round2(Math.max(0, Number(maxCredit) || 0))
  const out: PrepaidLine[] = []
  for (const l of lines) {
    if (l.kind === 'charge') { out.push(l); continue }
    if (restante <= 0) continue
    const monto = round2(Math.min(l.amount, restante))
    restante = round2(restante - monto)
    out.push(monto === l.amount ? l : { ...l, amount: monto, description: `${l.description} (parcial)` })
  }
  return out
}
