// config/restaurant-routes.ts — ÚNICA fuente del permiso que exige cada vista del POS (#205).
//
// Antes router, sidebar y vistas no coincidían: el router solo marcaba Carta con `requiresHotelAdmin`
// y el resto se gateaba por `restaurant:view`, que `kitchen` tiene → cocina entraba por URL a Salón,
// Caja y Cobrar aunque el menú se los ocultara. Ahora el router lee `meta.permission` de acá y el
// sidebar deriva sus entradas de la misma tabla: no pueden volver a divergir.
//
// Los permisos espejan los guards del backend (`modules/restaurant/index.ts`, `modules/cash/index.ts`):
//   salon / comanda → `restaurant:create` (abrir comandas y agregar líneas)
//   cocina          → `restaurant:edit`   (mover líneas en el KDS)
//   cobrar          → `restaurant:pay`    (/bill, /pay, /charge-to-room)
//   caja            → `restaurant:create` (cash/index.ts gatea /api/caja/restaurant/* con ese permiso)
//   carta           → `restaurant-catalog:view` (config de la carta, solo hotel_admin)
//   reportes        → `reports:view`   (#213: cierre del día; el consolidado de plata del negocio, mismo
//                                       permiso que el resto de los reportes del hotel — mozo y cocina no)
// Con los roles por defecto (shared/permissions.ts): waiter ve salón/comanda/cobrar/caja, kitchen solo
// cocina, receptionist todo menos carta, hotel_admin todo.

export type RestaurantPermission = `${'restaurant' | 'restaurant-catalog' | 'reports'}:${string}`

export interface RestaurantRoute {
  /** Path relativo al padre `/panel` (como lo declara el router). */
  path: string
  name: string
  permission: RestaurantPermission
  /** Entrada del sidebar (las rutas con `:id` no se listan). */
  menu?: { label: string }
}

export const RESTAURANT_ROUTES: readonly RestaurantRoute[] = [
  { path: 'restaurante/salon', name: 'restaurant-floor', permission: 'restaurant:create', menu: { label: 'Salón' } },
  { path: 'restaurante/comanda/:id', name: 'restaurant-order', permission: 'restaurant:create' },
  { path: 'restaurante/cocina', name: 'restaurant-kds', permission: 'restaurant:edit', menu: { label: 'Cocina y Bar (KDS)' } },
  { path: 'restaurante/cobrar/:id', name: 'restaurant-pay', permission: 'restaurant:pay' },
  { path: 'restaurante/caja', name: 'restaurant-cash', permission: 'restaurant:create', menu: { label: 'Caja' } },
  { path: 'restaurante/carta', name: 'restaurant-menu', permission: 'restaurant-catalog:view', menu: { label: 'Carta' } },
  { path: 'restaurante/reportes', name: 'restaurant-reports', permission: 'reports:view', menu: { label: 'Reportes' } },
]

export function restaurantRoutePath(route: Pick<RestaurantRoute, 'path'>): string {
  return `/panel/${route.path}`
}

/** `restaurant:pay` → ['restaurant', 'pay'] para `hasPermission(perms, module, action)`. */
export function splitPermission(permission: string): [string, string] {
  const i = permission.indexOf(':')
  return [permission.slice(0, i), permission.slice(i + 1)]
}

/**
 * Pantalla de aterrizaje del POS para un rol: la PRIMERA entrada del menú cuyo permiso tiene, o
 * `null` si no tiene ninguna. La usa el redirect de `/panel` para mozo/cocina. Se decide por
 * PERMISO y no por nombre de rol a propósito: un `waiter` cuyo rol de sistema fue personalizado sin
 * `restaurant:create` mandado a Salón por nombre rebotaba por el guard a `/panel`, que lo volvía a
 * mandar a Salón — bucle infinito en prod (vue-router solo lo corta fuera de production).
 */
export function posLandingFor(
  perms: string[] | undefined | null,
  can: (perms: string[] | undefined | null, module: string, action: string) => boolean,
): string | null {
  const entry = RESTAURANT_ROUTES.find((r) => r.menu && can(perms, ...splitPermission(r.permission)))
  return entry ? restaurantRoutePath(entry) : null
}
