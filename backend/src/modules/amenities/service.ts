import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { hotelIdOfUserLegacy } from '../../shared/usecases/hotel-of-legacy'
import { composeSockets } from '../../shared/usecases/compose-sockets'
import type { AmenitiesSockets } from './sockets'
import { isCustomAmenityKey, planRoomAmenityUpsert, type NormalizedItem } from './usecases/room-amenity-items'

const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

export class AmenitiesService {
  private sockets: AmenitiesSockets = {}
  /** onRoomAmenitiesUpdated → sync CSV Rooms.amenities (connector amenities-habitaciones). */
  setSockets(s: Partial<AmenitiesSockets>): void { composeSockets(this.sockets as any, s as any) }

  constructor(
    private readonly hotelAmenitiesRepo: RepositoryAdapter<any>,
    private readonly roomAmenitiesRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    // Para el ownership check del controller (assertRoomInHotel) y el fallback de
    // hotelOf con tokens legacy sin hotelId. El controller ANTES llamaba a
    // `(this.service as any).orm`, que nunca existió: devolvía siempre `[]`,
    // así que listRoom/updateRoom daban 404 en el 100% de los casos, en
    // cualquier hotel. roomsRepo y usersRepo son reales.
    private readonly roomsRepo?: RepositoryAdapter<any>,
    private readonly usersRepo?: RepositoryAdapter<any>,
  ) {}

  /** ¿La habitación pertenece a este hotel? Usa findById, no findMany con id: ownership check real. */
  async roomBelongsToHotel(roomId: string, hotelId: string): Promise<boolean> {
    if (!roomId || !this.roomsRepo) return false
    const room = await this.roomsRepo.findById(roomId).catch(() => null)
    return !!room && (room as any).hotelId === hotelId
  }

  /** Ver shared/usecases/hotel-of-legacy.ts — fallback de hotelOf() con tokens legacy. */
  hotelIdOfUser(userId?: string): Promise<string | undefined> {
    return hotelIdOfUserLegacy(this.usersRepo, userId)
  }

  getStaticCatalog(): Record<string, string[]> {
    return {
      interior: ['ac', 'heating', 'kitchen', 'microwave', 'fridge', 'coffee_maker', 'washer', 'dishwasher', 'tv', 'wifi', 'safe', 'minibar', 'hair_dryer', 'iron', 'balcony', 'bathtub', 'work_desk'],
      exterior: ['pool', 'pool_heated', 'parking_free', 'parking_paid', 'gym', 'spa', 'restaurant', 'bar', 'garden', 'terrace', 'bbq', 'elevator', 'lounge', 'kids_playground'],
      services: ['room_service', 'laundry', 'concierge', 'luggage_storage', 'pets_allowed', 'wheelchair_access'],
    }
  }

  async listHotelAmenities(hotelId: string): Promise<any[]> {
    return await this.hotelAmenitiesRepo.findMany({ hotelId, isActive: 1 }) as any[]
  }

  async updateHotelAmenities(hotelId: string, amenities: string[]): Promise<number> {
    const existing = await this.hotelAmenitiesRepo.findMany({ hotelId }) as any[]
    for (const ex of existing) { if (!amenities.includes(ex.amenityKey)) await this.hotelAmenitiesRepo.update(ex.id, { isActive: 0 }) }
    for (const key of amenities) {
      const found = existing.find((e: any) => e.amenityKey === key)
      if (found) { await this.hotelAmenitiesRepo.update(found.id, { isActive: 1 }) } else {
        const cat = key.includes('pool') || key.includes('parking') || key.includes('gym') || key.includes('spa') || key.includes('restaurant') || key.includes('bar') || key.includes('garden') || key.includes('terrace') || key.includes('bbq') || key.includes('kids') ? 'exterior' : key.includes('service') || key.includes('laundry') || key.includes('concierge') || key.includes('pets') || key.includes('wheelchair') ? 'services' : 'interior'
        await this.hotelAmenitiesRepo.create({ id: crypto.randomUUID(), hotelId, amenityKey: key, amenityCategory: cat, isActive: 1 })
      }
    }
    return amenities.length
  }

  /**
   * Fijas activas + TODAS las personalizadas (activas e inactivas): el form de habitación muestra
   * el estado de cada custom (#290). isActive puede venir como 0/1 o true/false según el adapter.
   */
  async listRoomAmenities(roomId: string): Promise<any[]> {
    const rows = await this.roomAmenitiesRepo.findMany({ roomId }) as any[]
    return rows.filter((r) => isCustomAmenityKey(r.amenityKey) || isOn(r.isActive))
  }

  /**
   * `amenities` = keys fijas del catálogo (gratuitas); `items` = personalizadas con name/price/isActive.
   * Ver planRoomAmenityUpsert para la semántica. Compat: llamar sólo con `amenities` (items undefined)
   * sigue igual para las fijas y no toca las custom. Devuelve la cantidad de keys activas (fijas + custom).
   */
  async updateRoomAmenities(roomId: string, amenities: string[], items?: NormalizedItem[]): Promise<number> {
    const existing = await this.roomAmenitiesRepo.findMany({ roomId }) as any[]
    const plan = planRoomAmenityUpsert(existing, amenities, items)
    for (const id of plan.deactivate) await this.roomAmenitiesRepo.update(id, { isActive: 0 })
    for (const id of plan.reactivate) await this.roomAmenitiesRepo.update(id, { isActive: 1 })
    for (const u of plan.update) await this.roomAmenitiesRepo.update(u.id, { ...u.patch, isActive: u.patch.isActive ? 1 : 0 })
    for (const c of plan.create) {
      await this.roomAmenitiesRepo.create({ id: crypto.randomUUID(), roomId, amenityKey: c.amenityKey, name: c.name, price: c.price, isShared: 0, isActive: c.isActive ? 1 : 0 })
    }
    // Mantiene en sync el CSV vestigial Rooms.amenities (connector amenities-habitaciones).
    await this.sockets.onRoomAmenitiesUpdated?.(roomId, plan.activeKeys)
    return plan.activeKeys.length
  }
}
