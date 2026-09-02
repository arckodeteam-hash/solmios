// canales/usecases/auto-provision.ts — Alta automática del hotel en el channel manager.
//
// Un hotel que se registra y carga sus habitaciones queda listo para vender por OTAs sin que
// nadie se acuerde de apretar "Sincronizar". Antes ese botón era el único camino: un hotel que
// no entraba a la vista de Channel simplemente no publicaba, y nada se lo decía.
//
// Las cuatro guardas de abajo NO son defensivas de más — cada una evita un daño concreto:
//
//  1. `channexPropertyId` ya cargado → solo se re-sincroniza si apareció un TIPO de habitación que
//     no está publicado. Hasta el 2026-09-02 no se hacía nada nunca, porque `syncProperty` era
//     destructivo; ahora es idempotente (`sync-structure.ts`) y el caso real que quedaba sin
//     cubrir es el hotel que carga su inventario en tandas: 4 dobles y después 2 twin dejaban
//     las twin SIN publicar, con el panel diciendo "Conectado". Cargar más habitaciones del
//     mismo tipo NO dispara nada: el catálogo no cambió.
//  2. Sin habitaciones no hay room types que crear: se crearía una property vacía.
//  3. Sin credencial de plataforma el sync tira; mejor no intentarlo por cada habitación.
//  4. Si el plan del hotel no incluye el channel manager, no se le crea una property —
//     cuesta dinero en la cuenta de Channex y ensucia la lista.
//
// Todo es best-effort: un fallo acá NUNCA puede romper el alta de una habitación. Se loguea.

import type { Logger } from 'arckode-framework'

export interface AutoProvisionDeps {
  /** Config del hotel: sin `channexPropertyId` es un alta; con él, a lo sumo un re-sync. */
  getConfig: (hotelId: string) => Promise<{ channexPropertyId?: string | null } | undefined>
  findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>
  /** Mapping persistido local↔Channex: de ahí salen los tipos que YA están publicados. */
  readMappings: (hotelId: string) => Promise<Array<{ kind: string; localId: string }>>
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
  | 'restructured'
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
    const alreadyPublished = !!cfg?.channexPropertyId

    if (!(await deps.hasPlatformKey())) return 'no-platform-key'
    if (!(await deps.isModuleEnabled(hotelId, 'channel'))) return 'module-disabled'

    const rooms = await deps.findMany('Rooms', { hotelId })
    if (!rooms?.length) return 'no-rooms'

    if (alreadyPublished) {
      const nuevos = await missingRoomTypes(deps, hotelId, rooms)
      if (!nuevos.length) return 'already-synced'
      await deps.sync(hotelId)
      deps.logger.info('Tipos de habitación nuevos publicados en el channel manager', { hotelId, tipos: nuevos })
      return 'restructured'
    }

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

/**
 * Tipos de habitación del hotel que NO figuran publicados, según el mapping persistido.
 *
 * Un hotel sin ningún `room_type` mapeado devuelve lista vacía a propósito: puede ser una property
 * sincronizada antes de que existiera el mapping (P6), y no hay forma de distinguirla de una vacía.
 * Re-sincronizar a ciegas ahí sería empujar ARI de más por cada habitación que carguen.
 */
async function missingRoomTypes(
  deps: Pick<AutoProvisionDeps, 'readMappings'>, hotelId: string, rooms: any[],
): Promise<string[]> {
  const mappings = await Promise.resolve()
    .then(() => deps.readMappings(hotelId))
    .catch(() => [] as Array<{ kind: string; localId: string }>)
  const publicados = new Set(
    mappings.filter((m) => m.kind === 'room_type').map((m) => String(m.localId || '').trim().toLowerCase()))
  if (!publicados.size) return []
  const locales = new Set(
    rooms.map((r) => String(r?.type || '').trim().toLowerCase()).filter(Boolean))
  return [...locales].filter((t) => !publicados.has(t))
}
