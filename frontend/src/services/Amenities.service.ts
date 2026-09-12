import { http } from './http'

export interface AmenityCatalog {
  interior: string[]
  exterior: string[]
  services: string[]
}

export interface AmenityCatalogItem {
  id: string
  key: string
  label: string
  category: string
  icon?: string
}

/** Amenidad personalizada de una habitación (#290): fila RoomAmenities `custom:<slug>` con nombre,
 *  precio (0 = gratis) y estado. `key` va vacía en las filas nuevas: el backend la deriva del nombre. */
export interface RoomAmenityItem {
  key?: string
  name: string
  price: number
  isActive: boolean
}

/** Fila de GET /amenities/room/:roomId: las fijas traen solo `amenityKey`; las custom, name/price.
 *  `isActive` puede venir como 0/1 (SQLite) o boolean. */
export interface RoomAmenityRow {
  amenityKey: string
  name?: string
  price?: number
  isActive?: number | boolean
}

export const AmenitiesService = {
  catalog: () => http.get<AmenityCatalog>('/amenities/catalog'),
  listHotel: () => http.get<{ data: { amenityKey: string; amenityCategory: string }[] }>('/amenities/hotel'),
  listHotelKeys: async () => (await AmenitiesService.listHotel()).data.map(a => a.amenityKey),
  saveHotel: (amenities: string[]) => http.put<{ success: boolean; count: number }>('/amenities/hotel', { amenities }),
  listRoom: (roomId: string) => http.get<{ data: RoomAmenityRow[] }>(`/amenities/room/${roomId}`),
  // `items` solo viaja si se pasa: el batch (creación masiva) sigue mandando únicamente las keys fijas.
  saveRoom: (roomId: string, amenities: string[], items?: RoomAmenityItem[]) =>
    http.put<{ success: boolean; count: number }>(`/amenities/room/${roomId}`, { amenities, ...(items ? { items } : {}) }),
  // Catálogo maestro — super-admin CRUD (/admin/amenities/catalog)
  adminListCatalog: () => http.get<{ data: AmenityCatalogItem[] }>('/admin/amenities/catalog'),
  adminCreateCatalogItem: (item: Partial<AmenityCatalogItem>) => http.post<{ success: boolean }>('/admin/amenities/catalog', item),
  adminUpdateCatalogItem: (id: string, item: Partial<AmenityCatalogItem>) => http.put<{ success: boolean }>(`/admin/amenities/catalog/${id}`, item),
  adminDeleteCatalogItem: (id: string) => http.delete<{ success: boolean }>(`/admin/amenities/catalog/${id}`),
}
