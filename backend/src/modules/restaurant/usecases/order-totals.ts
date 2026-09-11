// restaurant/usecases/order-totals.ts — Resolución de estación y recálculo de totales (RES-3).
// Puramente sobre repos del dominio. El impuesto sale de la tasa CONGELADA por línea (snapshot),
// nunca hardcodeado. Ver design.md §Resolución de estación + specs/billing-payment.
import type { RepositoryAdapter } from 'arckode-framework'
import type { OrderDTO, OrderItemDTO, MenuItemDTO, CategoryDTO, StationDTO, OrderItemModifierSnapshot } from '../types'
import { round2 } from '../../../shared/utils/money'

/**
 * Total neto de una línea: (precio unitario + Σ priceDelta de los modificadores) × cantidad.
 *
 * ÚNICO cálculo de `lineTotal` — lo usan `addLine` y `updateLine`. #206: `updateLine` recalculaba
 * `unitPrice × quantity` por su cuenta y perdía el recargo de los modificadores al cambiar la
 * cantidad (una pizza "+ extra queso 50" pasaba de 1 a 2 y el hotel perdía los 50 de cada una).
 * `unitPrice` es el snapshot NETO (sin modificadores); el ajuste vive en el snapshot `modifiers`
 * de la línea, así que no hace falta releer el catálogo (que puede haber cambiado).
 */
export function computeLineTotal(
  unitPrice: number,
  modifiers: Pick<OrderItemModifierSnapshot, 'priceDelta'>[] | null | undefined,
  quantity: number,
): number {
  const delta = (modifiers ?? []).reduce((sum, m) => sum + Number(m?.priceDelta || 0), 0)
  return round2((Number(unitPrice || 0) + delta) * quantity)
}

/** "HH:mm" → minutos desde medianoche. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * F6 — ¿el ítem está disponible AHORA por franja horaria? `availableFrom`/`availableTo` ambos
 * null/undefined → sin restricción, siempre `true` (compat retro total). Compara la hora del
 * SERVIDOR (`now`, sin conversión a `hotel.timezone` — deuda ya documentada y compartida con
 * `attendance`, D10, NO se resuelve acá). Franja que cruza medianoche (`availableFrom > availableTo`,
 * ej. 22:00-02:00) se evalúa como `hora >= availableFrom OR hora <= availableTo`.
 * Ver specs/menu-featured-availability/spec.md.
 */
export function isWithinAvailabilityWindow(
  item: Pick<MenuItemDTO, 'availableFrom' | 'availableTo'>,
  now: Date,
): boolean {
  if (!item.availableFrom || !item.availableTo) return true
  const from = toMinutes(item.availableFrom)
  const to = toMinutes(item.availableTo)
  const current = now.getHours() * 60 + now.getMinutes()
  if (from <= to) return current >= from && current <= to
  return current >= from || current <= to   // cruza medianoche
}

/**
 * Resuelve la estación (pantalla KDS) de una línea: override del ítem → estación de la categoría →
 * primera estación activa del hotel → ninguna. Devuelve id + nombre para snapshotear en la línea.
 */
export async function resolveStation(
  deps: { categories: RepositoryAdapter<CategoryDTO>; stations: RepositoryAdapter<StationDTO> },
  item: MenuItemDTO, hotelId: string,
): Promise<{ stationId?: string; stationName?: string }> {
  let stationId: string | undefined = item.stationId || undefined
  if (!stationId && item.categoryId) {
    const cat = await deps.categories.findOne({ id: item.categoryId })
    stationId = cat?.stationId || undefined
  }
  if (!stationId) {
    const all = (await deps.stations.findMany({ hotelId })) as StationDTO[]
    const active = all.filter((s) => (s.active ?? 1) === 1).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    stationId = active[0]?.id
  }
  if (!stationId) return { stationId: undefined, stationName: undefined }
  const st = await deps.stations.findOne({ id: stationId })
  return { stationId, stationName: st?.name }
}

/**
 * Recalcula subtotal (neto), tax (por tasa congelada de cada línea) y total (+ tip) de una comanda a
 * partir de sus líneas NO canceladas, y persiste el resultado. Devuelve el pedido actualizado.
 */
export async function recomputeTotals(
  deps: { orders: RepositoryAdapter<OrderDTO>; lines: RepositoryAdapter<OrderItemDTO> },
  order: OrderDTO,
): Promise<OrderDTO> {
  const all = (await deps.lines.findMany({ orderId: order.id })) as OrderItemDTO[]
  const active = all.filter((l) => l.status !== 'cancelled')
  let subtotal = 0, tax = 0
  for (const l of active) {
    const net = Number(l.lineTotal || 0)
    subtotal += net
    tax += (net * Number(l.taxRate || 0)) / 100
  }
  subtotal = round2(subtotal)
  tax = round2(tax)
  const tip = round2(Number(order.tip || 0))
  const total = round2(subtotal + tax + tip)
  const updated = await deps.orders.update(order.id, { subtotal, tax, total } as Partial<Omit<OrderDTO, 'id'>>)
  return (updated as OrderDTO) ?? { ...order, subtotal, tax, total }
}
