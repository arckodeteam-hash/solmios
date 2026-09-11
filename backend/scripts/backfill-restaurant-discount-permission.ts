// scripts/backfill-restaurant-discount-permission.ts — GitHub #215 (REST-13).
//
// Por qué existe: `restaurant:discount` es nuevo. Los permisos EFECTIVOS de un usuario salen de la fila
// de `roles` (`loadPermissions` la lee y `getRolePermissions` la usa EN LUGAR del mapa estático cuando
// trae permisos válidos), y las filas sembradas antes de este permiso no lo tienen. Sin este backfill,
// el deploy deja a hotel_admin y recepción de TODO hotel existente sin el botón "Descuento" (403) hasta
// que alguien edite el rol a mano — y el hotel_admin ni siquiera sabría que tiene que hacerlo.
//
// Mismo molde que `backfill-restaurant-pay-permission.ts` (#205): lo llama `migrate-db.ts`, que el
// auto-deploy ejecuta en cada deploy. Idempotente: la segunda corrida no escribe nada.
//
// Regla (más CONSERVADORA que la de `pay`, porque esto es decidir cobrar MENOS):
//   - solo roles de SISTEMA cuyo default trae `restaurant:discount` (hotel_admin, receptionist). Un
//     rol custom ("Cajero", "Gerente") NO recibe nada: el hotel decide en Roles quién descuenta.
//     `waiter`/`kitchen` tampoco (su default no lo trae: el issue es exactamente que el mozo no).
//   - la fila tiene que tener permisos VÁLIDOS (`isValidPermission`) que incluyan `restaurant:pay`:
//     si el hotel le sacó el POS a recepción, no se le devuelve una parte por la ventana.
//   - fila con `permissions = []`, JSON corrupto o formato viejo (`billing.read`): NO se toca. En runtime
//     cae al mapa estático, que ya trae `discount`; escribir `['restaurant:discount']` pelado la dejaría
//     con ESE único permiso.
//   - fila que ya tiene `restaurant:discount`: NO se toca (idempotencia).
// Nunca quita nada: escribe el array original + `restaurant:discount`.
//
// Columnas SIN camelCase en el SELECT a propósito (`id`, `name`, `permissions`): los adapters crudos no
// remapean y Postgres pliega `hotelId` a `hotelid`. `updatedAt` en el UPDATE va sin comillas: PG lo
// pliega a `updatedat`, que es como la creó el ORM.

import type { DbAdapter } from 'arckode-framework'
import { DEFAULT_ROLE_PERMISSIONS, isValidPermission } from '../src/shared/permissions'

export const DISCOUNT_PERMISSION = 'restaurant:discount'
/** El rol tiene que seguir operando el POS (cobrar) para recibir el descuento. */
const POS_PERMISSION = 'restaurant:pay'

/** `permissions` llega como string (columna TEXT del ORM `json`) o como array si el driver lo parsea. */
function parsePermissions(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Decide qué escribir para una fila. Devuelve el array nuevo o `null` si no hay que tocarla.
 * Puro y exportado para que el test lo pinee caso por caso.
 */
export function discountPermissionsFor(name: string, raw: unknown): string[] | null {
  const systemDefault = DEFAULT_ROLE_PERMISSIONS[name]
  if (!systemDefault || !systemDefault.includes(DISCOUNT_PERMISSION)) return null // custom, waiter, kitchen: no
  const original = parsePermissions(raw)
  if (!original) return null // JSON corrupto / no-array → cae al default en runtime, no se toca
  const valid = original.filter(isValidPermission)
  if (valid.length === 0) return null // [] o formato viejo → el default ya trae discount; escribir lo rompería
  if (valid.includes(DISCOUNT_PERMISSION)) return null // ya está
  if (!valid.includes(POS_PERMISSION)) return null // le sacaron el POS → no se le devuelve una parte
  return [...original.filter((p): p is string => typeof p === 'string'), DISCOUNT_PERMISSION]
}

/**
 * Agrega `restaurant:discount` a las filas de `roles` de sistema que hoy cobran en el POS. Devuelve
 * cuántas filas escribió (0 en la segunda corrida). Sólo se llama desde `migrate-db.ts` y su test.
 */
export async function backfillRestaurantDiscountPermission(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const rows = (await db.query('SELECT id, name, permissions FROM roles')) as Array<{ id: string; name: string; permissions: unknown }>
  let written = 0
  for (const row of rows) {
    const next = discountPermissionsFor(String(row.name), row.permissions)
    if (!next) continue
    await db.run('UPDATE roles SET permissions = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(next), new Date().toISOString(), row.id])
    written++
  }
  return written
}
