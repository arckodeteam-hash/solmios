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

// Solicitud de conexión de una OTA. El hotelero no puede conectar Booking o Airbnb solo: hace
// falta un contrato con la OTA y credenciales que da la plataforma. Antes el botón "Solicitar
// Conexión" abría el asistente embebido de Channex —en inglés, con adaptadores y credenciales de
// OTA— y ahí terminaba: nadie se enteraba de que el hotel quería conectarse. Ahora queda pedido
// por escrito, con estado, y lo atiende el admin de la plataforma.
export const ChannelRequestModel: ModelDefinition = {
  table: 'channel_requests',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    // Copia del nombre al momento de pedir: el admin ve la lista sin un join por hotel, y si el
    // hotel se renombra después, la solicitud sigue diciendo con qué nombre entró.
    hotelName: { type: 'string' },
    // Código del canal en el catálogo (`airbnb`, `booking`…) y su nombre visible.
    channel: { type: 'string', required: true },
    channelName: { type: 'string' },
    // Quién la pidió, para que el admin sepa a quién contestarle.
    requestedByName: { type: 'string' },
    requestedByEmail: { type: 'string' },
    // Ciclo de vida del caso (REQ-CAN-02): pending → scheduled → in_progress → waiting_hotel →
    // connected | rejected. Las transiciones válidas las impone `usecases/channel-requests.ts`:
    // antes cualquier estado se podía escribir sobre cualquier otro y un `pending` saltaba a
    // `connected` sin que nadie hubiera hablado con el hotel.
    status: { type: 'string', default: 'pending' },
    // Lo que escribe el hotelero (número de propiedad en la OTA, dudas).
    message: { type: 'string' },
    // Teléfono que dejó el hotel para que lo contacten (default: `hotels.phone`).
    contactPhone: { type: 'string' },
    // Notas del admin. NUNCA se le muestran al hotel. `text` (no `string`): son multilínea, y
    // como `string` el motor las guardaba en una columna corta de una sola línea.
    notes: { type: 'text' },
    // ── La cita (REQ-CAN-03) ───────────────────────────────────────────────────────────────
    // Conectar una OTA arranca con una llamada al hotel, no con un cambio de estado. La cita es
    // lo que convierte "alguien lo va a ver" en "el martes a las 10 lo llama Fulano".
    appointmentAt: { type: 'string' },
    // 'call' | 'whatsapp' | 'video'.
    appointmentMedium: { type: 'string' },
    contactName: { type: 'string' },
    contactEmail: { type: 'string' },
    // `users.id` del admin que agendó / atiende el caso (ver la regla de resolver nombres por
    // /api/usuarios en el CLAUDE.md: acá se guarda el id, el nombre se resuelve al mostrar).
    assignedTo: { type: 'string' },
    // Por qué se rechazó. Obligatorio para pasar a `rejected` — un caso cerrado sin motivo deja
    // al hotel sin saber qué le falta y al próximo admin sin saber qué pasó.
    resolutionReason: { type: 'text' },
    closedAt: { type: 'string' },
    // Dedup del recordatorio diario de citas: la marca es la `appointmentAt` ya recordada, así
    // reprogramar vuelve a habilitar el aviso y el cron no manda dos por la misma cita.
    reminderSentFor: { type: 'string' },
  },
}

// Historial del caso (REQ-CAN-04). Cada cambio de estado, cita, nota y aviso deja su fila: sin
// esto, "¿quién le dijo que sí a este hotel y cuándo?" no tiene respuesta — la tabla anterior solo
// guardaba el ÚLTIMO estado, y el `updatedAt` no dice quién lo tocó.
export const ChannelRequestActivityModel: ModelDefinition = {
  table: 'channel_request_activities',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    requestId: { type: 'string', required: true, indexed: true },
    hotelId: { type: 'string', required: true, indexed: true },
    // created | status_changed | appointment_scheduled | appointment_rescheduled | note_added |
    // notified_hotel | notified_admin | reminder_sent.
    kind: { type: 'string', required: true },
    actorId: { type: 'string' },
    actorName: { type: 'string' },
    fromStatus: { type: 'string' },
    toStatus: { type: 'string' },
    note: { type: 'text' },
    payload: { type: 'json', default: {} },
  },
}

export function registerCanalesModels(orm: ORM): void {
  orm.define('Canales', CanalesModel)
  orm.define('ChannelMapping', ChannelMappingModel)
  orm.define('ChannelRequests', ChannelRequestModel)
  orm.define('ChannelRequestActivities', ChannelRequestActivityModel)
}
