// connectors/restaurante-inventario.ts — POS → Inventario (INT-1). SOLO cablea sockets del módulo
// restaurant a métodos del módulo inventario. Best-effort: un fallo de stock NUNCA rompe el cobro /
// reembolso del payment. La lógica de descuento/reversión vive en el módulo inventario (usecases
// recipes.consumeForSale y revert-pos-sale); el conector solo adapta la orden y delega.
// Idempotente por línea: el ledger dedup por (source, sourceId) y sourceId incluye el lineId.
// Usa un super_admin sintético: el hotelId viene de la comanda (contexto de sistema, sin request user).
import type { ConnectorContext } from 'arckode-framework'

interface RestaurantModule {
  getOrder: (id: string, user: any) => Promise<{ hotelId: string; lines?: any[] } | any>
}
interface InventarioModule {
  consumeForSale: (input: { hotelId: string; menuItemId: string; soldQty: number; lineId: string }, user: any) => Promise<void>
  // F1 (carta-experiencia-avanzada): consumo extra por modificador elegido (línea completa, parseo vive
  // en inventario/usecases/recipes.ts — el conector no conoce la forma de `modifiers`).
  consumeForSaleWithModifiers: (input: { hotelId: string; line: any }, user: any) => Promise<void>
  revertPosSale: (input: { hotelId: string; lineIds: string[] }, user: any) => Promise<void>
  menuItemsWithRecipe: (user: any) => Promise<string[]>
  // F3 (carta-experiencia-avanzada): costo de receta de un ítem, para el puerto getRecipeCost.
  recipeCost: (menuItemId: string, user: any) => Promise<{ cost: number; hasRecipe: boolean }>
}

// #207: una línea `voided` (anulada con motivo) tampoco consume ni revierte stock — nunca se cobró.
const isDeadLine = (l: any): boolean => l.status === 'cancelled' || l.status === 'voided'

/** Descuenta stock por cada línea viva (ni cancelada ni anulada) con menuItemId. Best-effort: no rompe la liquidación. */
async function consumeOrder(order: any, restaurant: RestaurantModule, inv: InventarioModule): Promise<void> {
  try {
    const sys = { id: 'system', hotelId: order.hotelId, role: 'super_admin' }
    const full = await restaurant.getOrder(order.id, sys)
    const lines = ((full?.lines ?? []) as any[]).filter((l) => l.menuItemId && !isDeadLine(l))
    for (const l of lines) {
      await inv.consumeForSale({ hotelId: order.hotelId, menuItemId: l.menuItemId, soldQty: Number(l.quantity) || 0, lineId: l.id }, sys)
      // consumeForSaleWithModifiers ya no-opea sola si la línea no trae modifiers (sin `if` acá: el
      // conector solo delega, el parseo/chequeo vive en inventario/usecases/recipes.ts, D2).
      await inv.consumeForSaleWithModifiers({ hotelId: order.hotelId, line: l }, sys)
    }
  } catch { /* best-effort: no rompe la liquidación de la comanda */ }
}

/** Delega la reversión de stock al módulo inventario (crea `in` pos_refund espejo de los `out`). Best-effort. */
async function revertOrder(order: any, restaurant: RestaurantModule, inv: InventarioModule): Promise<void> {
  try {
    const sys = { id: 'system', hotelId: order.hotelId, role: 'super_admin' }
    const full = await restaurant.getOrder(order.id, sys)
    const lineIds = ((full?.lines ?? []) as any[])
      .filter((l) => l.menuItemId && !isDeadLine(l))
      .map((l) => String(l.id))
    await inv.revertPosSale({ hotelId: order.hotelId, lineIds }, sys)
  } catch { /* best-effort: no rompe el reembolso del payment */ }
}

export function restauranteInventarioConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<{ setSockets: (s: any) => void; setRecipePorts?: (p: any) => void } & RestaurantModule>('restaurant')
  const inventario = () => ctx.resolveModule<InventarioModule>('inventario')

  restaurant.setRecipePorts?.({
    menuItemsWithRecipe: (user: any) => inventario().menuItemsWithRecipe(user),
    getRecipeCost: (menuItemId: string, user: any) => inventario().recipeCost(menuItemId, user),
  })

  restaurant.setSockets({
    onOrderPaid: (order: any) => consumeOrder(order, restaurant, inventario()),
    onOrderCharged: (order: any) => consumeOrder(order, restaurant, inventario()),
    onOrderRefunded: (order: any) => revertOrder(order, restaurant, inventario()),
  })
}
