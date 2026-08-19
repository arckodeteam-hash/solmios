import { http } from './http'

export interface HotelData {
  id: string; name: string; country?: string; address?: string
  phone?: string; email?: string; timezone?: string; currency?: string
  checkIn?: string; checkOut?: string; plan?: string; status?: string
  ownerName?: string; ownerTaxId?: string; deviceEmail?: string
  accommodationType?: string; registrationNumber?: string
  website?: string; bookingEngineUrl?: string
  phone2?: string; warningPhone?: string; secondaryCurrency?: string
  youtubeUrl?: string; starRating?: string
  onlineBookingStatus?: string; motorVersion?: string
  latitude?: string; longitude?: string; province?: string
  municipality?: string; locality?: string; postalCode?: string
  cleaningType?: string; depositType?: string; depositFixed?: number
  advanceType?: string; advanceAmount?: number; releaseHours?: number
  defaultPaymentMethod?: string
  requestReviews?: boolean; publishReviewScore?: boolean; publishReviewComments?: boolean
  taxName?: string; taxRate?: number
  wifiNetwork?: string; wifiPassword?: string; descriptionJson?: string
  /** Identidad visual del hotel (`hotels.logo`). Lo sube Settings → "Logo del Hotel" y viaja
   *  en GET /settings junto al resto del registro. Estaba en el modelo y en el endpoint, pero
   *  no declarado acá: por eso las vistas no lo encontraban y caían a imágenes de stock. */
  logo?: string
  freeCancellation?: boolean; depositRequired?: boolean; depositPercent?: number
  weekendSurcharge?: number
}

export interface Season {
  id: string; hotelId: string; name: string; label: string
  startDate: string; endDate: string; color: string; sortOrder: number
  active?: number
}

export interface RoomRate {
  id?: string; hotelId?: string; roomType: string; occupancy: number
  season: string; price: number; basePrice: number; percentage: number; closed: number
  channel?: string; minStay?: number; maxStay?: number; _inherited?: boolean
}

export interface AmenityCatalog {
  interior: string[]; exterior: string[]; services: string[]
}

export const HotelService = {
  async settings(hotelId?: string) {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get<{ hotel: any; baseRates: { type: string; price: number }[] }>(`/settings${query}`)
  },

  async updateSettings(id: string, patch: Record<string, unknown>) {
    return http.put<any>('/settings/hotel', { id, ...patch })
  },

  /** Sube el logo (data URL base64 — el backend no acepta multipart) y devuelve el hotel con la URL guardada. */
  async uploadLogo(logo: string, fileName?: string): Promise<{ logo: string }> {
    return http.post('/settings/logo', { logo, fileName })
  },

  // Amenities
  async amenitiesCatalog(): Promise<AmenityCatalog> {
    return http.get<AmenityCatalog>('/amenities/catalog')
  },
  async amenitiesHotel(): Promise<{ data: { amenityKey: string; amenityCategory: string; isActive: boolean }[] }> {
    return http.get('/amenities/hotel')
  },
  async saveAmenitiesHotel(amenities: string[]) {
    return http.put('/amenities/hotel', { amenities })
  },
  async amenitiesRoom(roomId: string): Promise<{ data: { amenityKey: string }[] }> {
    return http.get(`/amenities/room/${roomId}`)
  },
  async saveAmenitiesRoom(roomId: string, amenities: string[]) {
    return http.put(`/amenities/room/${roomId}`, { amenities })
  },

  // Seasons
  async seasons(): Promise<{ data: Season[] }> {
    return http.get('/seasons')
  },
  async saveSeasons(seasons: Partial<Season>[]) {
    return http.put('/seasons', { seasons })
  },
  /** Cambia la temporada activa del hotel (una sola activa). #148 */
  async activateSeason(name: string): Promise<{ success: boolean; data: Season[] }> {
    return http.post('/seasons/activate', { name })
  },

  // Rates matrix. Con `channel` devuelve las tarifas de ese canal (override o base heredada).
  async rates(channel?: string): Promise<{ data: RoomRate[] }> {
    return http.get(`/rates${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`)
  },
  async saveRates(rates: Partial<RoomRate>[]) {
    return http.put('/rates', { rates })
  },
  async copyRatesNextYear(): Promise<{ success: boolean; copied: number; total: number }> {
    return http.post('/rates/copy-next-year')
  },

  // Modo de tarificación del hotel: 'per_room' (precio por habitación) | 'per_person' (por ocupación).
  async pricingMode(): Promise<{ mode: 'per_room' | 'per_person' }> {
    return http.get('/pricing-mode')
  },
  async setPricingMode(mode: 'per_room' | 'per_person'): Promise<{ mode: 'per_room' | 'per_person' }> {
    return http.put('/pricing-mode', { mode })
  },

  // Días Mínimos por fecha (fila del planning). Solo devuelve overrides (minStay > 1).
  async dateRestrictions(from?: string, to?: string): Promise<{ data: { date: string; minStay: number }[] }> {
    const qs = from && to ? `?from=${from}&to=${to}` : ''
    return http.get(`/date-restrictions${qs}`)
  },
  async saveDateRestrictions(items: { date: string; minStay: number }[]): Promise<{ success: boolean; count: number }> {
    return http.put('/date-restrictions', { items })
  },

  // Temporada por fecha (diálogo "Asignación de temporadas" del planning).
  async seasonAssignments(from?: string, to?: string): Promise<{ data: { date: string; season: string }[] }> {
    const qs = from && to ? `?from=${from}&to=${to}` : ''
    return http.get(`/season-assignments${qs}`)
  },
  /** Asigna (o borra, con season vacío) una temporada a un rango filtrado por día de la semana (0=Dom..6=Sáb). */
  async assignSeason(input: { from: string; to: string; weekdays?: number[]; season: string }): Promise<{ success: boolean; count: number }> {
    return http.post('/season-assignments', input)
  },

  // Blocks
  async blocks(startDate?: string, endDate?: string): Promise<{ data: any[] }> {
    const qs = startDate && endDate ? `?startDate=${startDate}&endDate=${endDate}` : ''
    return http.get(`/blocks${qs}`)
  },
  async createBlock(data: { roomIds: string[]; reason?: string; startDate: string; endDate: string }) {
    return http.post('/blocks', data)
  },
  async deleteBlock(id: string) {
    return http.delete(`/blocks/${id}`)
  },
}
