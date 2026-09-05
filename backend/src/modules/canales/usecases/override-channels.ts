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

export interface ConnectedChannel {
  type: string
  conectado: boolean
}

/**
 * Canales distintos con tarifa propia, acotados a los que están conectados y en el orden en que
 * el hotel los tiene conectados. Vacío si el hotel vende al mismo precio en todos lados.
 */
export async function listOverrideChannels(
  findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>,
  hotelId: string,
  connected: () => Promise<ConnectedChannel[]>,
): Promise<string[]> {
  const rows = (await findMany('RoomRates', { hotelId })) as Array<{ channel?: unknown }>
  const withRates = new Set<string>()
  for (const row of rows ?? []) {
    const channel = typeof row.channel === 'string' ? row.channel.trim() : ''
    if (channel) withRates.add(channel)
  }
  if (withRates.size === 0) return []

  const live = await connected().catch(() => [])
  return live.filter((c) => c.conectado && withRates.has(c.type)).map((c) => c.type)
}
