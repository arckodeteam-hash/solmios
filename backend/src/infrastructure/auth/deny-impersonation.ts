import type { MiddlewareHandler } from 'arckode-framework'
import { ForbiddenError } from 'arckode-framework'

/**
 * Rechaza las sesiones de impersonación. El admin conserva TODOS los permisos dentro de la
 * cuenta del cliente —`loadPermissions` le da ['*:*'] por el claim `impersonatedBy`—, y eso
 * está bien para ver y operar esa cuenta, pero no para las operaciones que cambian la sesión
 * o las credenciales del cliente: emitir tokens nuevos, revocar su sesión, cambiarle la
 * contraseña o escribir quién puede qué. Va DESPUÉS de authenticate(), que es quien pone
 * `impersonatedBy` en `req.user`.
 *
 * @example
 * router.post('/api/auth/logout', [auth.authenticate(), denyImpersonation()], handler)
 * router.post('/api/auth/switch-hotel/:id', [...guard('users', 'edit'), denyImpersonation()], handler)
 */
export function denyImpersonation(): MiddlewareHandler {
  return async (req, next) => {
    const user = req.user as any
    // Falla cerrado, igual que require-permission: sin token no se decide nada acá.
    if (!user) {
      throw new ForbiddenError('Authentication required')
    }

    if (user.impersonatedBy) {
      throw new ForbiddenError('No disponible mientras estás viendo la cuenta de un cliente')
    }

    return next()
  }
}
