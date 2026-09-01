// canales/usecases/auto-provision.ts — Alta automática del hotel en el channel manager.
//
// Un hotel que se registra y carga sus habitaciones queda listo para vender por OTAs sin que
// nadie se acuerde de apretar "Sincronizar". Antes ese botón era el único camino: un hotel que
// no entraba a la vista de Channel simplemente no publicaba, y nada se lo decía.
//
// Las cuatro guardas de abajo NO son defensivas de más — cada una evita un daño concreto:
//
//  1. `channexPropertyId` ya cargado → NO se toca. `syncProperty` sobre una property existente es
//     DESTRUCTIVO (borra rate plans y room types antes de recrearlos): dispararlo por cada
//     habitación que el hotel agregue le tiraría abajo el ARI publicado.
//  2. Sin habitaciones no hay room types que crear: se crearía una property vacía.
//  3. Sin credencial de plataforma el sync tira; mejor no intentarlo por cada habitación.
//  4. Si el plan del hotel no incluye el channel manager, no se le crea una property —
//     cuesta dinero en la cuenta de Channex y ensucia la lista.
//
// Todo es best-effort: un fallo acá NUNCA puede romper el alta de una habitación. Se loguea.

import type { Logger } from 'arckode-framework'

export interface AutoProvisionDeps {
  /** Config del hotel: si ya tiene `channexPropertyId`, no se hace nada. */
  getConfig: (hotelId: string) => Promise<{ channexPropertyId?: string | null } | undefined>
  findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>
  /** ¿La plataforma tiene credencial de Channex configurada? */
  hasPlatformKey: () => Promise<boolean>
  /** ¿El plan del hotel incluye el channel manager? */
  isModuleEnabled: (hotelId: string, moduleKey: string) => Promise<boolean>
  /** El sync completo: property + room types + rate plans + ARI. */
  sync: (hotelId: string) => Promise<unknown>
  logger: Logger
}

/** Por qué NO se aprovisionó. `provisioned` es el único caso en que se llamó a Channex. */
export type AutoProvisionOutcome =
  | 'provisioned'
  | 'already-synced'
  | 'no-rooms'
  | 'no-platform-key'
  | 'module-disabled'
  | 'failed'

export async function autoProvisionChannex(
  deps: AutoProvisionDeps, hotelId: string,
): Promise<AutoProvisionOutcome> {
  try {
    const cfg = await deps.getConfig(hotelId)
    if (cfg?.channexPropertyId) return 'already-synced'

    if (!(await deps.hasPlatformKey())) return 'no-platform-key'
    if (!(await deps.isModuleEnabled(hotelId, 'channel'))) return 'module-disabled'

    const rooms = await deps.findMany('Rooms', { hotelId })
    if (!rooms?.length) return 'no-rooms'

    await deps.sync(hotelId)
    deps.logger.info('Hotel dado de alta en el channel manager automáticamente', { hotelId, rooms: rooms.length })
    return 'provisioned'
  } catch (e) {
    // Que el alta en Channex falle no puede impedir que el hotel cargue sus habitaciones.
    deps.logger.error('Alta automática en el channel manager falló', {
      hotelId, error: e instanceof Error ? e.message : String(e),
    })
    return 'failed'
  }
}
