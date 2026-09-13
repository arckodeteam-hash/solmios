// scripts/backfill-mealplans-permission.ts — REQ "Gestionar Regímenes desde Configuración Base"
// (#360/#375): "Sin permiso: mealplans:view" en Configuración Base → Regímenes de hoteles ya
// existentes.
//
// Por qué existe: los permisos EFECTIVOS de un usuario salen de la fila de `roles`
// (`loadPermissions` la lee y `getRolePermissions` usa ese array EN LUGAR del mapa estático
// `DEFAULT_ROLE_PERMISSIONS` en cuanto trae algún permiso válido — ver shared/permissions.ts). Toda
// fila de `roles` sembrada ANTES de que `mealplans` existiera como módulo de permisos simplemente
// no lo tiene, y agregarlo al mapa estático en código no la toca: `hotel_admin` de un hotel viejo
// sigue sin `mealplans:view`/`mealplans:edit` hasta que algo reescriba esa fila. Mismo molde que
// `backfill-restaurant-pay-permission.ts` (#205) — se llama desde `migrate-db.ts`, corre en cada
// deploy, no hace falta acordarse de correrlo aparte.
//
// Regla: se agregan los permisos SOLO a filas cuyos permisos VÁLIDOS (`isValidPermission` —
// formato `modulo:accion`) hoy NO incluyen `mealplans:view`/`mealplans:edit`:
//   - fila con `permissions = []`, JSON corrupto o formato viejo (con punto, `billing.read`): NO
//     se toca — esas filas caen al mapa estático en runtime (que YA trae mealplans para
//     hotel_admin), y escribirle un array pelado la dejaría con SOLO esos permisos.
//   - rol de sistema (`hotel_admin`, `receptionist`, `housekeeper`, `supervisor`, `maintenance`,
//     `waiter`, `kitchen`): se agrega SOLO lo que el default ACTUAL de ese rol ya incluye. Hoy
//     sólo `hotel_admin` trae `mealplans:view`/`edit` — a los demás no se les regala nada.
//   - rol CUSTOM (nombre que no matchea ningún default): Regímenes es una pestaña de
//     Configuración Base, así que se usa `settings:edit` (permiso que ya gatea esa pantalla) como
//     señal de "este rol administra Configuración Base" — si lo tiene y le falta `mealplans`,
//     se le agrega view+edit. Un custom SIN `settings:edit` no lo necesitaba antes y no se le
//     regala ahora.
//   - fila que ya tiene `mealplans:view` Y `mealplans:edit`: no se toca (idempotencia).
// Nunca quita nada: escribe el array original + lo que falte.
//
// Columnas SIN camelCase en el SELECT a propósito (`id`, `name`, `permissions`): los adapters
// crudos no remapean y Postgres pliega `hotelId` a `hotelid` — no se usa acá, pero se mantiene el
// mismo molde por consistencia. `updatedAt` en el UPDATE va sin comillas: PG lo pliega a
// `updatedat`, que es como la creó el ORM.

import type { DbAdapter } from 'arckode-framework'
import { DEFAULT_ROLE_PERMISSIONS, isValidPermission } from '../src/shared/permissions'

export const MEALPLANS_PERMISSIONS = ['mealplans:view', 'mealplans:edit'] as const
/** Señal de "este custom role administra Configuración Base" (Regímenes es una de sus pestañas). */
const CONFIG_BASE_PROXY_PERMISSION = 'settings:edit'

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
export function mealPlansPermissionsFor(name: string, raw: unknown): string[] | null {
  const original = parsePermissions(raw)
  if (!original) return null // JSON corrupto / no-array → cae al default en runtime, no se toca
  const valid = original.filter(isValidPermission)
  if (valid.length === 0) return null // [] o formato viejo → el default ya resuelve esto en runtime

  const systemDefault = DEFAULT_ROLE_PERMISSIONS[name]
  const isCustomRole = !systemDefault
  const grantable = isCustomRole
    ? (valid.includes(CONFIG_BASE_PROXY_PERMISSION) ? MEALPLANS_PERMISSIONS : [])
    : MEALPLANS_PERMISSIONS.filter((p) => systemDefault.includes(p))

  const missing = grantable.filter((p) => !valid.includes(p))
  if (missing.length === 0) return null

  return [...original.filter((p): p is string => typeof p === 'string'), ...missing]
}

/**
 * Agrega `mealplans:view`/`mealplans:edit` a las filas de `roles` que hoy administran
 * Configuración Base y no lo tienen. Devuelve cuántas filas escribió (0 en la segunda corrida).
 * Sólo se llama desde `migrate-db.ts` y su test.
 */
export async function backfillMealPlansPermission(db: Pick<DbAdapter, 'query' | 'run'>): Promise<number> {
  const rows = (await db.query('SELECT id, name, permissions FROM roles')) as Array<{ id: string; name: string; permissions: unknown }>
  let written = 0
  for (const row of rows) {
    const next = mealPlansPermissionsFor(String(row.name), row.permissions)
    if (!next) continue
    await db.run('UPDATE roles SET permissions = ?, updatedAt = ? WHERE id = ?', [JSON.stringify(next), new Date().toISOString(), row.id])
    written++
  }
  return written
}
