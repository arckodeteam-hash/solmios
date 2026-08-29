// shared/usecases/room-status.ts — Qué significa cada estado de una habitación. Fuente ÚNICA.
//
// Existía el mismo criterio escrito de cuatro formas distintas, y no coincidían:
//
//   availability.ts / public-calendar.ts  →  lista NEGRA {out_of_order, out_of_service, maintenance}
//   public-booking.ts / -group.ts         →  lista BLANCA {available, disponible}
//   public-api-availability.ts            →  híbrido (blanca sin fechas, negra con fechas)
//
// El resultado, verificado en producción el 2026-08-29: el motor PUBLICABA una habitación en
// `cleaning` y después la RECHAZABA al reservar ("No hay habitaciones de este tipo disponibles
// para esas fechas"). El huésped elegía fechas, cargaba sus datos, aceptaba las condiciones y
// recibía el rechazo en el último click. Y `cleaning` es el estado más común que existe: toda
// habitación pasa por ahí entre un huésped y el siguiente.
//
// ─── Por qué gana la lista NEGRA ────────────────────────────────────────────────────────────
// `rooms.status` describe la habitación AHORA, no una fecha futura. Que hoy esté ocupada o en
// limpieza no dice nada sobre si se puede vender para dentro de tres meses — eso lo deciden las
// reservas del rango y los `room_blocks`, que sí tienen fechas. Sólo hay tres estados que
// significan "esta unidad no se puede vender, y no sabemos hasta cuándo", y ésos son los que
// bloquean.
//
// Corolario conocido y aceptado: una habitación marcada `maintenance` queda invendible para TODAS
// las fechas futuras hasta que alguien la vuelva a marcar disponible. Para sacarla de venta un
// rango acotado existe `room_blocks`, que lleva fechas.

/** Estados válidos de `rooms.status` (espeja `habitaciones/types.ts`). */
export const ROOM_STATUSES = ['available', 'occupied', 'maintenance', 'cleaning', 'out_of_order', 'reserved'] as const

/**
 * Estados en los que la unidad NO se puede vender para NINGUNA fecha.
 *
 * `out_of_service` no está en el enum del módulo de habitaciones: se conserva porque las listas
 * originales lo incluían y puede haber filas viejas con ese valor. Quitarlo pondría en venta
 * habitaciones que hoy están fuera.
 *
 * ⚠️ Los valores en ESPAÑOL no son decorativos: la lista blanca que esto reemplaza aceptaba
 * `'disponible'` además de `'available'`, o sea que hay filas en castellano dando vueltas
 * (`public-booking-room-resolution.test.ts` cubre una en `'mantenimiento'`). Con la lista negra
 * el olvido se paga al revés que antes: un estado no listado se PONE EN VENTA. Al agregar un
 * estado nuevo, agregar también su variante en español.
 */
export const UNSELLABLE_ROOM_STATUS: ReadonlySet<string> = new Set([
  'out_of_order',
  'out_of_service',
  'maintenance',
  // Variantes en español de los mismos tres estados.
  'fuera_de_servicio',
  'fuera de servicio',
  'mantenimiento',
  'averiada',
])

/**
 * ¿Esta habitación se puede vender para un rango futuro?
 *
 * Un `status` vacío o desconocido se considera VENDIBLE a propósito: es lo que hacían las listas
 * negras, y es el default seguro para el ingreso — un dato incompleto no debería sacar inventario
 * de la venta en silencio. Lo que NO puede pasar es lo contrario: que un endpoint lo publique y
 * otro lo rechace.
 */
export function isRoomSellable(status: unknown): boolean {
  return !UNSELLABLE_ROOM_STATUS.has(String(status ?? '').toLowerCase())
}

/** Estados que el panel cuenta como "en limpieza". `dirty` NUNCA existió en el enum. */
export const CLEANING_ROOM_STATUS: ReadonlySet<string> = new Set(['cleaning', 'dirty'])

/** Estados que el panel cuenta como "en mantenimiento" / fuera de servicio. */
export const MAINTENANCE_ROOM_STATUS: ReadonlySet<string> = UNSELLABLE_ROOM_STATUS

export function isCleaning(status: unknown): boolean {
  return CLEANING_ROOM_STATUS.has(String(status ?? '').toLowerCase())
}

export function isUnderMaintenance(status: unknown): boolean {
  return MAINTENANCE_ROOM_STATUS.has(String(status ?? '').toLowerCase())
}
