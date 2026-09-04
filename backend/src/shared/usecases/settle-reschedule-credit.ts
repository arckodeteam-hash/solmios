// shared/usecases/settle-reschedule-credit.ts — Qué se hace con la plata que el huésped pagó DE MÁS
// cuando un cambio de reserva baja el total.
//
// Antes esto no existía: `commitReschedule` calculaba `creditAmount`, lo dejaba en el log de
// auditoría, el frontend lo mostraba una vez en un toast, y ahí moría. `pendingBalance` recorta el
// saldo con `Math.max(0, …)`, así que el excedente tampoco quedaba visible en la reserva — el
// huésped que pagó de más se veía igual que el que pagó justo. La devolución quedaba a cargo de
// que el recepcionista se acordara.
//
// El hotel no tiene por qué saber si corresponde nota de crédito, reembolso a la tarjeta o plata de
// la caja: elige entre DEJAR A FAVOR o DEVOLVER, y la vía la decide esto. Dos reglas que no son
// obvias y por eso están acá y no en el frontend:
//
//   · Devolver a la tarjeta solo se puede si ese cobro entró por Stripe con un cargo real
//     (`stripePaymentId`). Un cobro con tarjeta hecho en el POS del mostrador se registra como pago
//     manual y Stripe no lo conoce: intentar reembolsarlo falla con un error críptico
//     (`payments/usecases/refund.ts`). En ese caso la devolución sale por caja, que es lo que el
//     recepcionista va a hacer igual.
//   · Si la reserva YA tiene factura emitida, devolver la plata no alcanza: el libro de ventas
//     queda descuadrado hasta que se emita la nota de crédito. No se emite sola —una nota de
//     crédito anula la factura ENTERA, no un pedazo— así que se avisa y lo decide una persona.

export type RescheduleCreditAction = 'keep' | 'refund'

/** Fila de `payments` con lo mínimo para decidir por dónde se devuelve. */
export interface CreditPaymentRow {
  id?: string
  type?: string | null
  status?: string | null
  method?: string | null
  amount?: number | null
  /** Solo lo tienen los cobros con un cargo REAL de Stripe (Checkout), no los manuales del POS. */
  stripePaymentId?: string | null
}

export interface RescheduleCreditParams {
  reservationId: string
  hotelId: string
  guestId?: string | null
  currency: string
  /** Lo que pagó de más. Siempre > 0 cuando se llama. */
  amount: number
  action: RescheduleCreditAction
  reason?: string
}

export interface RescheduleCreditResult {
  action: RescheduleCreditAction
  applied: boolean
  /** Por dónde salió la plata. `none` = quedó a favor, no se movió nada. */
  target: 'none' | 'card' | 'cash'
  paymentId?: string
  /** Qué tiene que hacer la persona, si queda algo por hacer. */
  message?: string
  /** La reserva ya tiene factura: falta la nota de crédito para que el libro de ventas cuadre. */
  needsCreditNote?: boolean
}

export interface RescheduleCreditPorts {
  /** Filas de `payments` de la reserva por sus tres vínculos — `collectReservationPayments`. */
  paymentsOf(hotelId: string, reservationId: string): Promise<CreditPaymentRow[]>
  /** Reembolso real por Stripe. Puede fallar: el llamador cae a caja. */
  refundCard(paymentId: string, amount: number): Promise<{ id?: string }>
  /** Devolución por caja: asienta un `payment` de tipo `refund`, que los reportes restan. */
  createCashRefund(dto: {
    hotelId: string
    reservationId: string
    guestId?: string | null
    amount: number
    currency: string
    description: string
  }): Promise<{ id?: string }>
  /** ¿La reserva ya tiene una factura emitida? Decide si además hace falta nota de crédito. */
  hasInvoice(hotelId: string, reservationId: string): Promise<boolean>
}

/** El cobro que se puede devolver por Stripe: entró con tarjeta, está cobrado y tiene cargo real. */
function refundableCard(rows: readonly CreditPaymentRow[]): CreditPaymentRow | null {
  const candidates = rows.filter((p) =>
    String(p?.status ?? '') === 'completed' &&
    String(p?.type ?? '') !== 'refund' &&
    String(p?.method ?? '') === 'card' &&
    !!p?.stripePaymentId &&
    Number(p?.amount ?? 0) > 0)
  // El más grande primero: un reembolso parcial tiene que caber dentro del cobro elegido.
  return candidates.sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0))[0] ?? null
}

export async function settleRescheduleCredit(
  ports: RescheduleCreditPorts,
  params: RescheduleCreditParams,
): Promise<RescheduleCreditResult> {
  const needsCreditNote = await ports.hasInvoice(params.hotelId, params.reservationId).catch(() => false)
  const nota = needsCreditNote
    ? ' La reserva ya tiene factura emitida: emitile la nota de crédito desde Finanzas.'
    : ''

  if (params.action === 'keep') {
    // No se mueve plata: el excedente queda visible en la reserva (`creditBalance`) y se usa al
    // cerrar la cuenta. Es el default seguro — devolver es lo que no se puede deshacer.
    return {
      action: 'keep', applied: true, target: 'none', needsCreditNote,
      message: `Quedan a favor del huésped.${nota}`,
    }
  }

  const desc = `Devolución por cambio de reserva${params.reason ? ` — ${params.reason}` : ''}`
  const rows = await ports.paymentsOf(params.hotelId, params.reservationId).catch(() => [] as CreditPaymentRow[])
  const card = refundableCard(rows)

  if (card?.id) {
    try {
      const refund = await ports.refundCard(String(card.id), params.amount)
      return {
        action: 'refund', applied: true, target: 'card', paymentId: refund?.id,
        needsCreditNote, message: `Devuelto a la tarjeta.${nota}`,
      }
    } catch (e: unknown) {
      // Stripe rechazó (cargo POS sin PI, cobro muy viejo, cuenta sin saldo): NO se pierde la
      // devolución, sale por caja y se dice por qué cambió de vía.
      const motivo = (e as Error)?.message || 'Stripe rechazó la devolución'
      const cash = await ports.createCashRefund({
        hotelId: params.hotelId, reservationId: params.reservationId, guestId: params.guestId ?? null,
        amount: params.amount, currency: params.currency, description: `${desc} (${motivo})`,
      })
      return {
        action: 'refund', applied: true, target: 'cash', paymentId: cash?.id, needsCreditNote,
        message: `No se pudo devolver a la tarjeta (${motivo}). Registrado como devolución en efectivo: entregale el dinero al huésped.${nota}`,
      }
    }
  }

  const cash = await ports.createCashRefund({
    hotelId: params.hotelId, reservationId: params.reservationId, guestId: params.guestId ?? null,
    amount: params.amount, currency: params.currency, description: desc,
  })
  return {
    action: 'refund', applied: true, target: 'cash', paymentId: cash?.id, needsCreditNote,
    message: `Entregale el dinero al huésped: sale de la caja del turno.${nota}`,
  }
}
