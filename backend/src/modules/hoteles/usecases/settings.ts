import { NotFoundError } from 'arckode-framework'

function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

export async function getSettings(orm: any, hotelId: string, auth?: any, user?: any): Promise<any> {
  const hotel = await orm.findById('Hotels', hotelId)
  if (user && auth) auth.assertOwnership(hotel, user)
  const rooms = await orm.findMany('Rooms', { hotelId }) as any[]
  const seen = new Set<string>(); const baseRates: any[] = []
  for (const r of rooms) { if (!seen.has(r.type)) { seen.add(r.type); baseRates.push({ type: r.type, price: r.basePrice }) } }
  return { hotel, baseRates }
}

export async function updateHotelSettings(orm: any, id: string, body: Record<string, any>, auth?: any, user?: any): Promise<any> {
  const existing = await orm.findById('Hotels', id)
  if (!existing) throw new NotFoundError('Hotel no encontrado')
  if (user && auth) auth.assertOwnership(existing, user)
  const safePatch: Record<string, any> = {}
  const allowed = ['name', 'country', 'address', 'phone', 'email', 'timezone', 'currency', 'checkIn', 'checkOut', 'plan', 'cancellationType', 'freeCancellation', 'depositRequired', 'depositPercent', 'weekendSurcharge', 'ownerName', 'ownerTaxId', 'deviceEmail', 'accommodationType', 'registrationNumber', 'website', 'bookingEngineUrl', 'phone2', 'whatsapp', 'warningPhone', 'secondaryCurrency', 'youtubeUrl', 'starRating', 'onlineBookingStatus', 'motorVersion', 'latitude', 'longitude', 'province', 'municipality', 'locality', 'postalCode', 'cleaningType', 'depositType', 'depositFixed', 'advanceType', 'advanceAmount', 'releaseHours', 'defaultPaymentMethod', 'requestReviews', 'publishReviewScore', 'publishReviewComments', 'taxName', 'taxRate', 'descriptionJson', 'wifiNetwork', 'wifiPassword', 'logo']
  for (const k of allowed) { if (body[k] !== undefined) safePatch[k] = body[k] }
  await orm.update('Hotels', id, safePatch)
  return await orm.findById('Hotels', id)
}
