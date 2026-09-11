// restaurant/usecases/order-labels.ts — #209: "Hab. 204 · Pérez" en la comanda y en la tarjeta del salón.
// Una comanda de room service guarda `roomId`/`guestId` (heredados de la reserva al abrirla); acá se
// resuelven a número de habitación y nombre del huésped para la respuesta del API. Lectura acotada al
// hotel de la comanda sobre `rooms`/`guests` (tablas de otros módulos, leídas por el ORM como Hotels/
// Users — mismo criterio que kds.ts para el ticket de cocina, #211). NUNCA se persisten: el ORM los
// descartaría en silencio y no son datos de la comanda.
import type { RepositoryAdapter } from 'arckode-framework'
import type { OrderDTO } from '../types'

export interface OrderLabelDeps {
  rooms?: RepositoryAdapter<any>
  guests?: RepositoryAdapter<any>
}

/** Agrega `roomNumber`/`guestName` a las comandas de room service que los tengan resolubles. Muta y devuelve la misma lista. */
export async function withRoomLabels<T extends OrderDTO>(deps: OrderLabelDeps, orders: T[]): Promise<T[]> {
  const targets = orders.filter((o) => o.type === 'room_service' && (o.roomId || o.guestId))
  if (!targets.length) return orders
  const roomCache = new Map<string, string>()
  const guestCache = new Map<string, string>()
  for (const o of targets) {
    if (o.roomId && deps.rooms) {
      if (!roomCache.has(o.roomId)) {
        const room = await deps.rooms.findOne({ id: o.roomId, hotelId: o.hotelId })
        roomCache.set(o.roomId, room?.number ? String(room.number) : '')
      }
      const n = roomCache.get(o.roomId)
      if (n) o.roomNumber = n
    }
    if (o.guestId && deps.guests) {
      if (!guestCache.has(o.guestId)) {
        const guest = await deps.guests.findOne({ id: o.guestId, hotelId: o.hotelId })
        guestCache.set(o.guestId, guest?.name ? String(guest.name) : '')
      }
      const n = guestCache.get(o.guestId)
      if (n) o.guestName = n
    }
  }
  return orders
}
