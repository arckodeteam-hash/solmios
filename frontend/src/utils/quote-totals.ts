// quote-totals.ts — Matemática PURA de la cotización del planning (sin Vue, testeable sola).
//
// El modal de Cotización redondeaba el impuesto al ENTERO (Math.round): 18% de $360 salía
// $65.00 en la proforma en vez de $64.80, y el total heredaba el error ($425 vs $424.80).
// Es plata que el huésped lee en el documento impreso: se redondea a centavos con el MISMO
// round2 del arqueo (espejo exacto de backend/src/shared/utils/money.ts), no a entero.
import { round2 } from './cash-arqueo'

export interface QuoteRoomLine {
  type: string
  qty: number
  price: number
}

export interface QuoteTotals {
  subtotal: number
  tax: number
  total: number
}

/** Subtotal (Σ cant. × precio × noches), impuesto (tasa % sobre el subtotal) y total,
 *  los tres redondeados a centavos. Entradas NaN/undefined se tratan como 0 (el modal
 *  valida antes de imprimir; esto es defensa del cálculo, no del formulario). */
export function quoteTotals(rooms: QuoteRoomLine[], nights: number, taxRate: number): QuoteTotals {
  const subtotal = round2(rooms.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0) * (Number(nights) || 0), 0))
  const tax = round2(subtotal * (Number(taxRate) || 0) / 100)
  return { subtotal, tax, total: round2(subtotal + tax) }
}
