// connectors/canales-ari-outbox.ts — Quién publica cada `kind` de la outbox de ARI.
// La cola vive en `ari-outbox` y los pushes contra Channex viven en `canales`: un módulo nunca
// importa de otro (regla del framework), así que el cableado lo hace este connector. El connector
// solo DELEGA (CLAUDE #3): la lógica de agrupación y backoff está en ari-outbox/usecases.

import type { ConnectorContext } from 'arckode-framework'

interface AriOutboxModulePort {
  registerPublisher: (
    kind: string,
    publisher: {
      push: (hotelId: string, channel?: string) => Promise<unknown>
      overrideChannels?: (hotelId: string) => Promise<string[]>
    },
  ) => void
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
}
