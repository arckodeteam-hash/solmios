import type { MiddlewareHandler, ORM } from 'arckode-framework'
import type { Logger } from 'arckode-framework'
import { ForbiddenError, Logger as AppLogger, OrmRepository } from 'arckode-framework'
import { isModuleEnabledForHotel, type ModuleEntitlementRepos } from '../../modules/admin/usecases/modules'

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
/**
 * Mismo entitlement que `createModuleGuard`, pero como PREGUNTA en vez de middleware: sirve para
 * los caminos que no son un request HTTP (crons, connectors, alta automática en Channex).
 *
 * Misma semántica que el guard: solo un `false` explícito bloquea — ante datos faltantes se
 * asume habilitado, para no cortar la operación de un hotel por un plan mal cargado.
 */
export function createModuleChecker(orm: ORM, logger: Pick<Logger, 'warn' | 'error'> = gateLogger) {
  const repos = entitlementRepos(orm, logger)
  return (hotelId: string, moduleKey: string): Promise<boolean> => isModuleEnabledForHotel(repos, hotelId, moduleKey)
}

export function createModuleGuard(orm: ORM, logger: Pick<Logger, 'warn' | 'error'> = gateLogger) {
  const repos = entitlementRepos(orm, logger)

  return (moduleKey: string): MiddlewareHandler => async (req, next) => {
    const user = req.user as any
    // Plataforma (super_admin) no se gatea por módulos de hotel.
    if (!user || user.userType === 'admin' || user.role === 'super_admin') return next()
    const hotelId = user.hotelId
    if (!hotelId || hotelId === 'platform') return next()

    // El plan sale de la SUSCRIPCIÓN ACTIVA (fuente de verdad); `hotel.plan` es solo el espejo
    // legacy para hoteles sin suscripción (resolveHotelPlan). La cuenta vive en admin/usecases/modules.ts.
    // Solo bloquea si está explícitamente apagado. Fail-open ante datos faltantes (no romper la operación).
    if (!(await isModuleEnabledForHotel(repos, hotelId, moduleKey))) {
      throw new ForbiddenError(`Módulo no disponible en tu plan: ${moduleKey}`)
    }
    return next()
  }
}

/** Los cinco repos del entitlement, una sola vez por módulo (cada `create*` los instancia al montar). */
function entitlementRepos(orm: ORM, logger: Pick<Logger, 'warn' | 'error'>): ModuleEntitlementRepos {
  return {
    configRepo: new OrmRepository<any>(orm, 'Configuration'),
    plansRepo: new OrmRepository<any>(orm, 'Plans'),
    hotelsRepo: new OrmRepository<any>(orm, 'Hotels'),
    subscriptionsRepo: new OrmRepository<any>(orm, 'Subscriptions'),
    overridesRepo: new OrmRepository<any>(orm, 'HotelModuleOverrides'),
    logger,
  }
}
