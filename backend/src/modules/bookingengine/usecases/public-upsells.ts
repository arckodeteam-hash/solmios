// bookingengine/usecases/public-upsells.ts — GET /api/public/hotels/:slug/upsells (F2 2.6).
//
// Lista upsells activos del hotel (sub-dominio de bookingengine, F2 2.3). Público, sin auth,
// rate-limited. El widget lo consume en el step de upsells (desayuno, transfer, late checkout).
//
// Filtrado opcional por `?kind=` ('per_room' | 'per_person' | 'per_stay' | 'per_night' |
// 'per_person_per_night' — los dos últimos desde MR-10 #275). Sin el param, devuelve todos los
// activos. Orden: `sortOrder` ASC, desempate por `createdAt` ASC (mismo criterio que
// `upsells-crud.list` del admin, así widget y panel ven el mismo orden).
//
// Anti-enumeración: mismo 404 para "no existe" y "no activo" (igual que public-hotel-info y
// public-rates).
//
// Importante: NO se filtra por `kind` inválido — si el cliente manda ?kind=foo, se devuelve []
// (no es error del servidor, simplemente no hay upsells de ese tipo). El widget sabe los kinds
// válidos; mandar otro es un bug del frontend, no un 400 para el usuario final.
import type { RepositoryAdapter } from 'arckode-framework'
import type { UpsellDTO } from '../types'
import { isEngineOpen, engineClosed } from '../../../shared/usecases/booking-engine-gate'

export interface PublicUpsellsDeps {
  hotels: RepositoryAdapter<any>
  upsells: RepositoryAdapter<UpsellDTO>
  /** #276 (MR-11) — toggle Activo/Inactivo del hotel (`booking_config.enabled`). Opcional (compat). */
  bookingConfig?: RepositoryAdapter<any>
}

/**
 * @param slug   Slug del hotel (URL param).
 * @param kind   Filtro opcional por kind (cualquier valor de `UpsellKind`, ver types.ts).
 */
export async function getPublicUpsells(
  deps: PublicUpsellsDeps,
  slug: string,
  kind?: string,
): Promise<{ status: number; body: any }> {
  if (!slug) return { status: 404, body: { error: 'Hotel not found' } }

  // #276 (MR-11) — un solo interruptor del motor público (`shared/usecases/booking-engine-gate.ts`):
  // `hotels.onlineBookingStatus` (plataforma) + `booking_config.enabled` (hotel), mismo 404.
  const hotel = await deps.hotels.findOne({ slug })
  const bookingConfig = hotel && deps.bookingConfig ? await deps.bookingConfig.findOne({ hotelId: hotel.id }) : null
  if (!isEngineOpen(hotel, bookingConfig)) return engineClosed()

  const all = await deps.upsells.findMany({ hotelId: hotel.id })
  // `active` ORM-booleano (true/false). Defensivo: si llega 0/1 por una row legacy, Boolean()
  // lo castea. kind filter: si se pasa kind, solo los que matchean exactamente.
  const items = all
    .filter((u) => Boolean((u as any).active) === true)
    .filter((u) => !kind || u.kind === kind)
    .sort((a, b) => {
      const sa = Number(a.sortOrder ?? 0)
      const sb = Number(b.sortOrder ?? 0)
      if (sa !== sb) return sa - sb
      return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
    })
    .map((u) => ({
      id: u.id,
      name: u.name,
      description: u.description ?? null,
      price: u.price,
      kind: u.kind,
      // sortOrder se incluye para que el frontend pueda debuggear el orden; no es sensible.
      sortOrder: Number(u.sortOrder ?? 0),
    }))

  return { status: 200, body: items }
}
