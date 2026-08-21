// bookingengine/usecases/public-room-types.ts — GET /api/public/hotels/:slug/room-types
//
// Catálogo de tipos de habitación que el hotel VENDE, sin filtrar por disponibilidad en NINGUNA
// fecha puntual — a diferencia de `/rates` (que correctamente excluye un tipo sin stock continuo
// para el rango de fechas PEDIDO, ver `usecases/availability.ts`).
//
// ─── Bug real que esto arregla (reportado 2026-08-20) ───────────────────────────────────────
// La vitrina "Habitaciones" de la landing (`RoomsBlock.vue`) reusaba `/rates` con un rango
// indicativo fijo ("mañana + N noches", `hotel-landing.vue:indicativeDateRange`) para decidir QUÉ
// tarjetas mostrar. Si un tipo estaba reservado justo esa ventana puntual, `/rates` lo excluía
// (correcto para esa búsqueda) y la vitrina lo interpretaba como "el hotel no tiene ese tipo" —
// un tipo real y vendible desaparecía ENTERO de la web pública por estar ocupado un par de días.
// Este endpoint separa las dos preguntas: "qué tipos vendo" (acá, no depende de fechas) vs.
// "qué está libre para ESTA fecha" (`/rates`). El orquestador de la landing combina ambos:
// el catálogo decide qué tarjetas existen, `/rates` las enriquece con precio/disponibilidad en
// vivo cuando puede.
import type { RepositoryAdapter } from 'arckode-framework'
import { resolvePhotoByType } from './public-rates'

export interface PublicRoomTypesDeps {
  hotels: RepositoryAdapter<any>
  rooms: RepositoryAdapter<any>
  /** Opcional, mismo criterio de degradación que `public-rates.ts`: sin cablear, `photoUrl` es `null`. */
  hotelMedia?: RepositoryAdapter<any>
  /** Toggle Activo/Inactivo del admin — mismo criterio anti-enumeración que `/rates` y `/calendar`. */
  bookingConfig?: RepositoryAdapter<any>
}

export interface PublicRoomTypeCatalogEntry {
  /** = `room.type` (string libre, no hay entidad RoomType propia — mismo criterio que `/rates`). */
  id: string
  name: string
  /** Capacidad MÁXIMA entre las unidades del tipo (mismo criterio que `AvailabilityUseCase.aggregate`). */
  capacity: number
  surfaceArea: number
  /** `min(rooms.basePrice)` del tipo. 0 si ninguna unidad tiene precio cargado. */
  basePrice: number
  photoUrl: string | null
}

/**
 * Mismo contrato `{status, body}` que el resto de los handlers públicos del módulo.
 */
export async function getPublicRoomTypes(
  deps: PublicRoomTypesDeps,
  slug: string,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  // Anti-enumeración: mismo 404 para "no existe" y "no activo" que `/rates`/`/calendar`.
  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel || hotel.onlineBookingStatus !== 'active') {
    return { status: 404, body: { error: 'Hotel not found' } }
  }
  const bookingConfig = deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (bookingConfig && bookingConfig.enabled === false) {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  const rooms = await deps.rooms.findMany({ hotelId: hotel.id })
  const photoByType = await resolvePhotoByType(deps, hotel.id)

  // Agrupa TODAS las habitaciones del hotel por tipo, sin filtrar por estado ni por reservas:
  // el catálogo describe la OFERTA del hotel, no lo que está libre hoy. Una unidad `maintenance`
  // o reservada igual cuenta para "este tipo existe y se vende" — es exactamente lo que `/rates`
  // NO puede afirmar por diseño (necesita un rango de fechas para responder).
  const grouped = new Map<string, { capacity: number; surfaceArea: number; basePrice: number }>()
  for (const room of rooms as any[]) {
    const type = room.type || 'standard'
    const bucket = grouped.get(type) ?? { capacity: 0, surfaceArea: 0, basePrice: 0 }
    bucket.capacity = Math.max(bucket.capacity, Number(room.capacity) || 0)
    bucket.surfaceArea = Math.max(bucket.surfaceArea, Number(room.surfaceArea) || 0)
    const price = Number(room.basePrice ?? room.price ?? 0)
    if (price > 0 && (bucket.basePrice === 0 || price < bucket.basePrice)) bucket.basePrice = price
    grouped.set(type, bucket)
  }

  const roomTypes: PublicRoomTypeCatalogEntry[] = Array.from(grouped.entries()).map(([type, d]) => ({
    id: type,
    name: type,
    capacity: d.capacity,
    surfaceArea: d.surfaceArea,
    basePrice: d.basePrice,
    photoUrl: photoByType.get(type) ?? null,
  }))

  return { status: 200, body: { roomTypes } }
}
