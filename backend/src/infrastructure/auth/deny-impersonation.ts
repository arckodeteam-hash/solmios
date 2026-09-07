import type { MiddlewareHandler } from 'arckode-framework'
import { ForbiddenError } from 'arckode-framework'

/**
 * Rechaza las sesiones de impersonación. Un token de impersonación lleva `role: 'super_admin'`
 * para que el admin conserve los permisos DENTRO de la cuenta del cliente, pero eso no puede
 * alcanzar para las operaciones que cambian la sesión o las credenciales del cliente: emitir
 * tokens nuevos, revocar su sesión o cambiarle la contraseña. Va DESPUÉS de authenticate().
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
