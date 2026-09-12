// shared/usecases/room-vacated.ts — Una habitación quedó vacía: pasa a `cleaning` y nace su tarea.
//
// Lo llama `connectors/reservas-housekeeping.ts` en DOS momentos que para housekeeping son el
// mismo hecho: el check-out (`onReservationCheckedOut`) y la reasignación en estadía
// (`onRoomVacatedMidStay`, #258 — el huésped se mudó de unidad y la anterior quedó sucia con
// él todavía en el hotel). Vive acá y no en el connector para que el connector sólo wiree
// (regla del analyzer: los conectores no deciden) y para que los dos caminos no diverjan.
//
// `habitaciones.update` (y no el ORM directo) porque además de escribir el estado bumpea el
// caché del módulo — `moveStay` ya dejó la fila en `cleaning` dentro de su transacción, pero
// sin este paso el panel seguía mostrando la unidad anterior como `occupied`.

export interface RoomVacatedPorts {
  habitaciones: { update: (id: string, dto: Record<string, unknown>, user: SystemUser) => Promise<unknown> }
  housekeeping: { create: (dto: Record<string, unknown>, user: SystemUser) => Promise<unknown> }
}

export type SystemUser = { id: string; role: string; hotelId: string }

export const CONNECTOR_USER_ID = 'system-connector'

export const systemUserFor = (hotelId: string): SystemUser => ({ id: CONNECTOR_USER_ID, role: 'super_admin', hotelId })

/** Estado + tarea `full_cleaning` con prioridad `high`: la unidad se vuelve a vender en cuanto se limpie. */
export async function releaseRoomForCleaning(ports: RoomVacatedPorts, data: { roomId: string; hotelId: string }): Promise<void> {
  const user = systemUserFor(data.hotelId)
  await ports.habitaciones.update(data.roomId, { status: 'cleaning' }, user)
  await ports.housekeeping.create({
    id: crypto.randomUUID(), roomId: data.roomId, hotelId: data.hotelId,
    type: 'full_cleaning', priority: 'high', status: 'pending',
  }, user)
}
