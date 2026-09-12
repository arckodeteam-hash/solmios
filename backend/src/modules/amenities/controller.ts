import type { HttpRequest, Logger } from 'arckode-framework'
import type { AmenitiesService } from './service'
import { isCustomAmenityKey, normalizeRoomAmenityItems, type NormalizedItem } from './usecases/room-amenity-items'

export class AmenitiesController {
  constructor(
    private readonly service: AmenitiesService,
    private readonly logger: Logger,
  ) {}

  private async hotelOf(req: any): Promise<string | undefined> {
    const q = req?.query || {}
    // Seguridad (IDOR cross-tenant): el hotel sale del TOKEN, no de la query. Un usuario de hotel
    // NO puede apuntar a otro hotel pasando ?hotelId=. Solo super_admin (platform) puede cross-hotel.
    const userHotel = req?.user?.hotelId
    if (userHotel && userHotel !== 'platform') return userHotel as string
    if (req?.user?.role === 'super_admin' && q.hotelId) return q.hotelId as string
    if (req?.user?.id && req?.user?.role !== 'super_admin') {
      const hotelId = await this.service.hotelIdOfUser(req.user.id)
      if (hotelId) return hotelId
    }
    return undefined
  }

  async getCatalog() {
    return { status: 200, body: this.service.getStaticCatalog() }
  }

  async listHotel(req: HttpRequest) {
    const id = await this.hotelOf(req)
    return { status: 200, body: { data: id ? await this.service.listHotelAmenities(id) : [] } }
  }

  async updateHotel(req: HttpRequest) {
    const id = await this.hotelOf(req); if (!id) return { status: 400, body: { error: 'hotelId requerido' } }
    const { amenities } = req.body as any
    if (!Array.isArray(amenities)) return { status: 400, body: { error: 'amenities debe ser un array' } }
    return { status: 200, body: { success: true, count: await this.service.updateHotelAmenities(id, amenities) } }
  }

  // BUG FIX (IDOR cross-tenant): listRoom/updateRoom usaban req.params.roomId directo, sin verificar
  // que la habitación pertenezca al hotel del token. Un merchant con settings:edit podía pasar un
  // roomId ajeno y leer/escribir amenities de otro hotel. Ahora se valida ownership contra hotelOf().
  private async assertRoomInHotel(roomId: string, hotelId: string): Promise<boolean> {
    return this.service.roomBelongsToHotel(roomId, hotelId)
  }

  async listRoom(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    const ok = await this.assertRoomInHotel(req.params.roomId, hotelId)
    if (!ok) return { status: 404, body: { error: 'Habitación no encontrada' } }
    return { status: 200, body: { data: await this.service.listRoomAmenities(req.params.roomId) } }
  }

  async updateRoom(req: HttpRequest) {
    const hotelId = await this.hotelOf(req)
    if (!hotelId) return { status: 400, body: { error: 'hotelId requerido' } }
    const ok = await this.assertRoomInHotel(req.params.roomId, hotelId)
    if (!ok) return { status: 404, body: { error: 'Habitación no encontrada' } }
    const { amenities, items } = req.body as any
    if (!Array.isArray(amenities)) return { status: 400, body: { error: 'amenities debe ser un array' } }
    // Personalizadas (#290): sólo entran por `items` (con name/price/isActive); una key `custom:` en
    // `amenities` se ignora para que no se cree una fila sin nombre ni precio.
    const fixedKeys = amenities.filter((k: unknown) => !isCustomAmenityKey(k))
    let normalized: NormalizedItem[] | undefined
    if (items !== undefined) {
      const r = normalizeRoomAmenityItems(items)
      if ('error' in r) return { status: 400, body: { error: r.error } }
      normalized = r.items
    }
    return { status: 200, body: { success: true, count: await this.service.updateRoomAmenities(req.params.roomId, fixedKeys, normalized) } }
  }
}
