import type { Logger } from 'arckode-framework'

export function createPushAvailability(resolveModule: <T>(name: string) => T | null, logger: Logger): (hotelId: string, roomId: string) => void {
  return (hotelId: string, roomId: string): void => {
    const canales = resolveModule<{ pushAvailabilityByRoom: (h: string, r: string) => Promise<{ pushed: boolean }> }>('canales')
    if (!canales?.pushAvailabilityByRoom) return
    void canales.pushAvailabilityByRoom(hotelId, roomId).catch((e: unknown) =>
      logger.warn('pushAvailability Channex falló', { hotelId, roomId, error: String(e) }),
    )
  }
}

/** REQ-HAC-05 (#260) — misma forma que `createPushAvailability`, pero por TIPO de habitación: lo
 *  usa el motor público, cuya reserva nace sin unidad (`roomId` null) y sólo conoce `roomType`.
 *  Delega en `canales.pushAvailability(hotelId, roomType)`, que ya empuja por tipo. */
export function createPushAvailabilityByType(resolveModule: <T>(name: string) => T | null, logger: Logger): (hotelId: string, roomType: string) => void {
  return (hotelId: string, roomType: string): void => {
    const canales = resolveModule<{ pushAvailability: (h: string, t: string) => Promise<{ pushed: boolean }> }>('canales')
    if (!canales?.pushAvailability) return
    void canales.pushAvailability(hotelId, roomType).catch((e: unknown) =>
      logger.warn('pushAvailabilityByType Channex falló', { hotelId, roomType, error: String(e) }),
    )
  }
}
