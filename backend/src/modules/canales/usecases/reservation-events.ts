// canales/usecases/reservation-events.ts — Qué le pasa al channel manager cuando cambia una reserva.
//
// Vive acá y no en el conector porque los conectores solo wirean (CLAUDE #3): la regla de qué se
// publica ante cada evento es del módulo.
//
// Todo es fire-and-forget: crear, editar o borrar una reserva NUNCA puede fallar porque el channel
// manager esté lento o caído.

export interface ReservationEventDeps {
  /** Recalcula y publica la disponibilidad de una habitación concreta. */
  pushAvailabilityByRoom: (hotelId: string, roomId: string) => Promise<unknown>
}

/** Lo que el evento trae de la reserva afectada. Puede venir incompleto (eventos viejos). */
export interface ReservationRef {
  hotelId?: string
  roomId?: string | null
}

/**
 * Reserva creada, modificada o borrada → cambian las noches ocupadas de esa habitación.
 *
 * El borrado no hacía nada hasta el 2026-09-05: el socket solo mandaba el `id`, sin hotel ni
 * habitación, así que no había con qué recalcular. La OTA se quedaba sin vender esas noches hasta
 * el siguiente sync — medido en producción, una reserva de 2 noches borrada dejó la suite en 2 de 3
 * disponibles indefinidamente.
 */
export async function onReservationRoomChanged(deps: ReservationEventDeps, ref: ReservationRef | undefined): Promise<void> {
  if (!ref?.hotelId || !ref.roomId) return
  await deps.pushAvailabilityByRoom(ref.hotelId, ref.roomId).catch(() => {})
}
