import type { RoomAmenityItemInput } from './usecases/room-amenity-items'
export type { RoomAmenityItemInput }

export interface AmenityCatalogDTO {
  key: string
  label: string
  category: string
  icon?: string
}

export interface HotelAmenityDTO {
  id: string
  hotelId: string
  amenityKey: string
  amenityCategory?: string
  isActive?: number
}

export interface RoomAmenityDTO {
  id: string
  roomId: string
  /** Fija del catálogo ('wifi') o personalizada `custom:<slug>` (#290). */
  amenityKey: string
  isShared?: number
  /** Sólo personalizadas: nombre visible y precio >= 0 (0 = gratis). */
  name?: string
  price?: number
  isActive?: number
}

export interface UpdateHotelAmenitiesDTO {
  amenities: string[]
}

export interface UpdateRoomAmenitiesDTO {
  /** Keys fijas del catálogo. */
  amenities: string[]
  /** Personalizadas por habitación (#290). Si no viene, las custom existentes quedan como están. */
  items?: RoomAmenityItemInput[]
}
