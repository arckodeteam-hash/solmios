// Lo que el huésped YA pagó tiene que verse en el folio, ni de menos ni de más.
import { describe, it, expect } from 'bun:test'
import {
  depositOnlyPrepaid, depositPrepaidLine, capPrepaidLines, prepaidLinesFrom, prepaidTotal,
} from '../usecases/prepaid-folio-lines'

// El anticipo cargado a mano en el alta vive SOLO en `reservations.deposit`: no deja fila en
// `payments`, así que el folio lo ignoraba y al huésped se le pedía en el check-out plata que ya
// había pagado (verificado en dev el 2026-09-04: pagó 195, folio "cargos 76,70 · pagos 0").
describe('depositOnlyPrepaid — el anticipo que no deja rastro en payments', () => {
  it('sin cobros que lo espejen, entra entero', () => {
    expect(depositOnlyPrepaid(195, [])).toBe(195)
  })

  it('un cobro por Stripe YA espeja el deposit: no se acredita dos veces', () => {
    const stripe = [{ id: 'p1', type: 'charge', status: 'completed', amount: 195, stripeSessionId: 'cs_1' }]
    expect(depositOnlyPrepaid(195, stripe as any)).toBe(0)
  })

  it('espejo parcial: solo entra lo que falta', () => {
    const stripe = [{ id: 'p1', type: 'charge', status: 'completed', amount: 100, stripeSessionId: 'cs_1' }]
    expect(depositOnlyPrepaid(195, stripe as any)).toBe(95)
  })

  it('un cobro en efectivo NO espeja el deposit: son plata distinta', () => {
    const efectivo = [{ id: 'p1', type: 'charge', status: 'completed', amount: 100, method: 'cash' }]
    expect(depositOnlyPrepaid(195, efectivo as any)).toBe(195)
  })

  it('sin anticipo no hay línea', () => {
    expect(depositOnlyPrepaid(0, [])).toBe(0)
    expect(depositPrepaidLine('r1', 0)).toBeNull()
  })

  it('la referencia es estable: correr el check-in dos veces no duplica', () => {
    expect(depositPrepaidLine('r1', 50)!.paymentId).toBe('deposit:r1')
  })
})

// Acreditar más de lo consumido dejaba el folio en saldo NEGATIVO y la factura con `amountPaid`
// mayor que su propio total (verificado en dev: cargos 100,30 · pagos 255 · saldo −154,70).
describe('capPrepaidLines — el folio no queda en negativo', () => {
  const pago = (amount: number, id = 'p') => ({
    paymentId: id, kind: 'payment' as const, amount, method: 'cash', description: 'Pago anticipado',
  })

  it('lo que entra en el consumo pasa entero', () => {
    expect(capPrepaidLines([pago(80)], 100.3).map((l) => l.amount)).toEqual([80])
  })

  it('lo que sobra se recorta al consumo', () => {
    const out = capPrepaidLines([pago(255)], 100.3)
    expect(out[0]!.amount).toBe(100.3)
    expect(out[0]!.description).toContain('parcial')
  })

  it('varias líneas: se llenan hasta el tope y el resto no entra', () => {
    const out = capPrepaidLines([pago(60, 'a'), pago(60, 'b'), pago(60, 'c')], 100)
    expect(out.map((l) => [l.paymentId, l.amount])).toEqual([['a', 60], ['b', 40]])
  })

  it('sin consumo no se acredita nada', () => {
    expect(capPrepaidLines([pago(255)], 0)).toEqual([])
  })

  it('una devolución NO se recorta: sube el debe, no lo baja', () => {
    const dev = { paymentId: 'r', kind: 'charge' as const, amount: 50, method: 'card', description: 'Devolución' }
    const out = capPrepaidLines([dev, pago(255)], 100)
    expect(out[0]).toEqual(dev)
    expect(out[1]!.amount).toBe(100)
  })
})

// Lo que ya existía, cubierto para que el tope de arriba no lo rompa.
describe('prepaidLinesFrom', () => {
  const fila = (o: Record<string, unknown>) => ({ id: 'p1', type: 'charge', status: 'completed', amount: 100, ...o })

  it('un cobro liquidado se refleja como pago del folio', () => {
    const l = prepaidLinesFrom([fila({})] as any)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ kind: 'payment', amount: 100, paymentId: 'p1' })
  })

  it('un pago pendiente no es plata recibida', () => {
    expect(prepaidLinesFrom([fila({ status: 'pending' })] as any)).toHaveLength(0)
  })

  it('un cobro que ya cuelga de un folio no se replica', () => {
    expect(prepaidLinesFrom([fila({ folioId: 'f9' })] as any)).toHaveLength(0)
  })

  it('una devolución entra como CARGO y resta del neto', () => {
    const l = prepaidLinesFrom([fila({}), fila({ id: 'p2', type: 'refund', amount: 30 })] as any)
    expect(l[1]).toMatchObject({ kind: 'charge', amount: 30 })
    expect(prepaidTotal(l)).toBe(70)
  })

  it('no duplica lo que el folio ya tiene referenciado', () => {
    expect(prepaidLinesFrom([fila({})] as any, ['p1'])).toHaveLength(0)
  })
})
