// reservas/usecases/reservation-invoices.ts — Proyección de las facturas de una reserva hacia el
// detalle (REQ-FDR-01, issue #252).
//
// El modal de reserva necesita mostrar e imprimir la factura de la reserva sin salir a buscarla
// por otra pantalla. Las filas salen del puerto reserva→facturas que YA existe
// (`queries.paidRepos.invoiceRepo`, `money-port.ts`), el mismo por el que `paidForReservation`
// llega a `invoices`: no se importa nada de `modules/facturas` (sin import directo entre módulos).
//
// NO se devuelve la fila cruda del módulo facturas: el detalle es un contrato de reservas, y
// exponer `invoices.*` tal cual acoplaría el modal al schema de otro módulo (y filtraría campos que
// el modal no necesita: `hotelId`, `reservationId`, `notes`, `guestId`...). Se proyecta a lo que la
// vista muestra, igual que `toMessageLogViews` con `message_logs`.
//
// Pura, sin I/O: el caller trae las filas y acá sólo se mapea y se ordena.

/** Lo que el modal muestra de cada factura de la reserva. */
export interface ReservationInvoiceView {
  id: string
  /** `invoices.invoiceNumber` — el número visible/imprimible. */
  number: string
  /** 'invoice' | 'credit_note'. */
  type: string
  /** 'pending' | 'paid' | 'overdue' | 'cancelled' | 'draft'. */
  status: string
  /** `invoices.amount` es el TOTAL de la factura (impuestos incluidos). */
  amount: number
  taxes: number
  amountPaid: number
  /** `amount − amountPaid`: la fila no lo trae, se deriva acá para que el modal no lo recalcule. */
  balance: number
  currency: string
  /** `invoices.issueDate` (string, no Date). */
  issuedAt: string
  /** Comprobante fiscal (RD). `null` cuando la factura no lo lleva. */
  ncf: string | null
}

/**
 * Proyecta filas crudas de `invoices` a `ReservationInvoiceView`, de la más reciente a la más
 * vieja (`issueDate` desc; desempate por `createdAt` desc): el modal muestra primero la factura
 * vigente, que es la que se imprime.
 */
export function toReservationInvoiceViews(rows: Record<string, any>[]): ReservationInvoiceView[] {
  const views = (rows ?? []).map((row) => {
    const amount = Number(row?.amount ?? 0)
    const amountPaid = Number(row?.amountPaid ?? 0)
    return {
      view: {
        id: String(row?.id ?? ''),
        number: String(row?.invoiceNumber ?? ''),
        type: String(row?.type ?? ''),
        status: String(row?.status ?? ''),
        amount,
        taxes: Number(row?.taxes ?? 0),
        amountPaid,
        balance: amount - amountPaid,
        currency: String(row?.currency ?? ''),
        issuedAt: String(row?.issueDate ?? ''),
        ncf: row?.ncf ?? null,
      } satisfies ReservationInvoiceView,
      // Sólo para ordenar: no sale en la vista.
      createdAt: String(row?.createdAt ?? ''),
    }
  })
  views.sort((a, b) =>
    b.view.issuedAt.localeCompare(a.view.issuedAt) || b.createdAt.localeCompare(a.createdAt),
  )
  return views.map((v) => v.view)
}
