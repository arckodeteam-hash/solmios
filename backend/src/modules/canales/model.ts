// canales/model.ts — Schema de base de datos
// Describe la tabla `canales_config` (configuración del channel manager por hotel).
// Importado por index.ts → orm.define() para registrar el modelo.

import type { ModelDefinition, ORM } from 'arckode-framework'

// Tabla física de configuración del channel manager (uno por hotel).
export const CanalesModel: ModelDefinition = {
  table: 'channel_config',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    channexPropertyId: { type: 'string' },
    // Grupo de Channex del hotel. UNO POR HOTEL: la cuenta es de la plataforma (white-label) y el
    // grupo es la frontera de aislamiento entre hoteles dentro de esa cuenta.
    //
    // Estaba en `types.ts` y se leía en `generateIframeToken`, pero NO acá — el ORM descarta los
    // campos que no declara el modelo, sin warning (anti-patrón mem 1805), así que se guardaba
    // en el vacío y el token del iframe siempre salía sin grupo. La property, además, se creaba
    // sin `group_id`: la doc de Channex dice que entonces cae en el "Default User Group", o sea
    // TODOS los hoteles juntos.
    channexGroupId: { type: 'string' },
    channexApiKey: { type: 'string' },
    syncEnabled: { type: 'number', default: 1 },
    lastSync: { type: 'string' },
    config: { type: 'json', default: {} },
  },
}

// Mapping persistente local↔Channex (P6, certificación): (hotelId, kind, localId) → channexId.
// `kind='room_type'` → localId = el type local (lowercase en el lookup); `kind='rate_plan'` →
// localId = `${type}|${plan.code}` (ej. "double|bar"). El sync lo regenera en cada corrida;
// los pushes resuelven UUIDs por acá sin los 2 GETs por push ni el match frágil por título.
export const ChannelMappingModel: ModelDefinition = {
  table: 'channel_mapping',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    kind: { type: 'string', required: true },
    localId: { type: 'string', required: true },
    channexId: { type: 'string', required: true },
  },
}

export function registerCanalesModels(orm: ORM): void {
  orm.define('Canales', CanalesModel)
  orm.define('ChannelMapping', ChannelMappingModel)
}
