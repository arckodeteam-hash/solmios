// connectors/reservas-canales.ts — Conector entre módulos
// Cuando una reserva se crea/actualiza/cancela/borra (vía el MÓDULO reservas), recalcula y
// empuja availability a Channex. Qué se publica ante cada evento vive en
// `canales/usecases/reservation-events.ts` (CLAUDE #3: el conector solo wirea).
// Los handlers custom (check-in/checkout/booking público/bloqueos) bypassan el módulo y disparan
// pushAvailabilityByRoom inline en composition-root.

import type { ConnectorContext } from 'arckode-framework'
import { onReservationRoomChanged, type ReservationEventDeps, type ReservationRef } from '../modules/canales/usecases/reservation-events'

export function reservasCanalesConnector(ctx: ConnectorContext): void {
  const reservas = ctx.resolveModule<{ setSockets: (s: any) => void }>('reservas')
  type Canales = {
    pushAvailabilityByRoom: (h: string, r: string) => Promise<{ pushed: boolean }>
    pushAvailability: (h: string, t: string) => Promise<{ pushed: boolean }>
  }
  const deps: ReservationEventDeps = {
    pushAvailabilityByRoom: (hotelId, roomId) => ctx.resolveModule<Canales>('canales').pushAvailabilityByRoom(hotelId, roomId),
    // REQ-HAC-05 (#260): la reserva sin unidad (`roomId` null) publica por su `roomType`.
    pushAvailabilityByType: (hotelId, roomType) => ctx.resolveModule<Canales>('canales').pushAvailability(hotelId, roomType),
  }

  reservas.setSockets({
    // create → reserva nueva ocupa noches → availability baja.
    onReservasCreated: (reserva: ReservationRef) => onReservationRoomChanged(deps, reserva),
    // update → cubre cancelación (status='cancelled' libera noches) y cambios de fecha/room.
    onReservasUpdated: (reserva: ReservationRef) => onReservationRoomChanged(deps, reserva),
    // delete → las noches quedan libres → availability sube. El evento lleva hotel y habitación
    // desde el 2026-09-05; antes solo traía el `id` y acá no se hacía nada.
    onReservasDeleted: (_id: string, borrada?: ReservationRef) => onReservationRoomChanged(deps, borrada),
  })
}
