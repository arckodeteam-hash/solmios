// canales/usecases/override-channels.ts — Qué canales tienen tarifa propia.
//
// Un hotel puede vender más caro por un canal que por su web: esas filas de `RoomRates` llevan
// `channel`. El ARI post-sync tiene que publicarlas DESPUÉS de la base, o la base se las lleva
// puestas — que es lo que pasaba hasta el 2026-09-04: sincronizar dejaba la suite de temporada
// alta en la tarifa base y el hotel vendía por la OTA bastante más barato de lo que quería.

/** Canales distintos con tarifa propia. Vacío si el hotel vende al mismo precio en todos lados. */
export async function listOverrideChannels(
  findMany: (model: string, query: Record<string, unknown>) => Promise<any[]>,
  hotelId: string,
): Promise<string[]> {
  const rows = (await findMany('RoomRates', { hotelId })) as Array<{ channel?: unknown }>
  const channels = new Set<string>()
  for (const row of rows ?? []) {
    const channel = typeof row.channel === 'string' ? row.channel.trim() : ''
    if (channel) channels.add(channel)
  }
  return [...channels]
}
