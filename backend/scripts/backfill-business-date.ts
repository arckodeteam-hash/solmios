// scripts/backfill-business-date.ts — GitHub #213 (auditoría), día contable de comandas y pagos.
//
// Por qué existe: el cierre del día del restaurante consulta por IGUALDAD `{ hotelId, businessDate }`
// (el ORM no arma rangos), y `ormMigrate` agrega la columna con `ADD COLUMN` sin rellenar las filas
// viejas: toda comanda cerrada y todo pago anteriores a la columna quedarían en NULL — invisibles para
// cualquier cierre, sin error a la vista (mismo molde que `announcements.audience`, CLAUDE.md).
//
// Regla: `businessDate` = fecha 'YYYY-MM-DD' del instante de cierre en la ZONA DEL HOTEL
// (`hotels.timezone`, default de hotel-schedule.ts). Comandas: desde `closedAt` (sólo las que tienen;
// una comanda abierta no tiene día contable). Pagos: desde `processedAt` (cuándo entró la plata) y, si
// no hay, `createdAt`. No se pisa un valor existente: idempotente, la segunda corrida no escribe nada.
//
// Lo llama `migrate-db.ts` (el auto-deploy lo corre en cada deploy). La conversión a zona horaria se
// hace en JS (Intl) y no en SQL: no hay una expresión portable SQLite + Postgres para eso.
//
// Aliases snake_case en los SELECT a propósito: los adapters crudos no remapean y Postgres pliega
// `hotelId` a `hotelid` — `row.hotelId` daría undefined en prod (mismo criterio que
// dedupe-restaurant-order-numbers.ts). Columnas sin comillas en el UPDATE por la misma razón.

import type { DbAdapter } from 'arckode-framework'
import { hotelTimezone } from '../src/shared/utils/hotel-schedule'
import { businessDateOf } from '../src/shared/utils/business-date'

export interface BackfillBusinessDateResult { orders: number; payments: number }

type Db = Pick<DbAdapter, 'query' | 'run'>
interface HotelRow { id: string; timezone: string | null }
interface OrderRow { id: string; hotel_id: string; closed_at: string | null }
interface PaymentRow { id: string; hotel_id: string; processed_at: string | null; created_at: string | null }

async function timezonesByHotel(db: Db): Promise<Map<string, string>> {
  const hotels = (await db.query(`SELECT id, timezone FROM hotels`)) as HotelRow[]
  return new Map(hotels.map((h) => [String(h.id), hotelTimezone({ timezone: h.timezone })]))
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Día contable en la zona del hotel; hotel desconocido → zona por defecto. Null si el instante no sirve.
 * Un valor que ya es sólo fecha ('2026-06-26', como lo sembró migrate-db en `payments.processedAt`) se
 * toma tal cual: parsearlo como medianoche UTC lo correría al día anterior en cualquier zona al oeste.
 */
function dayFor(tz: Map<string, string>, hotelId: string, at: string | null | undefined): string | null {
  if (!at) return null
  const value = String(at).trim()
  if (DATE_ONLY.test(value)) return value
  return businessDateOf(value, tz.get(String(hotelId)) ?? hotelTimezone(null))
}

/** Rellena `restaurant_orders.businessDate` (desde closedAt) donde falta. Devuelve cuántas filas escribió. */
export async function backfillOrdersBusinessDate(db: Db, tz?: Map<string, string>): Promise<number> {
  const zones = tz ?? (await timezonesByHotel(db))
  const rows = (await db.query(
    `SELECT id, hotelId AS hotel_id, closedAt AS closed_at FROM restaurant_orders WHERE businessDate IS NULL AND closedAt IS NOT NULL`,
  )) as OrderRow[]
  let written = 0
  for (const r of rows) {
    const day = dayFor(zones, r.hotel_id, r.closed_at)
    if (!day) continue
    await db.run(`UPDATE restaurant_orders SET businessDate = ? WHERE id = ? AND businessDate IS NULL`, [day, r.id])
    written += 1
  }
  return written
}

/** Rellena `payments.businessDate` (processedAt ?? createdAt) donde falta. Devuelve cuántas filas escribió. */
export async function backfillPaymentsBusinessDate(db: Db, tz?: Map<string, string>): Promise<number> {
  const zones = tz ?? (await timezonesByHotel(db))
  const rows = (await db.query(
    `SELECT id, hotelId AS hotel_id, processedAt AS processed_at, createdAt AS created_at FROM payments WHERE businessDate IS NULL`,
  )) as PaymentRow[]
  let written = 0
  for (const r of rows) {
    const day = dayFor(zones, r.hotel_id, r.processed_at || r.created_at)
    if (!day) continue
    await db.run(`UPDATE payments SET businessDate = ? WHERE id = ? AND businessDate IS NULL`, [day, r.id])
    written += 1
  }
  return written
}

export async function backfillBusinessDate(db: Db): Promise<BackfillBusinessDateResult> {
  const zones = await timezonesByHotel(db)
  return { orders: await backfillOrdersBusinessDate(db, zones), payments: await backfillPaymentsBusinessDate(db, zones) }
}
