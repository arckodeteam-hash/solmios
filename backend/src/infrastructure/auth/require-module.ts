import type { MiddlewareHandler, ORM } from 'arckode-framework'
import { ForbiddenError, OrmRepository } from 'arckode-framework'
import { getModuleStateForHotel } from '../../modules/admin/usecases/modules'

/**
 * Entitlement de módulo a nivel API: rechaza (403) si el hotel del usuario NO tiene el módulo habilitado
 * (global ∩ su plan). Complementa el bloqueo del frontend (menú + guard de ruta) para que la URL/endpoint
 * directo tampoco pase. El super_admin y las cuentas de plataforma nunca se gatean.
 *
 * Uso (una sola vez por módulo, envolviendo el permission guard existente):
 *   const moduleGuard = createModuleGuard(orm)
 *   const guard = (m, a) => [...permGuard(m, a), moduleGuard('channel')]
 *   router.get('/api/channels', guard('channel-manager', 'view'), handler)  // sin cambiar cada ruta
 */
export function createModuleGuard(orm: ORM) {
  const configRepo = new OrmRepository<any>(orm, 'Configuration')
  const plansRepo = new OrmRepository<any>(orm, 'Plans')
  const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
  const subscriptionsRepo = new OrmRepository<any>(orm, 'Subscriptions')
  const overridesRepo = new OrmRepository<any>(orm, 'HotelModuleOverrides')

  return (moduleKey: string): MiddlewareHandler => async (req, next) => {
    const user = req.user as any
    // Plataforma (super_admin) no se gatea por módulos de hotel.
    if (!user || user.userType === 'admin' || user.role === 'super_admin') return next()
    const hotelId = user.hotelId
    if (!hotelId || hotelId === 'platform') return next()

    // El plan sale de la SUSCRIPCIÓN ACTIVA (fuente de verdad); `hotel.plan` es solo el
    // espejo legacy para hoteles sin suscripción (resolveHotelPlan).
    const hotel = ((await hotelsRepo.findMany({ id: hotelId })) as any[])?.[0]
    const state = await getModuleStateForHotel(configRepo, plansRepo, subscriptionsRepo, hotelId, overridesRepo, hotel?.plan)
    // Solo bloquea si está explícitamente apagado. Fail-open ante datos faltantes (no romper la operación).
    if (state[moduleKey] === false) {
      throw new ForbiddenError(`Módulo no disponible en tu plan: ${moduleKey}`)
    }
    return next()
  }
}
