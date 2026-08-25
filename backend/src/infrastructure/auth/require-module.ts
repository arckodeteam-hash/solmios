import type { MiddlewareHandler, ORM } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import { ForbiddenError, Logger as AppLogger, OrmRepository } from 'arckode-framework'
import { getModuleStateForHotel } from '../../modules/admin/usecases/modules'

/**
 * E2: el WARN del fail-open (suscripción viva → plan borrado, o activa sin planId) nunca se
 * emitía en prod porque NINGÚN caller pasaba logger al resolver. Default del propio guard:
 * sin tocar los ~44 módulos que instancian `createModuleGuard(orm)`, el warn ya sale en los
 * logs del server (mismo ConsoleTransport que el logger raíz de composition-root).
 */
const gateLogger = new AppLogger('module-gate')

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
export function createModuleGuard(orm: ORM, logger: Pick<Logger, 'warn' | 'error'> = gateLogger) {
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
    const state = await getModuleStateForHotel(configRepo, plansRepo, subscriptionsRepo, hotelId, overridesRepo, hotel?.plan, logger)
    // Solo bloquea si está explícitamente apagado. Fail-open ante datos faltantes (no romper la operación).
    if (state[moduleKey] === false) {
      throw new ForbiddenError(`Módulo no disponible en tu plan: ${moduleKey}`)
    }
    return next()
  }
}
