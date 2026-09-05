// canales/usecases/full-sync.ts — ARI post-sync (test 1 de la certificación PMS de Channex).
// El sync de estructura (property → room types → rate plans) no pushea ARI: esta pieza manda
// el ARI completo del hotel en EXACTAMENTE 2 llamadas — 1 availability consolidado (500 días,
// reservas/bloques descontados) + 1 restrictions consolidado (todas las temporadas × rate plans).
// Vive en usecase/ para que el service se mantenga <200 líneas (gate del analyzer).

import type { Logger } from 'arckode-framework'

export interface FullSyncDeps {
  pushAll: () => Promise<unknown>
  /** Sin canal publica la tarifa BASE del hotel; con canal, la que ese canal tiene aparte. */
  pushRates: (channel?: string) => Promise<unknown>
  /**
   * Canales con tarifas propias. Vacío en el hotel que vende al mismo precio en todos lados —
   * que es el caso de la property del examen, donde el test 1 sigue siendo de 2 llamadas.
   */
  overrideChannels?: () => Promise<string[]>
  logger: Logger
}

export async function pushFullSyncAri(deps: FullSyncDeps, hotelId: string): Promise<void> {
  try {
    await deps.pushAll()
    await deps.pushRates()
    // Los canales con precio propio van DESPUÉS de la base, o el sync los pisa con ella.
    //
    // Medido en producción el 2026-09-04 (Hotel Boutique Palma): el hotel vendía la suite a $330
    // en temporada alta por su canal; un "Forzar Sync Ahora" la dejó en $120 —la tarifa base— y
    // ahí se quedó, porque el ARI post-sync solo publicaba esa. Cada sincronización le tiraba los
    // precios abajo sin decir nada, y desde el fix de inventario el sync también corre solo al
    // dar de alta o de baja una habitación.
    for (const channel of (await deps.overrideChannels?.()) ?? []) {
      await deps.pushRates(channel)
    }
  } catch (e) {
    // Un fallo acá no invalida el sync de estructura: se loguea y el próximo push por evento corrige.
    deps.logger.error('ARI post-sync falló', { hotelId, error: e instanceof Error ? e.message : String(e) })
  }
}
