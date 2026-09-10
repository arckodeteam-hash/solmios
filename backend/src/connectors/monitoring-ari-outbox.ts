// connectors/monitoring-ari-outbox.ts — Los contadores de la cola de Channex en la pantalla de
// monitoreo. La cola vive en `ari-outbox` (que ya expone `stats()` para /api/admin/ari-outbox/stats)
// y la pantalla la arma `monitoring`: un módulo nunca importa de otro (regla del framework), así
// que el puerto `AriOutboxStatsPort` lo inyecta este connector. Solo DELEGA (CLAUDE #3): sin él
// `monitoring` responde `ariOutbox: null` y la pantalla muestra "sin datos", nunca ceros.

import type { ConnectorContext } from 'arckode-framework'

interface AriOutboxCounts {
  pending: number
  processing: number
  sent: number
  failed: number
  retrying: number
  total: number
}

interface AriOutboxStatsModule {
  stats: () => Promise<AriOutboxCounts>
}

interface MonitoringModulePort {
  setAriOutboxPort: (port: { stats(): Promise<AriOutboxCounts> }) => void
}

export function monitoringAriOutboxConnector(ctx: ConnectorContext): void {
  const monitoring = ctx.resolveModule<MonitoringModulePort>('monitoring')
  // Se resuelve DENTRO de cada lectura (lazy), igual que canales-ari-outbox: la pantalla se abre
  // mucho después del arranque y así el orden de registro de los módulos no importa.
  const ariOutbox = () => ctx.resolveModule<AriOutboxStatsModule>('ari-outbox')

  monitoring.setAriOutboxPort({
    stats: () => ariOutbox().stats(),
  })
}
