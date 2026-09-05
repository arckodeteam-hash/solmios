// habitaciones/usecases/set-type-base-price.ts — Fijar el precio base de TODAS las habitaciones de
// un tipo de una sola vez.
//
// Por qué existe. `rooms.basePrice` es el precio base de UNA habitación física, y un tipo agrupa
// varias. La grilla de tarifas (`/panel/tarifas`) tarifa por TIPO, no por unidad: ahí el hotel ve un
// solo campo "Precio base" por tipo, y lo que espera al cambiarlo es que valga para todo el tipo.
// Antes ese campo escribía en `room_rates` —una copia por temporada, ocupación y canal— y el precio
// de la habitación quedaba intacto; de ahí salían los tres números distintos para la misma suite que
// se midieron en producción el 2026-09-05. Ahora escribe donde vive el dato de verdad.
//
// El precio base del TIPO se lee como el mínimo positivo entre sus unidades
// (`pricing/usecases/pricing-queries.ts:roomTypesFor`, mismo criterio que el motor público para
// publicar "desde $X"). Escribirlo en todas las unidades del tipo mantiene esa lectura estable: si
// se escribiera en una sola, el mínimo podría seguir dando otro número y el campo no haría nada
// visible — el mismo bug de "guardé y no cambió" en otra forma.

import type { RepositoryAdapter } from 'arckode-framework'

export interface RoomRow { id: string; type?: string; basePrice?: number }

const MAX_PRICE = 1_000_000   // mismo tope que el validador de tarifas (pricing/validators/schema.ts)

/** Precio base válido, o `null` si el valor no sirve para escribir. Un base en 0 o negativo dejaría
 *  al tipo publicando gratis (o rompería el cálculo de porcentajes), así que se rechaza. */
export function normalizeBasePrice(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null
  return Math.round(n * 100) / 100
}

/**
 * Escribe `basePrice` en todas las habitaciones del hotel cuyo `type` coincida. Devuelve cuántas
 * unidades se tocaron — 0 significa que el tipo no existe o que ya tenían ese precio.
 *
 * `onChanged` se llama UNA vez, y solo si algo cambió: es donde el service invalida la caché de
 * listados. Sin eso, `/panel/habitaciones` sigue mostrando el precio viejo hasta que expire.
 * NO republica a las OTAs desde acá a propósito: quien llama es el guardado de la grilla de
 * tarifas, que ya emite `onRatesUpdated` a continuación y dispara un solo push consolidado.
 */
export async function setTypeBasePrice(
  repo: RepositoryAdapter<any>, hotelId: string, roomType: string, basePrice: unknown,
  onChanged?: (hotelId: string) => Promise<unknown>,
): Promise<number> {
  const price = normalizeBasePrice(basePrice)
  const type = String(roomType || '').trim()
  if (price === null || !type) return 0
  const rooms = (await repo.findMany({ hotelId, type })) as RoomRow[]
  let touched = 0
  for (const room of rooms) {
    if (Number(room.basePrice) === price) continue
    await repo.update(room.id, { basePrice: price })
    touched++
  }
  if (touched > 0) await onChanged?.(hotelId)
  return touched
}
