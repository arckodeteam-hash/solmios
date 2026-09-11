// connectors/restaurante-events.ts — #211: los hooks del POS (sockets.ts) alimentan el canal en vivo
// (SSE) del mismo módulo. Antes esos sockets no tenían ningún consumidor: el KDS se enteraba de una
// comanda nueva recién en el próximo polling de 15 s. Este conector solo MAPEA socket → evento y lo
// publica en el hub del hotel de la comanda/mesa (`publishEvent`); quién está conectado y qué hace
// con el evento es cosa del módulo (usecases/events.ts) y del navegador (useRestaurantEvents.ts).
//
// Mapa: onOrderSent → order.sent (con las estaciones de las líneas, para que suene solo la pantalla
// que corresponde) · onLineStatusChanged → line.status · onOrderPaid/onOrderCharged/onOrderClosed →
// order.closed (las tres formas en que una comanda sale del circuito cocina/salón) · onTableChanged →
// table.changed. onOrderRefunded no se mapea: la comanda ya estaba cerrada cuando se reembolsa.

import type { ConnectorContext } from 'arckode-framework'
import type { RestaurantSockets, RestaurantEvent } from '../modules/restaurant'

interface RestaurantLive {
  setSockets: (s: Partial<RestaurantSockets>) => void
  publishEvent: (hotelId: string, event: Omit<RestaurantEvent, 'at'>) => void
}

export function restauranteEventsConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<RestaurantLive>('restaurant')

  restaurant.setSockets({
    onOrderSent: async (order, lines) => {
      const stationIds = [...new Set(lines.map((l) => l.stationId ?? ''))]
      restaurant.publishEvent(order.hotelId, { type: 'order.sent', orderId: order.id, tableId: order.tableId, status: order.status, stationIds })
    },
    onLineStatusChanged: async (line) => {
      restaurant.publishEvent(line.hotelId, { type: 'line.status', orderId: line.orderId, lineId: line.id, status: line.status, stationIds: [line.stationId ?? ''] })
    },
    onOrderPaid: async (order) => {
      restaurant.publishEvent(order.hotelId, { type: 'order.closed', orderId: order.id, tableId: order.tableId, status: order.status })
    },
    onOrderCharged: async (order) => {
      restaurant.publishEvent(order.hotelId, { type: 'order.closed', orderId: order.id, tableId: order.tableId, status: order.status })
    },
    onOrderClosed: async (order) => {
      restaurant.publishEvent(order.hotelId, { type: 'order.closed', orderId: order.id, tableId: order.tableId, status: order.status })
    },
    onTableChanged: async (table) => {
      restaurant.publishEvent(table.hotelId, { type: 'table.changed', tableId: table.id, status: table.status })
    },
  })
}
