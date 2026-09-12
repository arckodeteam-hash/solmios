// bookingengine/usecases/public-room-amenities.ts — amenidades PERSONALIZADAS por habitación en
// el motor público (REQ-01, #290).
//
// Fuente: filas `RoomAmenities` con amenityKey `custom:<slug>`, `name`, `price` >= 0 e `isActive`
// (las configura el hotel desde el formulario de cada habitación — ver
// `amenities/usecases/room-amenity-items.ts`). Las keys fijas del catálogo siguen siendo
// features gratuitas y NO pasan por acá.
//
// Replica el patrón de `childAmenities` (#233), con una diferencia central: el catálogo NO es del
// hotel sino de CADA habitación física, y el huésped elige un TIPO (no una unidad). Por eso:
//   - `GET /api/public/hotels/:slug/room-amenities` expone, por `roomType`, la UNIÓN (por key)
//     de las custom activas de sus rooms vendibles, con el precio MÍNIMO entre ellas.
//   - Al crear la reserva, el backend PREFIERE las rooms del tipo que ofrecen TODAS las keys
//     pedidas (`preferRoomsOffering`) y cobra el precio REAL de la habitación asignada
//     (`resolveRoomAmenityLines` contra las filas de ESA room). Una key que la room asignada no
//     ofrece se ignora con `logger.warn` (mismo criterio que childAmenities: el huésped no tiene
//     la culpa de un catálogo stale; mejor crear la reserva sin ese extra).
//   - NUNCA se toma el precio del body.
import type { RepositoryAdapter } from 'arckode-framework'
import { isCustomAmenityKey } from '../../amenities/usecases/room-amenity-items'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import type { PublicBookingLogger } from './public-booking'

/**
 * Línea del snapshot que se persiste en `Reservations.roomAmenities`. Precio CONGELADO al
 * reservar. `quantity` = unidades físicas (1 por fila; en un grupo la línea la lleva ×
 * `line.quantity` pero cada fila persiste quantity 1).
 */
export interface RoomAmenityLine {
  key: string
  name: string
  price: number
  quantity: number
  total: number
}

/** Ítem del catálogo público por tipo: `{ byRoomType: { [type]: PublicRoomAmenity[] } }`. */
export interface PublicRoomAmenity {
  key: string
  name: string
  price: number
}

const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Normaliza las keys que manda el widget (`[{key}]`, o strings sueltos por tolerancia). Únicas,
 * trim, y SOLO keys `custom:*`: una key fija (wifi, tv) no es vendible — se descarta en silencio.
 */
