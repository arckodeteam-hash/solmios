import { describe, it, expect } from 'bun:test'
import { prepaidLinesFrom, prepaidTotal } from '../prepaid-folio-lines'

// El motor web cobra ANTES del check-in, cuando todavía no hay folio. El folio nacía con el
// cargo de la habitación y CERO pagos, y como el checkout factura contra el folio, se volvía a
// cobrar plata ya cobrada (reproducido en producción: pago de 613,60 y folio sin pagos).

const COBRO = { id: 'p1', type: 'charge', status: 'completed', method: 'link', amount: 613.6 }

describe('pagos anticipados → líneas del folio', () => {
  it('un cobro completado se acredita en el folio', () => {
    const [l] = prepaidLinesFrom([COBRO])
    expect(l.kind).toBe('payment')
    expect(l.amount).toBe(613.6)
    expect(l.paymentId).toBe('p1')
    expect(prepaidTotal([l])).toBe(613.6)
  })

  it('un pago PENDIENTE no baja el saldo: no es plata recibida', () => {
    expect(prepaidLinesFrom([{ ...COBRO, status: 'pending' }])).toEqual([])
  })

  it('un pago fallido tampoco', () => {
    expect(prepaidLinesFrom([{ ...COBRO, status: 'failed' }])).toEqual([])
  })

  it('el pago que YA cuelga de un folio no se replica', () => {
    expect(prepaidLinesFrom([{ ...COBRO, folioId: 'f9' }])).toEqual([])
  })

  it('la devolución entra como CARGO, no como pago negativo', () => {
    // `folio-math.computeTotals` suma los pagos con Math.abs(): una línea de pago negativa
    // acreditaría de más en vez de restar.
    const refund = { id: 'p2', type: 'refund', status: 'completed', method: 'card', amount: 100 }
    const lines = prepaidLinesFrom([COBRO, refund])
    const dev = lines.find(l => l.paymentId === 'p2')!
    expect(dev.kind).toBe('charge')
    expect(dev.amount).toBe(100)
    expect(prepaidTotal(lines)).toBe(513.6)
  })

  it('no duplica un pago ya asentado en el folio (idempotencia por reference)', () => {
    expect(prepaidLinesFrom([COBRO], ['p1'])).toEqual([])
  })

  it('un movimiento de caja (withdrawal) no acredita al huésped', () => {
    expect(prepaidLinesFrom([{ ...COBRO, type: 'withdrawal' }])).toEqual([])
  })

  it('monto 0 o basura no genera línea', () => {
    expect(prepaidLinesFrom([{ ...COBRO, amount: 0 }])).toEqual([])
    expect(prepaidLinesFrom([{ ...COBRO, amount: null }])).toEqual([])
    expect(prepaidLinesFrom([{ ...COBRO, id: '' }])).toEqual([])
  })

  it('sin pagos no genera nada', () => {
    expect(prepaidLinesFrom([])).toEqual([])
    expect(prepaidLinesFrom(null)).toEqual([])
  })

  it('varios cobros parciales se acreditan todos', () => {
    const lines = prepaidLinesFrom([
      { id: 'a', type: 'charge', status: 'completed', method: 'link', amount: 200 },
      { id: 'b', type: 'deposit', status: 'completed', method: 'card', amount: 413.6 },
    ])
    expect(lines).toHaveLength(2)
    expect(prepaidTotal(lines)).toBe(613.6)
  })

  it('el mismo pago repetido en la entrada se acredita UNA vez', () => {
    expect(prepaidLinesFrom([COBRO, COBRO])).toHaveLength(1)
  })
})
