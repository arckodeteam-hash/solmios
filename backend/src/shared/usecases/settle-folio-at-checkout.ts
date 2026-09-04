import { round2 } from '../utils/money'

export interface SettleFolioParams {
  reservationId: string
  hotelId: string
  guestId: string | null
  roomId: string | null
  settle?: {
    amount: number
    method: string
    reference?: string
  } | null
}

/** Lo realmente cobrado de la reserva (`deposit` + `payments`, sin duplicar). */
export interface SettleCreditDeps {
  paidOf(reservationId: string): Promise<number>
}

export interface SettleFolioResult {
  folioId: string
  invoiceId: string | null
  /** Lo que QUEDA por cobrar de la factura. Cuenta todo lo pagado, no sólo lo del mostrador. */
  balance: number
  /**
   * Cuánto de esta factura está pagado. Antes valía sólo el efectivo tomado en el mostrador, así
   * que una estadía saldada con un anticipo se informaba como "pagado 0 · debe 141,60" aunque el
   * folio hubiera cerrado en cero y la factura naciera paga.
   */
  amountPaid: number
  invoiceNumber: string | null
}

/**
 * Liquida la estadía al hacer check-out.
 *
 * El dinero se asienta UNA sola vez: `folios.applyPayment` lo registra en `payments` (caja +
 * conciliación) y la factura emitida al cerrar el folio hereda ese monto como `amountPaid`.
 * Ya no recibe `facturas`: la emisión la hace `folios.closeAndCreateInvoice` vía connector.
 */
export async function settleFolioAtCheckout(
  folios: any,
  params: SettleFolioParams,
  user: any,
  credit?: SettleCreditDeps,
): Promise<SettleFolioResult> {
  const { reservationId, hotelId, guestId, roomId, settle } = params

  const foliosList = await folios.list({ reservationId, status: 'open' }, user)
  let folio = foliosList.data?.[0]

  if (!folio) {
    folio = await folios.open({ hotelId, reservationId, guestId, roomId }, user)
  }

  if (settle && settle.amount > 0) {
    await folios.applyPayment(folio.id, {
      amount: settle.amount,
      method: settle.method,
      reference: settle.reference,
    }, user)
  }

  // El crédito del huésped se descuenta ACÁ, al cerrar la cuenta: si el hotel ya tiene plata suya
  // que el folio no refleja —un anticipo cargado a mano (vive sólo en `reservations.deposit`, no
  // deja fila en `payments`), o una estadía que se acortó después del check-in— se acredita antes
  // de facturar. Sin esto el huésped pagaba dos veces: verificado en dev el 2026-09-04 con un
  // anticipo de 195 y un folio que igual pedía 76,70.
  //
  // Va DESPUÉS del cobro del mostrador a propósito: si fuera antes, el `settle.amount` que el
  // recepcionista ya tomó en mano podría exceder el saldo nuevo y `applyPayment` lo rechazaría.
  // `postPrepaidCredit` es idempotente y se topea al saldo: nunca acredita dos veces ni deja el
  // folio en negativo — el sobrante queda a favor en la reserva, que es donde se ve y se devuelve.
  if (credit && typeof folios.postPrepaidCredit === 'function') {
    const pagado = Number(await credit.paidOf(reservationId)) || 0
    const actual = await folios.getById(folio.id, user)
    const falta = round2(pagado - Number(actual?.paymentsTotal ?? 0))
    if (falta > 0) {
      await folios.postPrepaidCredit(folio.id, {
        amount: falta,
        reference: `prepaid:${reservationId}`,
        description: 'Pago anticipado de la reserva',
      }, user)
    }
  }

  // El balance y los cargos vienen del folio enriquecido (getById los computa). No hay getBalance().
  const folioAfterPayment = await folios.getById(folio.id, user)
  const chargesTotal = Number(folioAfterPayment?.chargesTotal ?? 0)

  // Folio sin cargos (roomRate 0 y sin extras): no hay nada que facturar → se cierra sin comprobante.
  if (chargesTotal <= 0) {
    await folios.close(folio.id, user)
    return {
      folioId: folio.id,
      invoiceId: null,
      balance: 0,
      amountPaid: round2(Number(folioAfterPayment?.paymentsTotal ?? 0)),
      invoiceNumber: null,
    }
  }

  // Con cargos, SIEMPRE se emite comprobante — haya o no saldo pendiente. Antes, si el pago saldaba
  // el folio (balance <= 0) se cerraba con `folios.close()` SIN factura, y una estadía pagada al 100%
  // quedaba sin comprobante para el huésped. `closeAndCreateInvoice` hereda el pago ya asentado
  // (`amountPaid = paymentsTotal`, close-and-invoice.ts) SIN volver a moverlo en caja/conciliación.
  const { folio: closedFolio, invoice } = await folios.closeAndCreateInvoice(folio.id, user)

  // La factura hereda como pagado TODO lo que el folio tenía asentado (close-and-invoice.ts:
  // `amountPaid = paymentsTotal`), no sólo el efectivo del mostrador: el anticipo también cuenta.
  const amountPaid = round2(Number(folioAfterPayment?.paymentsTotal ?? 0))

  return {
    folioId: closedFolio?.id || folio.id,
    invoiceId: invoice.id,
    balance: Math.max(0, round2((invoice.amount ?? 0) - amountPaid)),
    amountPaid,
    invoiceNumber: invoice.invoiceNumber || '',
  }
}
