import type { MiddlewareHandler } from 'arckode-framework'
import { ForbiddenError } from 'arckode-framework'
import { hasPermission, type Permission } from '../../shared/permissions'

/**
 * Middleware que verifica si el usuario tiene un permiso específico.
 * El permiso se obtiene del rol del usuario (almacenado en la DB).
 *
 * @example
 * router.get('/api/reservations', [requirePermission('reservations', 'view')], handler)
 * router.post('/api/reservations', [requirePermission('reservations', 'create')], handler)
 */
export function requirePermission(module: string, action: string): MiddlewareHandler {
  return async (req, next) => {
    const user = req.user as any
    if (!user) {
      throw new ForbiddenError('Authentication required')
    }

    // Super_admin always has access
    if (user.role === 'super_admin') {
      return next()
    }

    // Get user's permissions from their role
    // The permissions should be loaded during authentication
    const permissions: Permission[] = user.permissions || []

    if (!hasPermission(permissions, module, action)) {
      throw new ForbiddenError(`Sin permiso: ${module}:${action}`)
    }

    return next()
  }
}

/**
 * "Cualquiera de": pasa si el usuario tiene AL MENOS UNO de los `module:action` listados. Para rutas
 * que sirven a dos roles con permisos distintos (ej. el buscador de alojados del POS: lo usa el mozo
 * al abrir un room service — `restaurant:create` — y el cajero al cargar la cuenta — `restaurant:pay`).
 * Bajar la ruta a `view` sería abrirla a cocina; pedir uno solo deja afuera al otro rol. Mismo
 * contrato que `requirePermission` (super_admin pasa, permisos ya cargados por loadPermissions).
 *
 * @example
 * router.get('/api/restaurant/in-house', [auth.authenticate(), loadPermissions(roleRepo), requireAnyPermission(['restaurant', 'pay'], ['restaurant', 'create'])], handler)
 */
export function requireAnyPermission(...required: Array<[module: string, action: string]>): MiddlewareHandler {
  if (required.length === 0) throw new Error('requireAnyPermission: hace falta al menos un permiso')
  return async (req, next) => {
    const user = req.user as any
    if (!user) {
      throw new ForbiddenError('Authentication required')
    }
    if (user.role === 'super_admin') {
      return next()
    }
    const permissions: Permission[] = user.permissions || []
    if (!required.some(([module, action]) => hasPermission(permissions, module, action))) {
      throw new ForbiddenError(`Sin permiso: ${required.map(([m, a]) => `${m}:${a}`).join(' o ')}`)
    }
    return next()
  }
}
