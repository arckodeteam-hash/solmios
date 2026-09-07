import type { MiddlewareHandler, RepositoryAdapter } from 'arckode-framework'
import { getRolePermissions } from '../../shared/permissions'

/**
 * Middleware que carga los permisos del rol del usuario después de la autenticación.
 * Debe ejecutarse DESPUÉS de auth.authenticate() y ANTES de requirePermission().
 *
 * @example
 * router.get('/api/reservations',
 *   auth.authenticate('hotel_admin', 'receptionist'),
 *   loadPermissions(roleRepo),
 *   requirePermission('reservations', 'view'),
 *   handler
 * )
 */
export function loadPermissions(roleRepo: RepositoryAdapter<any>): MiddlewareHandler {
  return async (req, next) => {
    const user = req.user as any
    if (!user) return next()

    // Sesión de impersonación: es el super admin operando DENTRO de la cuenta del cliente.
    // El acceso total viene por acá, y no por el nombre del rol, a propósito: el token de
    // impersonación lleva el rol REAL del cliente para que los chequeos de aislamiento por hotel
    // (`role !== 'super_admin' && hotelId !== ...`, repartidos por ~30 services) sigan aplicando.
    // `hasPermission` entiende '*:*' (shared/permissions.ts), así que `requirePermission` lo deja
    // pasar sin que nadie tenga que mentir sobre el rol. Va ANTES de consultar el roleRepo: los
    // permisos del rol del cliente no deben recortarle nada al admin.
    if (user.impersonatedBy) {
      user.permissions = ['*:*']
      return next()
    }

    // Super_admin always has all permissions
    if (user.role === 'super_admin') {
      user.permissions = ['*:*']
      return next()
    }

    // Load permissions from the user's role
    try {
      const roles = await roleRepo.findMany({
        name: user.role,
        hotelId: user.hotelId,
      })

      if (roles.length > 0) {
        const role = roles[0] as any
        user.permissions = getRolePermissions(user.role, role.permissions)
      } else {
        // Fallback to default permissions
        user.permissions = getRolePermissions(user.role)
      }
    } catch {
      // Fallback to default permissions on error
      user.permissions = getRolePermissions(user.role)
    }

    return next()
  }
}
