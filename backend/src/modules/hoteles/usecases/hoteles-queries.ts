import { NotFoundError, ValidationError } from 'arckode-framework'

function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

/**
 * #34 (SEC-2): "Cancelación gratuita" y la política "No Reembolsable" son mutuamente
 * excluyentes. La UI lo auto-resuelve al interactuar, pero eso NO es validación: un
 * cliente directo (curl, móvil, datos legacy) podía persistir ambas y el motor de
 * cancelación quedaba con dos reglas contradictorias. Se evalúa el estado EFECTIVO
 * (patch mergeado sobre el hotel actual) porque un PUT parcial puede activar el
 * conflicto con el valor que ya estaba en la DB.
 */
export function assertCancellationCompatible(freeCancellation: unknown, cancellationType: unknown): void {
  if (freeCancellation === true && cancellationType === 'non_refundable') {
    throw new ValidationError('Cancelación gratuita y política "No Reembolsable" son incompatibles: desactivá una de las dos')
  }
}

export class HotelesQueries {
  constructor(private readonly orm: any) {}

  async getSettings(hotelId: string, auth?: any, user?: any): Promise<any> {
    const hotel = await this.orm.findById('Hotels', hotelId)
    if (user && auth) auth.assertOwnership(hotel?.id ?? hotelId, user.hotelId, user.role, 'super_admin')
    const rooms = await this.orm.findMany('Rooms', { hotelId }) as any[]
    const seen = new Set<string>(); const baseRates: any[] = []
    for (const r of rooms) { if (!seen.has(r.type)) { seen.add(r.type); baseRates.push({ type: r.type, price: r.basePrice }) } }
    return { hotel, baseRates }
  }

  async updateHotel(id: string, body: Record<string, any>, auth?: any, user?: any): Promise<any> {
    const existing = await this.orm.findById('Hotels', id)
    if (!existing) throw new NotFoundError('Hotel no encontrado')
    if (user && auth) auth.assertOwnership(existing.id, user.hotelId, user.role, 'super_admin')
    const safePatch: Record<string, any> = {}
    const allowed = ['name', 'country', 'address', 'phone', 'email', 'timezone', 'currency', 'checkIn', 'checkOut', 'plan', 'cancellationType', 'freeCancellation', 'depositRequired', 'depositPercent', 'weekendSurcharge', 'ownerName', 'ownerTaxId', 'deviceEmail', 'accommodationType', 'registrationNumber', 'website', 'bookingEngineUrl', 'phone2', 'warningPhone', 'secondaryCurrency', 'youtubeUrl', 'starRating', 'onlineBookingStatus', 'motorVersion', 'latitude', 'longitude', 'province', 'municipality', 'locality', 'postalCode', 'cleaningType', 'depositType', 'depositFixed', 'advanceType', 'advanceAmount', 'releaseHours', 'defaultPaymentMethod', 'requestReviews', 'publishReviewScore', 'publishReviewComments', 'taxName', 'taxRate', 'descriptionJson', 'wifiNetwork', 'wifiPassword', 'logo', 'slug', 'amenities', 'descriptionTranslations']
    for (const k of allowed) { if (body[k] !== undefined) safePatch[k] = body[k] }
    // #34: exclusividad evaluada sobre el estado efectivo (patch + DB), no sólo el patch.
    assertCancellationCompatible(safePatch.freeCancellation ?? existing.freeCancellation, safePatch.cancellationType ?? existing.cancellationType)
    await this.orm.update('Hotels', id, safePatch)
    // @ignore IDOR_RISK — reload post-write, ownership ya validada arriba (mismo id)
    return await this.orm.findById('Hotels', id)
  }

  async getConfig(hotelId: string, key: string): Promise<any> {
    const row = (await this.orm.findMany('Configuration', { hotelId, key }))[0] as any
      || (await this.orm.findMany('Configuration', { hotelId: 'platform', key }))[0] as any
    return { valor: row ? safeParse(row.value) : null }
  }

  /**
   * Contactos de emergencia del hotel — lectura SOLO-LOGIN.
   * Reusa getConfig (incluye el fallback a hotelId:'platform'). El hotelId lo resuelve
   * el controller desde el token; acá nunca llega un valor elegido por el cliente.
   * Se expone aparte de /configuracion/:key para no exigir `settings:view`: housekeeper,
   * supervisor y maintenance necesitan los números ante un incidente, pero NO el resto
   * de la configuración del hotel.
   */
  async getEmergencyContacts(hotelId: string): Promise<any> {
    return this.getConfig(hotelId, 'contactos_emergencia')
  }

  async setConfig(body: { clave: string; valor: any; hotelId?: string }, user?: any): Promise<any> {
    const { clave, valor } = body
    if (!clave || valor === undefined) throw new Error('clave y valor requeridos')
    // Multi-tenant: el hotelId sale del token. Solo super_admin puede targetear otro
    // hotel (o 'platform') vía body.hotelId — un merchant queda forzado a su propio hotel.
    const isSuper = user?.role === 'super_admin'
    const hotelId = isSuper ? (body.hotelId || 'platform') : user?.hotelId
    if (!hotelId) throw new Error('hotelId no resuelto para el usuario')
    const existing = (await this.orm.findMany('Configuration', { hotelId, key: clave }))[0] as any
    const val = typeof valor === 'object' ? JSON.stringify(valor) : String(valor)
    if (existing) await this.orm.update('Configuration', existing.id, { value: val })
    else await this.orm.create('Configuration', { id: crypto.randomUUID(), hotelId: hotelId || 'platform', key: clave, value: val })
    return { success: true }
  }

  async resolveHotelId(user: any): Promise<string | undefined> {
    if (user?.hotelId && user?.hotelId !== 'platform') return user.hotelId
    if (user?.id && user?.role !== 'super_admin') {
      const rows = await this.orm.findMany('Users', { id: user.id })
      const u: any = rows?.[0]
      if (u?.hotelId) return u.hotelId
    }
    return ((await this.orm.findMany('Hotels', {}))[0] as any)?.id
  }
}
