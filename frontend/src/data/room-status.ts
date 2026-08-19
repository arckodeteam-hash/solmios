// data/room-status.ts — Fuente única de la presentación de `RoomStatus`.
//
// Antes vivía duplicado en tres lugares del MISMO dashboard con valores divergentes:
//   · pages/dashboard/index.vue      → occupied #EF4444 · out_of_service #94A3B8 "Fuera de servicio"
//   · components/.../FloorHeatMap    → occupied #EF4444 · out_of_service #475569 "Mantenimiento"
//   · components/.../RoomsStatusDonut→ occupied #2563EB · out_of_service #EF4444 "Mantenimiento"
// El resultado en pantalla era que el rojo #EF4444 significaba "ocupada" en el mapa de
// habitaciones y "fuera de servicio" en el donut de al lado, y que el mismo estado tenía
// dos nombres distintos a 30cm de distancia. Ese es el bug que este archivo cierra.
//
// Color canónico: ocupada = azul (es el estado DESEADO, no una alarma); el rojo queda
// reservado para el único estado que sí requiere acción: fuera de servicio.
import type { RoomStatus } from '@/types'

export interface RoomStatusMeta {
  /** Nombre completo, en singular — tooltips y modal de UNA habitación. */
  label: string
  /** Nombre en plural — leyendas que acompañan un CONTEO ("12 Ocupadas"). */
  plural: string
  /** Nombre corto para la celda del mapa (máx ~8 caracteres). */
  short: string
  /** Color de marca del estado (hex, se compone con alpha en los `:style`). */
  color: string
}

export const ROOM_STATUS_META: Record<RoomStatus, RoomStatusMeta> = {
  available:      { label: 'Disponible',         plural: 'Disponibles',         short: 'Libre',    color: '#22C55E' },
  occupied:       { label: 'Ocupada',            plural: 'Ocupadas',            short: 'Ocupada',  color: '#2563EB' },
  pending:        { label: 'Check-in pendiente', plural: 'Check-in pendiente',  short: 'Llegada',  color: '#06B6D4' },
  cleaning:       { label: 'En limpieza',        plural: 'En limpieza',         short: 'Limpieza', color: '#F59E0B' },
  dirty:          { label: 'Sucia',              plural: 'Sucias',              short: 'Sucia',    color: '#FB923C' },
  out_of_service: { label: 'Fuera de servicio',  plural: 'Fuera de servicio',   short: 'F/S',      color: '#EF4444' },
}

/** Orden de presentación en leyendas y donut (de "libre" a "no vendible"). */
export const ROOM_STATUS_ORDER: RoomStatus[] = [
  'occupied', 'available', 'pending', 'cleaning', 'dirty', 'out_of_service',
]

const FALLBACK: RoomStatusMeta = { label: 'Desconocido', plural: 'Desconocidos', short: '—', color: '#94A3B8' }

/**
 * Metadata de un estado. Acepta `string` porque la API puede devolver un estado que el
 * front todavía no conoce; degrada a gris neutro en vez de romper el render.
 */
export function roomStatusMeta(status: string): RoomStatusMeta {
  return ROOM_STATUS_META[status as RoomStatus] ?? FALLBACK
}

/** Operación de RECEPCIÓN que corresponde a una habitación, según su estado. */
export type FrontDeskAction = 'checkin' | 'checkout'

/**
 * Qué puede hacer recepción con una habitación en este estado — o `null` si nada.
 *
 * Existe para separar dos dominios que el modal del dashboard mezclaba: el estado FÍSICO de la
 * habitación (limpia / sucia / fuera de servicio, que sí se cambia con un PUT) y el ciclo de
 * vida de la RESERVA (check-in / check-out). El botón "Check-in" del mapa de habitaciones hacía
 * `PUT /rooms/:id {status:'occupied'}` y nada más, mientras que el check-in de verdad
 * (`reservas/usecases/checkin.ts`) es una transacción que además reclama la reserva con un
 * guardián anti-doble-cobro, crea el folio y postea el cargo de habitación con su impuesto.
 * El resultado eran "habitaciones fantasma": ocupadas sin reserva, sin folio y sin cargo — tan
 * frecuentes que `pages/checkin/index.vue` tuvo que aprender a corregirlas al vuelo.
 *
 * `dirty` y `cleaning` NO habilitan check-in a propósito: la habitación se limpia primero.
 * `out_of_service` tampoco: no es vendible hasta reactivarla.
 */
export function frontDeskActionFor(status: string): FrontDeskAction | null {
  if (status === 'available' || status === 'pending') return 'checkin'
  if (status === 'occupied') return 'checkout'
  return null
}

/** Permiso que el backend exige para cada operación (`reservas/index.ts`). */
export const FRONT_DESK_PERMISSION: Record<FrontDeskAction, { module: string; action: string }> = {
  checkin: { module: 'reservations', action: 'checkin' },
  checkout: { module: 'reservations', action: 'checkout' },
}

/** Texto del botón. En español, como toda la UI. */
export const FRONT_DESK_LABEL: Record<FrontDeskAction, string> = {
  checkin: 'Hacer Check-in',
  checkout: 'Hacer Check-out',
}
