// connectors/tests/payments-caja.test.ts — Cableado payments→caja.
//
// Solo el efectivo mueve el cajón físico, y el punto de venta (register) lo decide el
// metadata.source que puso el módulo que originó el cobro — nunca el cliente. Un pago del POS
// de restaurante debe caer en la caja del restaurante, no en la de recepción.

import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { paymentsCajaConnector } from '../payments-caja'

const payment = (over: Record<string, any> = {}) => ({
  id: 'p1', hotelId: 'h1', amount: 100, method: 'cash', folioId: 'f1', reference: 'ref',
  metadata: {},
  ...over,
})

function mount() {
  const registered: any[] = []
  let sockets: any = {}
  const caja = { registerPaymentIncome: async (i: any) => { registered.push(i); return {} } }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'payments') return { setSockets: (s: any) => { sockets = s } }
      if (name === 'caja') return caja
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  paymentsCajaConnector(ctx)
  return { sockets, registered }
}

describe('paymentsCajaConnector', () => {
  it('un pago sin metadata.source (folio, link de pago, cargo de reserva) cae en reception', async () => {
    const { sockets, registered } = mount()
    await sockets.onPaymentCompleted(payment())
    expect(registered[0].register).toBe('reception')
  })

  it('un pago con metadata.source=restaurant cae en la caja del restaurante', async () => {
    const { sockets, registered } = mount()
    await sockets.onPaymentCompleted(payment({ metadata: { source: 'restaurant' } }))
    expect(registered[0].register).toBe('restaurant')
  })

  it('un metadata.source desconocido (no restaurant) sigue cayendo en reception, no lo inventa', async () => {
    const { sockets, registered } = mount()
    await sockets.onPaymentCompleted(payment({ metadata: { source: 'algo-random' } }))
    expect(registered[0].register).toBe('reception')
  })

  // #212: el movimiento de caja tiene que poder enlazar la comanda (reference `pos:<orderId>`) y
  // decir qué mesa fue (description del payment como concepto).
  it('el movimiento hereda reference y description del payment (enlace y concepto)', async () => {
    const { sockets, registered } = mount()
    await sockets.onPaymentCompleted(payment({
      metadata: { source: 'restaurant', orderId: 'o1' }, reference: 'pos:o1',
      description: 'Comanda CMD-2026-0007 · Mesa 3',
    }))
    expect(registered[0].reference).toBe('pos:o1')
    expect(registered[0].concept).toBe('Comanda CMD-2026-0007 · Mesa 3')
  })

  it('pagos con tarjeta/transferencia no tocan caja (ya están bancarizados)', async () => {
    const { sockets, registered } = mount()
    await sockets.onPaymentCompleted(payment({ method: 'card' }))
    expect(registered.length).toBe(0)
  })
})
