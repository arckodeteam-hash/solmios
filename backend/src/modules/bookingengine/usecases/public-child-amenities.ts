// bookingengine/usecases/public-child-amenities.ts — GET /api/public/hotels/:slug/child-amenities
// (REQ-01, #233).
//
// Lista las amenidades para niños/bebés ACTIVAS del hotel (sub-dominio de bookingengine).
// Público, sin auth, rate-limited. El motor público lo consume como checklist por habitación
// (cada línea se suma al total de la reserva — ver public-booking.ts / public-booking-group.ts).
//
// Orden: `sortOrder` ASC, desempate por `name` (mismo criterio que `child-amenities-crud.list`
// del admin, así widget y panel ven el mismo orden).
//
// Anti-enumeración: mismo 404 para "no existe" y "no activo" (igual que public-upsells.ts).
import type { RepositoryAdapter } from 'arckode-framework'
import type { ChildAmenityDTO, PublicChildAmenity } from '../types'

export interface PublicChildAmenitiesDeps {
  hotels: RepositoryAdapter<any>
  childAmenities: RepositoryAdapter<ChildAmenityDTO>
}

export async function getPublicChildAmenities(
  deps: PublicChildAmenitiesDeps,
  slug: string,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  const hotel = await deps.hotels.findOne({ slug })
  if (!hotel || hotel.onlineBookingStatus !== 'active') {
    return { status: 404, body: { error: 'Hotel not found' } }
  }

  const all = await deps.childAmenities.findMany({ hotelId: hotel.id })
  // `active` ORM-booleano (true/false). Defensivo: si llega 0/1 por una row legacy, Boolean()
  // lo castea. Allow-list estricta en el map: sin hotelId ni timestamps.
  const items: PublicChildAmenity[] = all
    .filter((a) => Boolean((a as any).active) === true)
    .sort((a, b) => {
      const sa = Number(a.sortOrder ?? 0)
      const sb = Number(b.sortOrder ?? 0)
      if (sa !== sb) return sa - sb
      return String(a.name ?? '').localeCompare(String(b.name ?? ''))
    })
    .map((a) => ({
      id: a.id,
      name: a.name,
      price: Number(a.price ?? 0),
      sortOrder: Number(a.sortOrder ?? 0),
    }))

  return { status: 200, body: items }
}
