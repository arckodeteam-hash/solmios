// canales/usecases/room-events.ts — Qué le pasa al channel manager cuando cambian las habitaciones.
//
// Vive acá y no en el conector porque los conectores solo wirean (CLAUDE #3): la regla de qué se
// publica ante cada evento es del módulo. El conector queda en dos delegaciones de una línea.
//
// Los dos caminos son fire-and-forget a propósito: cargar o editar una habitación NUNCA puede
// quedar bloqueado —ni fallar— porque el channel manager esté lento o caído. El error se loguea.

export interface RoomEventDeps {
  /** Alta del hotel en el channel manager. Sus guardas viven en `auto-provision.ts`. */
  autoProvision: (hotelId: string) => Promise<unknown>
  /** Re-publica el mapa de tarifas del hotel. */
  pushSeasonalRates: (hotelId: string) => Promise<unknown>
  onError: (hotelId: string, accion: string, err: unknown) => void
}

/**
 * Primera habitación de un hotel nuevo → queda dado de alta en el channel manager solo.
 * Es idempotente: `autoProvision` no hace nada si el hotel ya tiene property.
 */
export function onRoomCreated(deps: RoomEventDeps, hotelId: string): void {
  void deps.autoProvision(hotelId).catch((err) => deps.onError(hotelId, 'alta automática', err))
}

/**
 * Habitación editada → re-publicar tarifas. El precio base del tipo sale de las habitaciones,
 * así que cambiarlo cambia lo que se vende en las OTAs.
 */
export function onRoomUpdated(deps: RoomEventDeps, hotelId: string): void {
  void deps.pushSeasonalRates(hotelId).catch((err) => deps.onError(hotelId, 'push de tarifas', err))
}
