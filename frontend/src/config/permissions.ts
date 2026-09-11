// config/permissions.ts — Helpers PUROS de permisos (sin Vue, sin store).
// Espejo del backend (shared/permissions.ts): formato `module:action`, con comodines
// `module:*` y `*:*` (este último = super_admin). Los consumen el composable
// usePermissions (componentes) y el guard del router (fuera de componente).

/**
 * Roles de SISTEMA: su acceso en la UI se decide por nombre de rol (comportamiento
 * histórico, intacto). Solo los roles CUSTOM (los que crea el dueño del hotel) se
 * gatean por permiso granular. Así ningún usuario existente cambia de comportamiento.
 * DEBE coincidir con los roles que el backend define en DEFAULT_ROLE_PERMISSIONS.
 */
export const SYSTEM_ROLES = ['super_admin', 'hotel_admin', 'receptionist', 'housekeeper', 'maintenance', 'supervisor', 'waiter', 'kitchen'] as const

export function isSystemRole(role?: string | null): boolean {
  return !!role && (SYSTEM_ROLES as readonly string[]).includes(role)
}

/** ¿La lista de permisos concede `module:action`? Entiende `*:*` y `module:*`. */
export function hasPermission(perms: string[] | undefined | null, module: string, action: string): boolean {
  if (!perms || perms.length === 0) return false
  return perms.includes('*:*') || perms.includes(`${module}:*`) || perms.includes(`${module}:${action}`)
}

/**
 * Orden estable de las columnas de la matriz de roles (`pages/roles/index.vue`). Solo ORDENA: toda
 * acción que el catálogo (`GET /api/roles/catalog`) traiga y no esté en la lista se agrega al final.
 * Antes era una lista blanca y `pay` (#205, cobrar en el POS) no se dibujaba nunca: el hotel no
 * tenía forma de dar ni quitar el cobro a un rol desde el panel.
 */
export const ACTION_COLUMN_ORDER = ['view', 'create', 'edit', 'delete', 'export', 'checkin', 'checkout', 'pay'] as const

export function orderActionColumns(present: Iterable<string>): string[] {
  const keys = [...new Set(present)]
  const known = ACTION_COLUMN_ORDER.filter((k) => keys.includes(k))
  return [...known, ...keys.filter((k) => !(ACTION_COLUMN_ORDER as readonly string[]).includes(k))]
}
