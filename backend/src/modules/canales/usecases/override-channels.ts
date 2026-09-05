// canales/usecases/override-channels.ts — Qué canales tienen tarifa propia Y están conectados.
//
// Un hotel puede vender más caro por un canal que por su web: esas filas de `RoomRates` llevan
// `channel`. El ARI post-sync tiene que publicarlas DESPUÉS de la base, o la base se las lleva
// puestas — que es lo que pasaba hasta el 2026-09-04: sincronizar dejaba la suite de temporada
// alta en la tarifa base y el hotel vendía por la OTA bastante más barato de lo que quería.
//
// Se cruza con los canales CONECTADOS a propósito. Todos los pushes escriben sobre los mismos rate
// plans de la property, así que el último gana: publicar cualquier string que aparezca en la
// columna `channel` hace que una fila vieja —de un canal que se desconectó, o cargada por una
// integración con el id en vez del código— pise el precio del canal que sí está vendiendo. Pasó en
// producción el 2026-09-05: cuatro pushes seguidos y el precio final salió de filas huérfanas.
//
// El identificador que se cruza es el `attributes.channel` de Channex ("OpenChannel"), que es lo
// que el PMS guarda en `RoomRates.channel`. NO el `type` del listado de canales del panel, que es
// la categoría genérica ("ota") y no matchea con nada.

/**
 * Canales distintos con tarifa propia, acotados a los que están activos en la property.
 * Vacío si el hotel vende al mismo precio en todos lados.
 */
export async function listOverrideChannels(
  findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>,
  hotelId: string,
  activeChannels: () => Promise<string[]>,
): Promise<string[]> {
  const rows = (await findMany('RoomRates', { hotelId })) as Array<{ channel?: unknown }>
  const withRates = new Set<string>()
  for (const row of rows ?? []) {
    const channel = typeof row.channel === 'string' ? row.channel.trim() : ''
    if (channel) withRates.add(channel)
  }
  if (withRates.size === 0) return []

  // Si no se puede saber cuáles están activos, no se publica ninguno: la tarifa base sola es peor
  // que el precio correcto, pero mucho mejor que publicar un precio elegido por el orden de la tabla.
  const active = await activeChannels().catch(() => [] as string[])
  return active.filter((c) => withRates.has(c))
}
