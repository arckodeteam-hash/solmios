// scripts/backfill-restaurant-pay-permission.ts — GitHub #205 (REST-03).
//
// Por qué existe: `restaurant:pay` es nuevo. Los permisos EFECTIVOS de un usuario salen de la fila de
// `roles` (`loadPermissions` la lee y `getRolePermissions` la usa EN LUGAR del mapa estático cuando
// trae permisos válidos), y las filas sembradas antes de este permiso no lo tienen. Con el deploy,
// /bill, /pay y /charge-to-room pasan a exigirlo → sin este backfill, el mozo y la recepción de TODO
// hotel existente comen 403 al cobrar, y el hotel_admin tampoco puede cobrar ni auto-repararse.
//
// Por eso NO es un script aparte que alguien tenga que acordarse de correr: lo llama `migrate-db.ts`,
// que el auto-deploy ejecuta en cada deploy. Idempotente: la segunda corrida no escribe nada.
//
// Regla (la validó el auditor de #205): se agrega `restaurant:pay` SOLO a filas cuyos permisos
// VÁLIDOS (`isValidPermission` de shared/permissions — formato `modulo:accion`) hoy incluyan
// `restaurant:edit`, que era lo que antes habilitaba cobrar. Nada más:
//   - fila con `permissions = []`, JSON corrupto o formato viejo (`billing.read`, con punto): NO se
//     toca. En runtime esas filas caen al mapa estático (que ya trae `pay` para los roles que
//     cobran); escribir `['restaurant:pay']` pelado las dejaría con ESE único permiso.
//   - `kitchen` (rol de sistema cuyo default NO incluye `pay`): NO se toca aunque tenga `edit`.
//     El issue es exactamente que cocina deje de cobrar; darle `pay` en el backfill lo anularía.
//   - rol custom ("Cajero") con `restaurant:edit`: SÍ, conserva lo que hoy puede hacer.
//   - fila que ya tiene `restaurant:pay`: NO se toca (idempotencia).
// Nunca quita nada: escribe el array original + `restaurant:pay`.
//
// Columnas SIN camelCase en el SELECT a propósito (`id`, `name`, `permissions`): los adapters crudos
// no remapean y Postgres pliega `hotelId` a `hotelid` — un `row.hotelId` daría undefined en prod.
// `updatedAt` en el UPDATE va sin comillas: PG lo pliega a `updatedat`, que es como la creó el ORM.

import type { DbAdapter } from 'arckode-framework'
import { DEFAULT_ROLE_PERMISSIONS, isValidPermission } from '../src/shared/permissions'

export const PAY_PERMISSION = 'restaurant:pay'
/** Lo que ANTES de #205 habilitaba cobrar en el POS (/bill, /pay, /charge-to-room). */
const LEGACY_PAY_PERMISSION = 'restaurant:edit'

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
export function payPermissionsFor(name: string, raw: unknown): string[] | null {
  const original = parsePermissions(raw)
  if (!original) return null // JSON corrupto / no-array → cae al default en runtime, no se toca
  const valid = original.filter(isValidPermission)
  if (valid.length === 0) return null // [] o formato viejo → el default ya trae pay; escribir lo rompería
  if (valid.includes(PAY_PERMISSION)) return null // ya está
  if (!valid.includes(LEGACY_PAY_PERMISSION)) return null // hoy no cobra → no se le regala
  // Rol de sistema: manda su default. kitchen tiene edit y NO pay: es el caso que #205 corrige.
  const systemDefault = DEFAULT_ROLE_PERMISSIONS[name]
  if (systemDefault && !systemDefault.includes(PAY_PERMISSION)) return null
  return [...original.filter((p): p is string => typeof p === 'string'), PAY_PERMISSION]
}

/**
 * Agrega `restaurant:pay` a las filas de `roles` que hoy cobran vía `restaurant:edit`. Devuelve
 * cuántas filas escribió (0 en la segunda corrida). Sólo se llama desde `migrate-db.ts` y su test.
 */
export async function backfillRestaurantPayPermission(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const rows = (await db.query('SELECT id, name, permissions FROM roles')) as Array<{ id: string; name: string; permissions: unknown }>
  let written = 0
  for (const row of rows) {
    const next = payPermissionsFor(String(row.name), row.permissions)
    if (!next) continue
    await db.run('UPDATE roles SET permissions = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(next), new Date().toISOString(), row.id])
    written++
  }
  return written
}
