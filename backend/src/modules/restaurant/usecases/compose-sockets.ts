// restaurant/usecases/compose-sockets.ts — Composición de sockets del módulo: cada conector aporta
// handlers y ninguno pisa al anterior (folios, payments, accounting e inventario cuelgan todos de
// `onOrderPaid`, por ejemplo). Extraído del service (#207) para mantenerlo por debajo del límite de líneas.
import type { RestaurantSockets } from '../sockets'

/** Acumula `next` sobre `current` in-place: si ya había handler, se encadenan en orden de registro. */
export function composeSockets(current: RestaurantSockets, next: Partial<RestaurantSockets>): void {
  const cur = current as Record<string, any>
  const add = next as Record<string, any>
  for (const key of Object.keys(add)) {
    const h = add[key]
    if (!h) continue
    const prev = cur[key]
    cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
  }
}
