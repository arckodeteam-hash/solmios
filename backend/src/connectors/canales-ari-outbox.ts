// connectors/canales-ari-outbox.ts — Quién publica cada `kind` de la outbox de ARI.
// La cola vive en `ari-outbox` y los pushes contra Channex viven en `canales`: un módulo nunca
// importa de otro (regla del framework), así que el cableado lo hace este connector. El connector
// solo DELEGA (CLAUDE #3): la lógica de agrupación y backoff está en ari-outbox/usecases.

import type { ConnectorContext } from 'arckode-framework'
// Un connector SÍ puede importar de los módulos: para eso existe. Acá se necesita porque el techo
// de peticiones/minuto lo GUARDA `ari-outbox` (la config de la cola, en el Super Admin) pero lo
// APLICA `canales`, que es dueño del transporte HTTP contra Channex — y un módulo no importa de
// otro.
import { setChannexMaxPerMinute } from '../modules/canales'

interface AriOutboxModulePort {
  registerPublisher: (
    kind: string,
    publisher: {
      push: (hotelId: string, channel?: string) => Promise<unknown>
      overrideChannels?: (hotelId: string) => Promise<string[]>
    },
  ) => void
  /** Hooks opcionales del módulo (ari-outbox/sockets.ts). */
  setSockets: (s: { onQueueConfigChanged?: (cfg: { maxAttempts: number; maxPerMinute: number }) => Promise<void> }) => void
}

interface CanalesPushPort {
  pushSeasonalRates: (hotelId: string, channel?: string) => Promise<unknown>
  overrideChannels: (hotelId: string) => Promise<string[]>
  syncHotel: (hotelId: string) => Promise<unknown>
}

export function canalesAriOutboxConnector(ctx: ConnectorContext): void {
  const outbox = ctx.resolveModule<AriOutboxModulePort>('ari-outbox')
  // `canales` se resuelve DENTRO de cada push (lazy), igual que en pricing-canales: el drain corre
  // mucho después del arranque y así el connector no se cae si el módulo todavía no está armado.
  const canales = () => ctx.resolveModule<CanalesPushPort>('canales')

  // Tarifas: el push admite canal. Un cambio GLOBAL (temporadas, planning, copiar al año próximo)
  // no dice a qué canal afecta, y publicar solo la base BORRABA los precios por canal — por eso el
  // drain necesita `overrideChannels` para publicar la base y después cada canal con tarifa propia.
  outbox.registerPublisher('rates', {
    push: (hotelId, channel) => canales().pushSeasonalRates(hotelId, channel),
    overrideChannels: (hotelId) => canales().overrideChannels(hotelId),
  })

  // Inventario: `syncHotel` republica room types y `count_of_rooms` del hotel entero. Sin
  // `overrideChannels` a propósito: el inventario NO se publica por canal, es uno solo por hotel.
  outbox.registerPublisher('inventory', {
    push: (hotelId) => canales().syncHotel(hotelId),
  })

  // La config que el operador guarda sobre la cola, aplicada a quien la tiene que respetar. Se
  // emite al guardar (PUT /api/admin/ari-outbox/config) y al arrancar (applyQueueConfig), así que
  // el valor persistido rige desde el primer tick del worker y no recién tras el próximo PUT.
  // El `maxAttempts` no pasa por acá: es la propia cola de `ari-outbox` y el módulo se lo aplica
  // solo. Lo único que cruza el límite entre módulos es el techo de peticiones/minuto.
  outbox.setSockets({
    onQueueConfigChanged: async (cfg) => { setChannexMaxPerMinute(cfg.maxPerMinute) },
  })
}
