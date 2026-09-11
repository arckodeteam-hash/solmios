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
  const outflows: any[] = []
  let sockets: any = {}
  const caja = {
    registerPaymentIncome: async (i: any) => { registered.push(i); return {} },
    registerRefundOutflow: async (i: any) => { outflows.push(i); return {} },
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'payments') return { setSockets: (s: any) => { sockets = s } }
      if (name === 'caja') return caja
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  paymentsCajaConnector(ctx)
  return { sockets, registered, outflows }
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

// #214 (COR-B): una devolución en efectivo sale del cajón. `refund-direct.ts` asienta un payment
// `type:'refund'` cash; el conector lo escucha por `onRefundProcessed` y asienta el EGRESO en la misma
// caja del ingreso (el arqueo hace `expected = opening + ingresos − egresos`: sin el egreso, el cajero
// que devolvió efectivo en mano cerraba el turno con un "faltante" igual a la devolución).
describe('paymentsCajaConnector — devoluciones', () => {
  const refund = (over: Record<string, any> = {}) => ({
    id: 'r1', hotelId: 'h1', type: 'refund', method: 'cash', amount: 60, reference: 'pos:o1:2:refund',
    description: 'Refund for payment p1', metadata: { source: 'restaurant', orderId: 'o1', orderPaymentId: 'part-2', refundOf: 'p1' },
    ...over,
  })
  it('un payment type=refund en efectivo NO registra ingreso en caja (aunque nazca completed)', async () => {
    const { sockets, registered } = mount()
    await sockets.onPaymentCompleted(refund())
    expect(registered).toHaveLength(0)
  })
  it('onRefundProcessed cash → egreso en la caja del restaurante con el payment devuelto y la referencia al cobro original', async () => {
    const { sockets, outflows } = mount()
    await sockets.onRefundProcessed(refund())
    expect(outflows).toHaveLength(1)
    expect(outflows[0]).toMatchObject({ hotelId: 'h1', paymentId: 'r1', refundOfPaymentId: 'p1', amount: 60, register: 'restaurant', reference: 'pos:o1:2:refund' })
  })
  it('sin metadata.source cae en reception; tarjeta/transferencia no tocan el cajón', async () => {
    const { sockets, outflows } = mount()
    await sockets.onRefundProcessed(refund({ metadata: { refundOf: 'p1' } }))
    expect(outflows[0].register).toBe('reception')
    await sockets.onRefundProcessed(refund({ id: 'r2', method: 'card' }))
    await sockets.onRefundProcessed(refund({ id: 'r3', method: 'transfer' }))
    expect(outflows).toHaveLength(1)
  })
  it('si caja no resuelve, la devolución no falla (best-effort)', async () => {
    let sockets: any = {}
    const ctx = { resolveModule: (name: string) => { if (name === 'payments') return { setSockets: (s: any) => { sockets = s } }; throw new Error('caja no cargada') } } as unknown as ConnectorContext
    paymentsCajaConnector(ctx)
    await expect(sockets.onRefundProcessed(refund())).resolves.toBeUndefined()
  })
})