export function normalizeRoomAmenityKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const key = typeof item === 'string' ? item : (item && typeof item.key === 'string' ? item.key : '')
    const trimmed = key.trim()
    if (trimmed && isCustomAmenityKey(trimmed) && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

/** Filas `RoomAmenities` personalizadas VENDIBLES: key custom, isActive on (0/1/true/false), name no vacío. */
export function customRoomAmenities(rows: any[]): any[] {
  return (rows ?? []).filter((a: any) =>
    a && isCustomAmenityKey(a.amenityKey) && isOn(a.isActive) && String(a.name ?? '').trim() !== '')
}

/**
 * Resuelve las keys pedidas contra las filas `RoomAmenities` de UNA habitación (la asignada).
 * Key no ofrecida o inactiva en esa room → se ignora con warn. Precio del SERVER (round2, >= 0);
 * precio 0 es válido (queda en el snapshot con total 0).
 *
 * @param quantity cuántas unidades físicas llevan cada amenidad (1 en el flujo de 1 habitación).
 */
export function resolveRoomAmenityLines(
  roomRows: any[],
  keys: string[],
  quantity: number,
  logger?: PublicBookingLogger,
): { lines: RoomAmenityLine[]; total: number } {
  const byKey = new Map<string, any>()
  for (const a of customRoomAmenities(roomRows)) if (!byKey.has(a.amenityKey)) byKey.set(a.amenityKey, a)
  const lines: RoomAmenityLine[] = []
  let total = 0
  for (const key of keys) {
    const found = byKey.get(key)
    if (!found) {
      logger?.warn('Amenidad de habitación ignorada: la habitación asignada no la ofrece o está inactiva', { amenityKey: key, roomId: roomRows?.[0]?.roomId })
      continue
    }
    const price = round2(Math.max(0, Number(found.price) || 0))
    const lineTotal = round2(price * quantity)
    lines.push({ key: found.amenityKey, name: String(found.name).trim(), price, quantity, total: lineTotal })
    total += lineTotal
  }
  return { lines, total: round2(total) }
}

/** ¿Esta room (sus filas RoomAmenities) ofrece TODAS las keys pedidas? */
export function roomOffersAll(roomRows: any[], keys: string[]): boolean {
  if (keys.length === 0) return true
  const offered = new Set(customRoomAmenities(roomRows).map((a: any) => a.amenityKey))
  return keys.every((k) => offered.has(k))
}

/**
 * Reordena candidatas (que ya vienen ordenadas por basePrice) de forma ESTABLE: primero las que
 * ofrecen TODAS las keys pedidas, después el resto; dentro de cada grupo se conserva el orden.
 * Con keys vacío devuelve `candidates` tal cual (cero cambio para quien no pide amenidades).
 */
export function preferRoomsOffering(candidates: any[], amenitiesByRoom: Map<string, any[]>, keys: string[]): any[] {
  if (keys.length === 0) return candidates
  const offering = candidates.filter((r) => roomOffersAll(amenitiesByRoom.get(r.id) ?? [], keys))
  const rest = candidates.filter((r) => !roomOffersAll(amenitiesByRoom.get(r.id) ?? [], keys))
  return [...offering, ...rest]
}

/** Agrupa filas `RoomAmenities` por `roomId` (una lectura, N habitaciones). */
export function groupAmenitiesByRoom(rows: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>()
  for (const a of rows ?? []) {
    if (!a?.roomId) continue
    if (!map.has(a.roomId)) map.set(a.roomId, [])
    map.get(a.roomId)!.push(a)
  }
  return map
}

/**
 * Lee las filas `RoomAmenities` de las rooms dadas. Una sola `findMany({})` filtrada en memoria
 * (mismo criterio que `getPublicBookingBySlug`): el ORM no soporta `IN`, y N findMany por room
 * sería N viajes para un catálogo chico.
 */
export async function loadRoomAmenitiesFor(orm: { findMany(model: string, filter: any): Promise<any[]> }, roomIds: string[]): Promise<Map<string, any[]>> {
  if (roomIds.length === 0) return new Map()
  if (roomIds.length === 1) return groupAmenitiesByRoom(((await orm.findMany('RoomAmenities', { roomId: roomIds[0] })) as any[]) ?? [])
  const wanted = new Set(roomIds)
  const all = ((await orm.findMany('RoomAmenities', {})) as any[]) ?? []
  return groupAmenitiesByRoom(all.filter((a: any) => wanted.has(a.roomId)))
}

export interface PublicRoomAmenitiesDeps {
  hotels: RepositoryAdapter<any>
  orm: { findMany(model: string, filter: any): Promise<any[]> }
}

/**
 * GET /api/public/hotels/:slug/room-amenities → `{ byRoomType: { [type]: [{key, name, price}] } }`.
 *
 * Por tipo: unión por key de las custom activas de sus rooms VENDIBLES (`isRoomSellable` y
 * `onlineBookingEnabled !== false`). Si la misma key tiene precios distintos entre rooms del tipo
 * se expone el MÍNIMO: es lo que el widget muestra como "desde"; al reservar, el backend prefiere
 * las rooms que la ofrecen y cobra el precio REAL de la habitación asignada (ver cabecera).
 * Ordenado por name. Anti-enumeración: mismo 404 para "no existe" y "no activo".
 */
export async function getPublicRoomAmenities(
  deps: PublicRoomAmenitiesDeps,
  slug: string,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel || hotel.onlineBookingStatus !== 'active') {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  const rooms = (((await deps.orm.findMany('Rooms', { hotelId: hotel.id })) as any[]) ?? [])
    .filter((r: any) => isRoomSellable(r.status) && r.onlineBookingEnabled !== false)
  const amenitiesByRoom = await loadRoomAmenitiesFor(deps.orm, rooms.map((r: any) => r.id))

  const byType = new Map<string, Map<string, PublicRoomAmenity>>()
  for (const r of rooms) {
    const type = String(r.type || 'standard')
    if (!byType.has(type)) byType.set(type, new Map())
    const bucket = byType.get(type)!
    for (const a of customRoomAmenities(amenitiesByRoom.get(r.id) ?? [])) {
      const price = round2(Math.max(0, Number(a.price) || 0))
      const prev = bucket.get(a.amenityKey)
      if (!prev || price < prev.price) bucket.set(a.amenityKey, { key: a.amenityKey, name: String(a.name).trim(), price })
    }
  }

  const byRoomType: Record<string, PublicRoomAmenity[]> = {}
  for (const [type, bucket] of byType) {
    const items = Array.from(bucket.values()).sort((a, b) => a.name.localeCompare(b.name))
    if (items.length > 0) byRoomType[type] = items
  }
  return { status: 200, body: { byRoomType } }
}
