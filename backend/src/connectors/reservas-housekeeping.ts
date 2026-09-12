// connectors/reservas-housekeeping.ts — Conector entre módulos
// Cuando una reserva se hace check-out, el conector dispara la actualización de
// la habitación (status → cleaning) y la creación de la tarea de housekeeping.
// #274: además mantiene la tarea `arrival_setup` (cuna, amenidades infantiles, régimen, pedido)
// en sincronía con la reserva: alta, edición (cambio de habitación/fecha/status) y cancelación
// llaman a `housekeeping.syncArrivalSetup`, que es idempotente. Best-effort: un fallo de
// housekeeping NO puede romper el alta/edición de la reserva (patrón reservas-bookingengine.ts).
// Los conectores orquestan módulos SIN que estos se importen entre sí (regla del framework).

import type { ConnectorContext } from 'arckode-framework'

type HousekeepingSync = { syncArrivalSetup: (r: any) => Promise<any> }

export function reservasHousekeepingConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{ setSockets: (s: any) => void }>('reservas')

  const syncArrival = async (label: string, reserva: any): Promise<void> => {
    try {
      const housekeeping = ctx.resolveModule<HousekeepingSync>('housekeeping')
      await housekeeping.syncArrivalSetup(reserva)
    } catch (err) {
      console.error(`[reservas-housekeeping] syncArrivalSetup falló (${label}, reserva=${reserva?.id}):`, err instanceof Error ? err.message : err)
    }
  }

  reservas.setSockets({
    onReservationCheckedOut: async (data: { reservationId: string; roomId: string; hotelId: string }) => {
      const habitaciones = ctx.resolveModule<{ update: (id: string, dto: any, user: any) => Promise<any> }>('habitaciones')
      await habitaciones.update(data.roomId, { status: 'cleaning' } as any, { id: 'system-connector', role: 'super_admin', hotelId: data.hotelId })
      const housekeeping = ctx.resolveModule<{ create: (d: any, u: any) => Promise<any> }>('housekeeping')
      await housekeeping.create({
        id: crypto.randomUUID(), roomId: data.roomId, hotelId: data.hotelId,
        type: 'full_cleaning', priority: 'high', status: 'pending',
      } as any, { id: 'system-connector', role: 'super_admin', hotelId: data.hotelId })
    },
    onReservasCreated: (reserva: any) => syncArrival('created', reserva),
    // Cubre cambio de habitación/fecha antes del check-in y la cancelación por PUT.
    onReservasUpdated: (reserva: any) => syncArrival('updated', reserva),
    // La reserva cancelada borra su tarea pending (syncArrivalSetup con status != confirmed).
    onReservationCancelled: (data: { reservationId: string; hotelId: string }) =>
      syncArrival('cancelled', { id: data.reservationId, hotelId: data.hotelId, status: 'cancelled' }),
  })
}
