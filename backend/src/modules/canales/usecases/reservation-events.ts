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
  /**
   * REQ-HAC-05 (#260): la reserva puede nacer SIN unidad (`roomId` null) y sólo con `roomType`
   * — panel, widget, OTA. Ahí se publica por tipo. Opcional para no romper cableados viejos.
   */
  pushAvailabilityByType?: (hotelId: string, roomType: string) => Promise<unknown>
}

/** Lo que el evento trae de la reserva afectada. Puede venir incompleto (eventos viejos). */
export interface ReservationRef {
  hotelId?: string
  roomId?: string | null
  roomType?: string | null
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
  if (!ref?.hotelId) return
  if (!ref.roomId) {
    // Sin unidad: la fila descuenta del tipo (`availableOfType`), así que lo que cambió en Channex
    // es la disponibilidad de ese tipo. Sin tipo ni unidad no hay con qué recalcular.
    if (!ref.roomType || !deps.pushAvailabilityByType) return
    const { hotelId, roomType } = ref
    void deps.pushAvailabilityByType(hotelId, roomType).catch((err: unknown) => {
      console.error(`[reservation-events] push de availability por tipo falló (hotel=${hotelId} type=${roomType}):`, err instanceof Error ? err.message : err)
    })
    return
  }
  // `void`, NO `await`: el push tiene que salir DESPUÉS de responderle al usuario.
  //
  // Hasta el 2026-09-09 esto era un `await` con un `.catch(() => {})`. El catch tapaba el error,
  // pero el await seguía esperando, y el push no es instantáneo: `channex-http.ts:114` frena el
  // request contra el techo de ~18 ARI/minuto de Channex. Con la ventana llena, `acquireSlot()`
  // espera hasta que se libere — y esa espera ocurría adentro del `POST /api/reservas`
  // (crud.ts:233 → safe-emit.ts:23 → acá), así que el timeout de 30s del framework cortaba el
  // request: 500 en la cara del usuario, con la reserva YA creada en la base. Reproducido en
  // producción durante la certificación: el minuto tenía exactamente 18 llamadas ARI y la
  // reserva siguiente murió a los 30.015 ms. Mismo patrón que `connectors/pricing-canales.ts:63`.
  //
  // El error se loguea, no se traga: un push perdido deja a la OTA vendiendo noches ocupadas y
  // sin rastro sería imposible de descubrir.
  void deps.pushAvailabilityByRoom(ref.hotelId, ref.roomId).catch((err: unknown) => {
    console.error(
      `[reservation-events] push de availability falló (hotel=${ref.hotelId} room=${ref.roomId}):`,
      err instanceof Error ? err.message : err,
    )
  })
}
