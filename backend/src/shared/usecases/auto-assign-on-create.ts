// shared/usecases/auto-assign-on-create.ts — Pedirle a `reservas` una unidad para cada reserva recién
// nacida SIN habitación (web y OTA). Corrección 2026-09-13 a REQ-HAC-05 (#260): la venta sigue siendo
// por TIPO y la fila se inserta con `roomId: null`, pero el hotel quiere ver la habitación asignada en
// el sistema desde que la reserva entra — recepción la cambia después si hace falta (#258).
//
// Vive acá porque lo comparten dos connectors (`reservas-bookingengine.ts` para el widget y el grupo,
// `canales-reservas.ts` para la ingesta OTA) y los connectors sólo cablean. La elección de la unidad
// (capacidad, cuna, orden) es de `reservas/usecases/auto-assign-room.ts`; acá sólo el recorrido y el
// "nunca tirar": la reserva YA existe, un fallo de la asignación no puede tumbar el evento que la
// anunció ni la ingesta que la creó. Sin unidad libre, la reserva queda en la banda "Sin asignar",
// que es el estado que HAC-05 ya contempla.

export interface AutoAssignPort {
  autoAssignRoom: (reservationId: string, hotelId: string) => Promise<{ assigned: boolean; reason?: string; roomId?: string }>
}

export interface AutoAssignLog {
  warn: (message: string) => void
}

export interface AutoAssignOnCreateSummary {
  assigned: string[]
  /** `reservationId → motivo` (`no_rooms`, `no_fit`, error…) de las que quedaron sin unidad. */
  unassigned: Record<string, string>
}

/**
 * Recorre `reservationIds` en orden y le pide una unidad a `reservas` para cada una. `already_assigned`
 * no es un problema (la fila ya tenía habitación). Nunca rechaza.
 */
export async function autoAssignOnCreate(
  reservas: AutoAssignPort | null | undefined,
  hotelId: string,
  reservationIds: readonly unknown[],
  log: AutoAssignLog,
  origin: string,
): Promise<AutoAssignOnCreateSummary> {
  const summary: AutoAssignOnCreateSummary = { assigned: [], unassigned: {} }
  if (!hotelId || typeof reservas?.autoAssignRoom !== 'function') return summary
  const ids = reservationIds.map((id) => String(id ?? '')).filter(Boolean)
  for (const reservationId of ids) {
    try {
      const out = await reservas.autoAssignRoom(reservationId, hotelId)
      if (out.assigned || out.reason === 'already_assigned') { summary.assigned.push(reservationId); continue }
      summary.unassigned[reservationId] = out.reason ?? 'unknown'
      log.warn(`[${origin}] reserva ${reservationId} sin unidad asignada al nacer (hotel=${hotelId}): ${out.reason}`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      summary.unassigned[reservationId] = message
      log.warn(`[${origin}] autoAssignRoom falló (reserva=${reservationId}, hotel=${hotelId}): ${message}`)
    }
  }
  return summary
}

/** Ids del payload de `onBookingCreated`: todas las filas (`reservationIds`, un grupo crea varias) o la líder. */
export function reservationIdsOf(event: { id?: unknown; reservationIds?: unknown }): string[] {
  const many = Array.isArray(event?.reservationIds) ? event.reservationIds.map((x) => String(x ?? '')).filter(Boolean) : []
  return many.length ? many : [String(event?.id ?? '')].filter(Boolean)
}
