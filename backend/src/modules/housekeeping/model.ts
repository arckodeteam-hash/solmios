// housekeeping/model.ts — Schema de base de datos
import type { ModelDefinition, ORM } from 'arckode-framework'

export const HousekeepingModel: ModelDefinition = {
  table: 'housekeeping',
  fields: {
    id: { type: 'string', required: true },
    roomId: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    staffId: { type: 'string', indexed: true },
    type: { type: 'string', default: "full_cleaning" },
    priority: { type: 'string', default: "medium" },
    status: { type: 'string', default: "pending", indexed: true },
    notes: { type: 'text' },
    assignedDate: { type: 'string' },
    completedDate: { type: 'string' },
    cleaningItems: { type: 'json' },
    // Timings + evidencia fotográfica (F2). duration NO se persiste: se calcula en runtime
    // como endTime - startTime (D1 del plan: evitar doble fuente de verdad).
    startTime: { type: 'string' },
    endTime: { type: 'string', indexed: true },
    // Pausa: `pausedAt` marca desde cuándo está pausada (null = corriendo);
    // `pausedSeconds` acumula el tiempo pausado. La duración real descuenta esto.
    pausedAt: { type: 'string' },
    pausedSeconds: { type: 'number', default: 0 },
    photos: { type: 'json', default: [] },
    // Supervisor approval workflow (F3). Sin estos campos el ORM los descarta
    // silenciosamente (anti-patrón mem 1805) y approve() nunca pasa su gate.
    supervisorId: { type: 'string' },
    supervisorNote: { type: 'text' },
    supOnSiteTime: { type: 'string' },
    // Calificación 1–10 que el supervisor le pone a la limpieza al aprobarla (F: rating manual).
    // Sin declararlo acá el ORM lo descarta en silencio (anti-patrón mem 1805). Nullable: las
    // tareas viejas y las devueltas (reject) no tienen nota.
    rating: { type: 'number' },
    // Video de evidencia de fin, cuando el hotel usa el modo `video` en vez de las
    // fotos por área. Un solo video por tarea. Mismo aviso: sin declararlo, el ORM
    // lo descarta en silencio.
    video: { type: 'json' },
    // Preparación de llegada (#274): la tarea `arrival_setup` nace de la reserva y la sigue
    // (`reservationId` para encontrarla y re-sincronizarla; `setupItems` = cuna/amenidades/
    // régimen/pedido). Sin declararlos el ORM los descarta en silencio (anti-patrón mem 1805).
    // Nullable: las tareas de limpieza viejas no los tienen.
    setupItems: { type: 'json' },
    reservationId: { type: 'string', indexed: true },
  },
  timestamps: true,
}

export function registerHousekeepingModels(orm: ORM): void {
  orm.define('Housekeeping', HousekeepingModel)
}
