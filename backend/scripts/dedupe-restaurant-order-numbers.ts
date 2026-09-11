// scripts/dedupe-restaurant-order-numbers.ts — GitHub #208 (REST-06), deuda de la auditoría de #206.
//
// Por qué existe: el numerador viejo de comandas (read-modify-write, #206) generaba `CMD-2026-NNNN`
// repetidos dentro del mismo hotel. El UNIQUE `idx_restaurant_orders_hotel_number` que lo cierra no se
// puede crear mientras haya duplicados, y `migrate-db.ts` se tragaba ese fallo con un `console.log`:
// en prod el índice podía no existir y nadie se enteraba. Esto deduplica ANTES de crear el índice.
//
// Regla: por cada (hotelId, number) repetido se conserva la comanda MÁS VIEJA con su número tal cual
// (es la que salió impresa primero) y las siguientes pasan a `<number>-D1`, `-D2`, ... El sufijo, y no
// "la secuencia siguiente", porque (a) deja rastro de qué número tenía la comanda en el ticket que ya
// se entregó, y (b) nunca puede chocar con el numerador (`formatOrderNumber` no emite sufijos), así
// que no hay que tocar el contador de `configuration`. Idempotente: la segunda corrida no encuentra
// grupos y no escribe nada.
//
// Aliases snake_case en los SELECT a propósito: los adapters crudos no remapean y Postgres pliega
// `hotelId` a `hotelid` — `row.hotelId` daría undefined en prod (mismo criterio que
// backfill-restaurant-pay-permission.ts). `updatedAt` sin comillas en el UPDATE: PG lo pliega a
// `updatedat`, que es como la creó el ORM.

import type { DbAdapter } from 'arckode-framework'

export interface RenumberedOrder { id: string; hotelId: string; from: string; to: string }
export interface DedupeResult { groups: number; renumbered: RenumberedOrder[] }

interface DupeGroup { hotel_id: string; number: string; c: number }
interface OrderRow { id: string; opened_at: string | null; created_at: string | null }

/** La comanda más vieja primero: openedAt, después createdAt, después id (determinista en ambos motores). */
export function sortOldestFirst(rows: OrderRow[]): OrderRow[] {
  const key = (r: OrderRow) => String(r.opened_at ?? r.created_at ?? '')
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)) || String(a.id).localeCompare(String(b.id)))
}

/**
 * Renumera los duplicados de `restaurant_orders` (hotelId, number). Devuelve qué cambió para que
 * `migrate-db.ts` lo imprima: cada renumeración es una comanda cuyo número visible cambió.
 */
export async function dedupeRestaurantOrderNumbers(db: Pick<DbAdapter, 'query' | 'run'>): Promise<DedupeResult> {
  const groups = (await db.query(
    `SELECT hotelId AS hotel_id, number, COUNT(*) AS c FROM restaurant_orders
     WHERE number IS NOT NULL GROUP BY hotelId, number HAVING COUNT(*) > 1`,
  )) as DupeGroup[]

  const renumbered: RenumberedOrder[] = []
  for (const g of groups) {
    const rows = (await db.query(
      `SELECT id, openedAt AS opened_at, createdAt AS created_at FROM restaurant_orders WHERE hotelId = ? AND number = ?`,
      [g.hotel_id, g.number],
    )) as OrderRow[]
    const [, ...newer] = sortOldestFirst(rows)   // la más vieja conserva el número
    let suffix = 0
    for (const row of newer) {
      let candidate: string
      do {
        suffix++
        candidate = `${g.number}-D${suffix}`
      } while (await numberTaken(db, g.hotel_id, candidate))
      await db.run('UPDATE restaurant_orders SET number = ?, updatedAt = ? WHERE id = ?', [candidate, new Date().toISOString(), row.id])
      renumbered.push({ id: row.id, hotelId: g.hotel_id, from: g.number, to: candidate })
    }
  }
  return { groups: groups.length, renumbered }
}

async function numberTaken(db: Pick<DbAdapter, 'query'>, hotelId: string, number: string): Promise<boolean> {
  const rows = (await db.query('SELECT COUNT(*) AS c FROM restaurant_orders WHERE hotelId = ? AND number = ?', [hotelId, number])) as Array<{ c: number }>
  return Number(rows[0]?.c ?? 0) > 0
}
