// bookingengine/usecases/public-room-amenities.ts — amenidades PERSONALIZADAS por habitación en
// el motor público (REQ-01, #290).
//
// Fuente: filas `RoomAmenities` con amenityKey `custom:<slug>`, `name`, `price` >= 0 e `isActive`
// (las configura el hotel desde el formulario de cada habitación — ver
// `amenities/usecases/room-amenity-items.ts`). Las keys fijas del catálogo siguen siendo
// features gratuitas y NO pasan por acá.
//
// El catálogo NO es del hotel sino de CADA habitación física, y el huésped elige un TIPO (no una
// unidad). Por eso:
//   - `GET /api/public/hotels/:slug/room-amenities` expone, por `roomType`, la UNIÓN (por key)
//     de las custom activas de sus rooms vendibles, con el precio MÍNIMO entre ellas.
//   - Al crear la reserva, el backend PREFIERE las rooms del tipo que ofrecen TODAS las keys
//     pedidas (`preferRoomsOffering`; con cuna pedida, después las que al menos tienen la cuna) y
//     cobra el precio REAL de la habitación asignada (`resolveRoomAmenityLines` contra las filas
//     de ESA room). Una key que la room asignada no ofrece se ignora con `logger.warn` (el
//     huésped no tiene la culpa de un catálogo stale; mejor crear la reserva sin ese extra).
//   - NUNCA se toma el precio del body.
//
// #292 — La CUNA es una de estas amenidades. No existe más el toggle global del hotel ni el
// catálogo `child_amenities`: "¿Necesita cuna?" se ofrece sólo si el tipo publica una amenidad que
// `isCribAmenityKey` reconozca como cuna (`shared/usecases/crib-amenity.ts`: `custom:cuna`,
// `custom:crib`, `custom:berco`, o cualquier `custom:*` cuyo nombre diga "cuna"/"crib"/"berço" —
// el slug lo deriva el panel del NOMBRE, así que "Cuna para bebé" NO es `custom:cuna`), y decir
// "sí" equivale a pedir `CRIB_AMENITY_KEY` (la key canónica) en `roomAmenities` — al resolver
// contra la unidad asignada esa key acepta CUALQUIER fila cuna de la habitación y la línea
// persistida conserva la key real de la fila; el precio real lo cobra `resolveRoomAmenityLines`
// como cualquier otra custom. `needsCrib`/`cribCount` se deciden DESPUÉS de esa resolución
// (`hasCribLine`): reflejan la unidad finalmente asignada, no el tipo.
import type { RepositoryAdapter } from 'arckode-framework'
import { isCustomAmenityKey } from '../../amenities/usecases/room-amenity-items'
import { isRoomSellable } from '../../../shared/usecases/room-status'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'
import { CRIB_AMENITY_KEY, isCribAmenityKey } from '../../../shared/usecases/crib-amenity'
import { round2 } from '../../../shared/utils/money'
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

/** #292 — key CANÓNICA con la que se PIDE la cuna (ver `shared/usecases/crib-amenity.ts`). Se
 *  re-exporta para los usecases del módulo y sus tests. */
export { CRIB_AMENITY_KEY }

const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

/** Fila `RoomAmenities` (ya filtrada como custom vendible) que satisface la key pedida: la key
 *  exacta, o — si lo pedido es la cuna — cualquier fila que `isCribAmenityKey` reconozca. */
function findOffered(rows: any[], key: string): any | undefined {
  if (isCribAmenityKey(key)) return rows.find((a: any) => isCribAmenityKey(a.amenityKey, a.name))
  return rows.find((a: any) => a.amenityKey === key)
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
  const offered = customRoomAmenities(roomRows)
  const lines: RoomAmenityLine[] = []
  let total = 0
  for (const key of keys) {
    const found = findOffered(offered, key)
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
  const offered = customRoomAmenities(roomRows)
  return keys.every((k) => findOffered(offered, k) !== undefined)
}

/**
 * Reordena candidatas (que ya vienen ordenadas por basePrice) de forma ESTABLE: primero las que
 * ofrecen TODAS las keys pedidas, después el resto; dentro de cada grupo se conserva el orden.
 * Con keys vacío devuelve `candidates` tal cual (cero cambio para quien no pide amenidades).
 *
 * #292 — `priorityKey` (la cuna): si viene y está entre `keys`, se abre un escalón intermedio —
 * (1) ofrecen todo, (2) ofrecen al menos `priorityKey`, (3) el resto. Una cuna para un bebé pesa
 * más que un jacuzzi: si ninguna unidad tiene la combinación completa, se prefiere la que tenga
 * la cuna antes que una que sólo tenga el resto. Sin `priorityKey` el orden es el de siempre.
 */
export function preferRoomsOffering(candidates: any[], amenitiesByRoom: Map<string, any[]>, keys: string[], priorityKey?: string): any[] {
  if (keys.length === 0) return candidates
  const usePriority = !!priorityKey && keys.includes(priorityKey)
  const rank = (r: any): number => {
    const rows = amenitiesByRoom.get(r.id) ?? []
    if (roomOffersAll(rows, keys)) return 0
    if (usePriority && roomOffersAll(rows, [priorityKey!])) return 1
    return 2
  }
  return candidates
    .map((r, index) => ({ r, index, rank: rank(r) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.r)
}

/** #292 — ¿alguna de las rooms dadas ofrece la cuna, es decir tiene una fila `RoomAmenities` ACTIVA
 *  que `isCribAmenityKey` reconozca? Helper de consulta (catálogo público / diagnóstico). OJO: NO es el gate
 *  de `needsCrib` al reservar — ahí lo que manda es la línea `custom:cuna` que
 *  `resolveRoomAmenityLines` haya resuelto contra la unidad FINALMENTE asignada (`hasCribLine`). */
export function roomsOfferCrib(amenitiesByRoom: Map<string, any[]>, roomIds: string[]): boolean {
  return roomIds.some((id) => roomOffersAll(amenitiesByRoom.get(id) ?? [], [CRIB_AMENITY_KEY]))
}

/** #292 — ¿el snapshot resuelto de una unidad trae la línea de cuna (key real de la fila, que
 *  puede ser `custom:crib` o `custom:cuna_para_bebe`)? Es la ÚNICA fuente de verdad de
 *  `needsCrib`/`cribCount` al persistir: `needsCrib === (roomAmenities tiene una línea cuna)`. */
export function hasCribLine(lines: RoomAmenityLine[]): boolean {
  return lines.some((l) => isCribAmenityKey(l.key, l.name))
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
  /** #276 (MR-11) — toggle Activo/Inactivo del hotel (`booking_config.enabled`). Opcional (compat). */
  bookingConfig?: RepositoryAdapter<any>
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

  // #276 (MR-11) — un solo interruptor del motor público (`shared/usecases/booking-engine-gate.ts`):
  // `hotels.onlineBookingStatus` (plataforma) + `booking_config.enabled` (hotel), mismo 404.
  const hotel = await deps.hotels.findOne({ slug })
  const bookingConfig = hotel && deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (!isEngineOpen(hotel, bookingConfig)) return engineClosed()

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
