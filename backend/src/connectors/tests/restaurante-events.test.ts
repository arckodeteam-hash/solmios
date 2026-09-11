// connectors/tests/restaurante-events.test.ts — #211: el conector solo MAPEA los sockets del POS a
// eventos del canal en vivo y los publica en el hotel correcto. Sin lógica propia.
import { describe, it, expect } from 'bun:test'
import type { ConnectorContext } from 'arckode-framework'
import { restauranteEventsConnector } from '../restaurante-events'

function makeCtx() {
  const captured: any = { sockets: {}, published: [] as Array<{ hotelId: string; event: any }> }
  const restaurant = {
    setSockets: (s: any) => Object.assign(captured.sockets, s),
    publishEvent: (hotelId: string, event: any) => captured.published.push({ hotelId, event }),
  }
  const ctx = {
    resolveModule: (name: string) => {
      if (name === 'restaurant') return restaurant
      throw new Error(`módulo desconocido: ${name}`)
    },
  } as unknown as ConnectorContext
  return { ctx, captured }
}

describe('restauranteEventsConnector', () => {
  it('registra los seis hooks y no toca onOrderRefunded', () => {
    const { ctx, captured } = makeCtx()
    restauranteEventsConnector(ctx)
    expect(Object.keys(captured.sockets).sort()).toEqual(
      ['onLineStatusChanged', 'onOrderCharged', 'onOrderClosed', 'onOrderPaid', 'onOrderSent', 'onTableChanged'],
    )
  })

  it('onOrderSent → order.sent en el hotel de la comanda, con las estaciones de las líneas (sin duplicar)', async () => {
    const { ctx, captured } = makeCtx()
    restauranteEventsConnector(ctx)
    await captured.sockets.onOrderSent(
      { id: 'o1', hotelId: 'h1', tableId: 't1', status: 'sent' },
      [{ id: 'l1', stationId: 's-cocina' }, { id: 'l2', stationId: 's-cocina' }, { id: 'l3' }],
    )
    expect(captured.published).toEqual([
      { hotelId: 'h1', event: { type: 'order.sent', orderId: 'o1', tableId: 't1', status: 'sent', stationIds: ['s-cocina', ''] } },
    ])
  })

  it('onLineStatusChanged → line.status con el estado nuevo y la estación de la línea', async () => {
    const { ctx, captured } = makeCtx()
    restauranteEventsConnector(ctx)
    await captured.sockets.onLineStatusChanged({ id: 'l1', hotelId: 'h9', orderId: 'o1', status: 'ready', stationId: 's-bar' })
    expect(captured.published[0]).toEqual({ hotelId: 'h9', event: { type: 'line.status', orderId: 'o1', lineId: 'l1', status: 'ready', stationIds: ['s-bar'] } })
  })

  it('paid, charged y cancelada son las tres formas de order.closed', async () => {
    const { ctx, captured } = makeCtx()
    restauranteEventsConnector(ctx)
    await captured.sockets.onOrderPaid({ id: 'o1', hotelId: 'h1', tableId: 't1', status: 'paid' })
    await captured.sockets.onOrderCharged({ id: 'o2', hotelId: 'h1', status: 'charged' })
    await captured.sockets.onOrderClosed({ id: 'o3', hotelId: 'h1', tableId: 't2', status: 'cancelled' })
    expect(captured.published.map((p: any) => [p.event.type, p.event.orderId, p.event.status])).toEqual([
      ['order.closed', 'o1', 'paid'], ['order.closed', 'o2', 'charged'], ['order.closed', 'o3', 'cancelled'],
    ])
  })

  it('onTableChanged → table.changed en el hotel de la mesa', async () => {
    const { ctx, captured } = makeCtx()
    restauranteEventsConnector(ctx)
    await captured.sockets.onTableChanged({ id: 't7', hotelId: 'h2', status: 'free' })
    expect(captured.published[0]).toEqual({ hotelId: 'h2', event: { type: 'table.changed', tableId: 't7', status: 'free' } })
  })
})
