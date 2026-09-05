// canales/usecases/room-events.ts — Qué le pasa al channel manager cuando cambian las habitaciones.
//
// Vive acá y no en el conector porque los conectores solo wirean (CLAUDE #3): la regla de qué se
// publica ante cada evento es del módulo. El conector queda en delegaciones de una línea.
//
// Los caminos son fire-and-forget a propósito: cargar, editar o borrar una habitación NUNCA puede
// quedar bloqueado —ni fallar— porque el channel manager esté lento o caído. El error se loguea.

export interface RoomEventDeps {
  /** Alta del hotel en el channel manager. Sus guardas viven en `auto-provision.ts`. */
  autoProvision: (hotelId: string) => Promise<unknown>
  /** Re-publica el mapa de tarifas del hotel. */
  pushSeasonalRates: (hotelId: string) => Promise<unknown>
  /**
   * Re-publica la ESTRUCTURA: `count_of_rooms` por tipo y la disponibilidad que sale de ahí.
   * Se agrupa por hotel en el conector (una carga en lote de 12 habitaciones = un solo sync).
   */
  syncInventory: (hotelId: string) => Promise<unknown>
  onError: (hotelId: string, accion: string, err: unknown) => void
}

/**
 * Habitación nueva → el hotel queda dado de alta en el channel manager, o —si ya lo estaba— se
 * republica el inventario.
 *
 * `autoProvision` solo actúa cuando aparece un TIPO que no estaba publicado; una habitación más de
 * un tipo que ya existe devuelve `already-synced`. Hasta el 2026-09-04 eso significaba **no hacer
 * nada**, y el efecto era que el hotel sumaba una habitación y la OTA seguía vendiendo el número
 * viejo, sin aviso. Medido en producción: 3 suites → 4 en el PMS, `count_of_rooms` y availability
 * quietos en 3 hasta apretar "Forzar Sync Ahora" a mano.
 */
export function onRoomCreated(deps: RoomEventDeps, hotelId: string): void {
  void deps.autoProvision(hotelId)
    .then((outcome) => (outcome === 'already-synced' ? deps.syncInventory(hotelId) : undefined))
    .catch((err) => deps.onError(hotelId, 'alta automática', err))
}

/**
 * Habitación editada → re-publicar tarifas. El precio base del tipo sale de las habitaciones,
 * así que cambiarlo cambia lo que se vende en las OTAs.
 */
export function onRoomUpdated(deps: RoomEventDeps, hotelId: string): void {
  void deps.pushSeasonalRates(hotelId).catch((err) => deps.onError(hotelId, 'push de tarifas', err))
}

/**
 * Habitación dada de baja → republicar el inventario, o la OTA sigue vendiendo una habitación que
 * el hotel ya no tiene. Es el caso caro del par: un overbooking que hay que resolver a mano.
 */
export function onRoomDeleted(deps: RoomEventDeps, hotelId: string): void {
  void deps.syncInventory(hotelId).catch((err) => deps.onError(hotelId, 'baja de habitación', err))
}
