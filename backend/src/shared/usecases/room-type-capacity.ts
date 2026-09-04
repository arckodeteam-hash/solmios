// shared/usecases/room-type-capacity.ts — Requerimiento 2 (capacidad por tipo de habitación,
// 2026-09-03). Complementa a `child-composition.ts`: ese archivo decide CUÁNTO ocupa/cobra una
// composición de huéspedes; este decide CUÁNTO admite una habitación — ahora configurable por
// TIPO, no solo por unidad física.
//
// Por qué NO es una entidad `RoomTypes` con su propia tabla/FK: `Rooms.type` ya es un enum
// cerrado de 9 valores fijos (mismo enum para todos los hoteles, ver
// `habitaciones/validators/schema.ts`), y `RoomRates.roomType` ya usa ese mismo string como
// clave sin FK. Migrar eso a una entidad con id propio tocaría ~15 archivos (availability,
// occupancy-matrix, public-rates, canales/Channex, selectores del frontend) para un beneficio
// que el enum cerrado ya da gratis. En cambio, esto es una política por `(hotelId, type)` —
// mismo patrón que `child_policy`: una fila en `Configuration(hotelId, key:'room_type_capacity')`
// con `value = { [type]: { capacity, maxAdults, maxChildren } }`.
//
// Retrocompatibilidad: sin fila configurada para un tipo, `effectiveRoomCapacity` cae a los
// campos de la habitación física (`Rooms.capacity/maxAdults/maxChildren`, el comportamiento que
// ya existía) — ningún hotel ve cambiar nada hasta que configure el tipo desde Configuración.
import type { RepositoryAdapter } from 'arckode-framework'

export interface RoomTypeCapacity {
  /** Plazas totales del tipo. Siempre presente cuando hay política configurada (es el campo
   *  mínimo que pide el Requerimiento 2 — sin capacidad no hay política válida para ese tipo). */
  capacity: number
  maxAdults: number | null
  maxChildren: number | null
}

/** Lee `Configuration(hotelId, key:'room_type_capacity')` y arma un Map `type → política`.
 *  Entradas inválidas (capacity no numérica/≤0) se descartan en silencio — mismo criterio que
 *  `resolveChildPolicy`: un valor corrupto cae al fallback por habitación física, nunca revienta
 *  la reserva. Sin repo/fila/valor → Map vacío (cero overrides, comportamiento actual intacto). */
export async function resolveRoomTypeCapacityMap(
  configRepo: RepositoryAdapter<any> | undefined,
  hotelId: string,
): Promise<Map<string, RoomTypeCapacity>> {
  const map = new Map<string, RoomTypeCapacity>()
  if (!configRepo) return map
  try {
    const row = await configRepo.findOne({ hotelId, key: 'room_type_capacity' } as Record<string, unknown>)
    if (!row?.value) return map
    const raw = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) as Record<string, unknown>
    if (!raw || typeof raw !== 'object') return map
    for (const [type, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const capacity = Number(e.capacity)
      if (!Number.isFinite(capacity) || capacity <= 0) continue
      const maxAdults = Number(e.maxAdults)
      const maxChildren = Number(e.maxChildren)
      map.set(type, {
        capacity,
        maxAdults: Number.isFinite(maxAdults) && maxAdults > 0 ? maxAdults : null,
        maxChildren: Number.isFinite(maxChildren) && maxChildren >= 0 ? maxChildren : null,
      })
    }
  } catch {
    return new Map()
  }
  return map
}

/** Política efectiva para ESTA habitación: la del tipo si está configurada, si no la de la
 *  habitación física — nunca las dos mezcladas (una política de tipo a medio configurar no debe
 *  completarse con sobras de la habitación; el admin configura el tipo entero o no lo toca). */
export function effectiveRoomCapacity(
  map: Map<string, RoomTypeCapacity> | undefined,
  room: { type?: string | null; capacity: number; maxAdults?: number | null; maxChildren?: number | null },
): RoomTypeCapacity {
  const policy = room.type ? map?.get(room.type) : undefined
  if (policy) return policy
  return { capacity: room.capacity, maxAdults: room.maxAdults ?? null, maxChildren: room.maxChildren ?? null }
}
