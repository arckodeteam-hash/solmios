// canales/usecases/full-sync.ts — ARI post-sync (test 1 de la certificación PMS de Channex).
// El sync de estructura (property → room types → rate plans) no pushea ARI: esta pieza manda
// el ARI completo del hotel en EXACTAMENTE 2 llamadas — 1 availability consolidado (500 días,
// reservas/bloques descontados) + 1 restrictions consolidado (todas las temporadas × rate plans).
// Vive en usecase/ para que el service se mantenga <200 líneas (gate del analyzer).

import type { Logger } from 'arckode-framework'

export interface FullSyncDeps {
  pushAll: () => Promise<unknown>
  pushRates: () => Promise<unknown>
  logger: Logger
}

export async function pushFullSyncAri(deps: FullSyncDeps, hotelId: string): Promise<void> {
  try {
    await deps.pushAll()
    await deps.pushRates()
  } catch (e) {
    // Un fallo acá no invalida el sync de estructura: se loguea y el próximo push por evento corrige.
    deps.logger.error('ARI post-sync falló', { hotelId, error: e instanceof Error ? e.message : String(e) })
  }
}
