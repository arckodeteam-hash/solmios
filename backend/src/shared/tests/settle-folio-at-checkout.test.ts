import { describe, it, expect } from 'bun:test'
import { settleFolioAtCheckout } from '../usecases/settle-folio-at-checkout'

// QA-01 (#293): settlement al check-out. El dinero se asienta UNA vez (applyPayment → payments);
// la factura se emite al cerrar el folio y hereda el monto como amountPaid.
//
// orden-checkout-completo (#1): el check-out SIEMPRE emite comprobante si el folio tiene cargos,
// aunque el pago sature el saldo (antes, balance <= 0 cerraba sin factura). Solo un folio SIN
// cargos se cierra sin comprobante.
function makeFolios(opts: { existingFolio?: any; balanceAfter: number; chargesTotal?: number; invoiceAmount?: number }) {
  const calls: Record<string, any[]> = { applyPayment: [], close: [], closeAndCreateInvoice: [], open: [], postPrepaidCredit: [] }
  const folios = {
    list: async () => ({ data: opts.existingFolio ? [opts.existingFolio] : [] }),
    open: async (d: any) => { const f = { id: 'f1', ...d, status: 'open' }; calls.open.push(f); return f },
    applyPayment: async (id: string, p: any) => { calls.applyPayment.push({ id, ...p }) },
    // `paymentsTotal` es lo que el folio tiene asentado — la factura lo hereda como `amountPaid`
    // (close-and-invoice.ts). Por identidad de folio-math: balance = cargos − pagos.
    getById: async (id: string) => ({
      id, balance: opts.balanceAfter, chargesTotal: opts.chargesTotal ?? 0,
      paymentsTotal: (opts.chargesTotal ?? 0) - opts.balanceAfter,
    }),
    postPrepaidCredit: async (id: string, i: any) => { calls.postPrepaidCredit.push({ id, ...i }); return { applied: i.amount } },
    close: async (id: string) => { calls.close.push(id); return { id, status: 'closed' } },
    closeAndCreateInvoice: async (id: string) => {
      calls.closeAndCreateInvoice.push(id)
      return { folio: { id, status: 'closed' }, invoice: { id: 'inv1', amount: opts.invoiceAmount ?? 100, invoiceNumber: 'A-001' } }
    },
  }
  return { folios, calls }
}

const user = { id: 'u1', role: 'hotel_admin', hotelId: 'h1' }
const base = { reservationId: 'r1', hotelId: 'h1', guestId: 'g1', roomId: 'rm1' }

describe('settleFolioAtCheckout (QA-01 + orden-checkout-completo #1)', () => {
  it('pago cubre todo CON cargos: cierra Y emite comprobante (antes cerraba sin factura)', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 0, chargesTotal: 205, invoiceAmount: 205 })
    const result = await settleFolioAtCheckout(folios, { ...base, settle: { amount: 205, method: 'cash' } }, user)
    expect(calls.applyPayment).toHaveLength(1)
    expect(calls.applyPayment[0].amount).toBe(205)
    expect(calls.closeAndCreateInvoice).toHaveLength(1) // ← ahora SIEMPRE factura si hay cargos
    expect(calls.close).toHaveLength(0)                 // ya no cierra directo
    expect(result.invoiceId).toBe('inv1')
    expect(result.invoiceNumber).toBe('A-001')
    expect(result.balance).toBe(0)                      // 205 factura - 205 pagado
  })

  it('queda saldo (balance > 0): cierra Y emite factura con amountPaid heredado', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 50, chargesTotal: 100, invoiceAmount: 100 })
    const result = await settleFolioAtCheckout(folios, { ...base, settle: { amount: 50, method: 'card' } }, user)
    expect(calls.applyPayment).toHaveLength(1)
    expect(calls.closeAndCreateInvoice).toHaveLength(1) // emite factura (un solo paso)
    expect(calls.close).toHaveLength(0)                 // no usa close directo
    expect(result.invoiceId).toBe('inv1')
    expect(result.invoiceNumber).toBe('A-001')
    expect(result.balance).toBe(50)                     // 100 factura - 50 pagado
  })

  it('folio SIN cargos (chargesTotal 0): cierra sin comprobante', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 0, chargesTotal: 0 })
    const result = await settleFolioAtCheckout(folios, { ...base, settle: { amount: 0, method: 'cash' } }, user)
    expect(calls.close).toHaveLength(1)                 // se cierra directo
    expect(calls.closeAndCreateInvoice).toHaveLength(0) // nada que facturar
    expect(result.invoiceId).toBeNull()
  })

  it('sin settle pero con cargos: no aplica pago y emite factura con saldo pendiente', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 100, chargesTotal: 100, invoiceAmount: 100 })
    const result = await settleFolioAtCheckout(folios, { ...base, settle: null }, user)
    expect(calls.applyPayment).toHaveLength(0)
    expect(calls.closeAndCreateInvoice).toHaveLength(1)
    expect(result.invoiceId).toBe('inv1')
  })

  it('abre el folio si la reserva no tiene uno abierto', async () => {
    const { folios, calls } = makeFolios({ existingFolio: null, balanceAfter: 0, chargesTotal: 0 })
    const result = await settleFolioAtCheckout(folios, { ...base, settle: { amount: 100, method: 'cash' } }, user)
    expect(calls.open).toHaveLength(1)
    expect(result.folioId).toBe('f1')
  })
})

