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

/**
 * #95 ("Cobro % niños"): con la regla prendida, `childrenRatePercent` es lo que paga cada niño
 * que consume plaza en el motor público. El form de settings/index.vue ya bloquea el guardado
 * fuera de 1-100, pero eso no es validación: un cliente directo (curl, datos legacy) podía
 * persistir cualquier % y el motor cobraba de más o de menos. Con la regla APAGADA el % NO se
 * valida — queda inerte (el motor lo ignora) y los forms guardan un % a medias sin bloquearse;
 * ese flujo no se rompe. El clamp al LEER (rate-resolution.ts) queda como defensa en
 * profundidad para datos ya guardados. `valor` llega como objeto desde el frontend, pero un
 * cliente crudo puede mandar string JSON: `safeParse` cubre ambos.
 */
function assertChildPolicyRate(clave: string, valor: any): void {
  if (clave !== 'child_policy') return
  const policy = safeParse(valor) as any
  if (!policy?.childrenDiscountEnabled) return
  const pct = policy.childrenRatePercent
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 1 || pct > 100) {
    throw new ValidationError('El porcentaje de tarifa para niños debe estar entre 1% y 100%')
  }
}

/** Campos derivados de una dirección concreta — dejan de tener sentido cuando el país cambia
 *  (un pin/provincia de OTRO país queda mezclado con el nuevo). `latitude`/`longitude` usan `0`
 *  como "sin coordenadas propias" (mismo criterio que ya usa el default del modelo y
 *  `useHotelLocationMap.ts` en el frontend: `Number(latitude) || defaultCenter` cae al centro
 *  del país cuando vale 0), el resto usa string vacío. */
const LOCATION_FIELDS_ON_COUNTRY_CHANGE: Record<string, string | number> = {
  address: '', latitude: 0, longitude: 0, province: '', municipality: '', locality: '', postalCode: '',
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
    const allowed = ['name', 'country', 'address', 'phone', 'email', 'timezone', 'currency', 'checkIn', 'checkOut', 'plan', 'cancellationType', 'freeCancellation', 'depositRequired', 'depositPercent', 'weekendSurcharge', 'ownerName', 'ownerTaxId', 'deviceEmail', 'accommodationType', 'registrationNumber', 'website', 'bookingEngineUrl', 'phone2', 'whatsapp', 'warningPhone', 'secondaryCurrency', 'youtubeUrl', 'starRating', 'onlineBookingStatus', 'motorVersion', 'latitude', 'longitude', 'province', 'municipality', 'locality', 'postalCode', 'cleaningType', 'depositType', 'depositFixed', 'advanceType', 'advanceAmount', 'releaseHours', 'defaultPaymentMethod', 'requestReviews', 'publishReviewScore', 'publishReviewComments', 'taxName', 'taxRate', 'descriptionJson', 'wifiNetwork', 'wifiPassword', 'logo', 'slug', 'amenities', 'descriptionTranslations']
    for (const k of allowed) { if (body[k] !== undefined) safePatch[k] = body[k] }
    // Cambiar de país invalida la dirección/pin/provincia vieja — reportado como "cambié el país
    // en el paso 1 del wizard y el mapa de Ubicación sigue mostrando lo que guardé al principio,
    // en el registro". `useHotelLocationMap.ts` ya limpia esto en el frontend, pero SOLO cuando
    // país y mapa viven en la misma pantalla montada (`settings/index.vue`) — país se edita en
    // Bienvenida/Configuración→Hotel y la dirección en Ubicación/Página pública, pantallas
    // separadas que no comparten esa instancia de Vue, así que ese watch nunca ve el cambio.
    // Acá, centralizado, se limpia siempre que el país efectivamente cambia — salvo que el mismo
    // patch ya traiga también la dirección nueva (nadie lo hace hoy, pero no pisar si pasara).
    if (safePatch.country !== undefined && safePatch.country !== existing.country) {
      for (const [field, clearedValue] of Object.entries(LOCATION_FIELDS_ON_COUNTRY_CHANGE)) {
        if (safePatch[field] === undefined) safePatch[field] = clearedValue
      }
    }
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
    // #95: se valida ANTES del write — un rechazo después dejaría la fila a medio actualizar.
    assertChildPolicyRate(clave, valor)
    // Multi-tenant: el hotelId sale del token. Solo super_admin puede targetear otro
    // hotel (o 'platform') vía body.hotelId — un merchant queda forzado a su propio hotel.
    // #80: sin body.hotelId, un super_admin CON hotel escribe la fila de su hotel (mismo
    // criterio que resolveHotelId/getConfig). Antes caía a 'platform': el valor "desaparecía"
    // al recargar (getConfig lee primero la fila del hotel) y pisaba el default de todos.
    const isSuper = user?.role === 'super_admin'
    const tokenHotelId = user?.hotelId && user.hotelId !== 'platform' ? user.hotelId : undefined
    const hotelId = isSuper ? (body.hotelId || tokenHotelId || 'platform') : user?.hotelId
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