// El crédito del huésped se descuenta al CERRAR la cuenta. Antes, quien había pagado por
// adelantado y después acortó la estadía llegaba al check-out con el folio pidiéndole la plata
// otra vez (verificado en dev el 2026-09-04: anticipo 195, folio "cargos 76,70 · pagos 0").
describe('crédito del huésped al cerrar la cuenta', () => {
  it('lo ya cobrado que el folio no refleja se acredita ANTES de facturar', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 100, chargesTotal: 100, invoiceAmount: 100 })
    await settleFolioAtCheckout(folios, { ...base, settle: null }, user, { paidOf: async () => 195 })
    expect(calls.postPrepaidCredit).toHaveLength(1)
    // 195 cobrados − 0 reflejados en el folio. El tope al saldo lo pone `postPrepaidCredit`.
    expect(calls.postPrepaidCredit[0]).toMatchObject({ id: 'f1', amount: 195, reference: 'prepaid:r1' })
  })

  it('lo que el folio YA refleja no se acredita de nuevo', async () => {
    // 100 de cargos con el folio saldado: los 100 ya están adentro.
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 0, chargesTotal: 100, invoiceAmount: 100 })
    await settleFolioAtCheckout(folios, { ...base, settle: null }, user, { paidOf: async () => 100 })
    expect(calls.postPrepaidCredit).toHaveLength(0)
  })

  it('sin el puerto de crédito el cierre funciona igual que siempre', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 50, chargesTotal: 100, invoiceAmount: 100 })
    const r = await settleFolioAtCheckout(folios, { ...base, settle: { amount: 50, method: 'cash' } }, user)
    expect(calls.postPrepaidCredit).toHaveLength(0)
    expect(r.balance).toBe(50)
  })

  it('el crédito corre DESPUÉS del cobro del mostrador: lo que el recepcionista tomó no se rechaza', async () => {
    const { folios, calls } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 30, chargesTotal: 100, invoiceAmount: 100 })
    await settleFolioAtCheckout(folios, { ...base, settle: { amount: 70, method: 'cash' } }, user, { paidOf: async () => 100 })
    expect(calls.applyPayment).toHaveLength(1)
    expect(calls.applyPayment[0].amount).toBe(70)
    // 100 cobrados − 70 ya reflejados = 30 pendientes de acreditar.
    expect(calls.postPrepaidCredit[0].amount).toBe(30)
  })

  it('la factura informa TODO lo pagado, no sólo el efectivo del mostrador', async () => {
    // Estadía saldada con un anticipo: 100 de cargos, folio en 0, nada cobrado en el mostrador.
    const { folios } = makeFolios({ existingFolio: { id: 'f1', status: 'open' }, balanceAfter: 0, chargesTotal: 100, invoiceAmount: 100 })
    const r = await settleFolioAtCheckout(folios, { ...base, settle: null }, user)
    expect(r.amountPaid).toBe(100)   // antes: 0
    expect(r.balance).toBe(0)        // antes: 100 — decía que el huésped debía una estadía paga
  })
})
