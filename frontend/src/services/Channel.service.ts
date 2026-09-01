import { http } from './http'

export interface Channel {
  id?: string
  name: string
  type: string
  conectado: boolean
  activo?: boolean
  bookings?: number
  ultimaSync?: string
  otaCode?: string
  icono?: string
  color?: string
  descripcion?: string
}

export interface ChannelStatus {
  data: Channel[]
  connectedCount: number
  pendingBookings: number
  syncEnabled: boolean
  lastSync: string | null
  channexPropertyId: string | null
}

/**
 * Resultado del push de tarifas. Las listas nombran QUÉ bloqueó la publicación: sin esto el
 * usuario veía un 200 y la tarifa nunca llegaba a la OTA.
 */
export interface PushRatesResult {
  pushed: number
  skipped: number
  notConnected: boolean
  /** Temporadas sin fechas propias NI días asignados en el planning. */
  seasonsWithoutDates: string[]
  expiredSeasons: string[]
  roomTypesWithoutRatePlan: string[]
}

export interface TestConnectionResult {
  success: boolean
  message: string
  details?: unknown
}

export interface OpenChannelCredentials {
  apiKey: string
  hotelCode: string
  endpoint: string
}

export interface MappingDetail {
  id: number
  title: string
  rates?: MappingRate[]
  max_children?: number | null
}

export interface MappingRate {
  id: number
  title: string
  pricing: string
  max_persons: number
  occupancies: number[]
  readonly?: boolean
}

export interface MappingResult {
  success: boolean
  rooms: MappingDetail[]
  error?: string
}

export interface GroupItem {
  id: string
  name: string
}

export interface OTAConnectPayload {
  hotelId: string
  channel: string
  title: string
  groupId: string
  propertyId: string
  ratePlans: {
    ratePlanId: string
    roomTypeCode: number
    ratePlanCode: number
    occupancy: number
    pricingType: string
    primaryOcc?: boolean
  }[]
  settings?: Record<string, unknown>
}

export interface OTAConnectResult {
  success: boolean
  message: string
  channelId?: string
  steps?: { test: boolean; mapping: boolean; create: boolean; activate: boolean }
}

/** Una fila del mapeo: un rate plan NUESTRO contra el room/rate que expone el canal. */
export interface ChannelRatePlanMapping {
  /** UUID del rate plan de la property en Channex. */
  ratePlanId: string
  /** Código de la habitación DEL CANAL (lo devuelve mapping_details). */
  roomTypeCode: string | number
  /** Código de la tarifa DEL CANAL. */
  ratePlanCode: string | number
  occupancy?: number
  pricingType?: string
  primaryOcc?: boolean
}

export const ChannelService = {
  async status(hotelId?: string): Promise<ChannelStatus> {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get<ChannelStatus>(`/channels${query}`)
  },

  async sync(hotelId?: string): Promise<{ success: boolean; message: string; channexPropertyId?: string }> {
    return http.post('/channels/sync', hotelId ? { hotelId } : {})
  },

  // Etapa 2: empuja las tarifas por temporada (precio/cierre/estadía) a Channex.
  async pushRates(channel?: string): Promise<PushRatesResult> {
    return http.post('/channels/push-rates', channel ? { channel } : {})
  },

  async testConnection(hotelId: string, channel: string, otaHotelId: string): Promise<TestConnectionResult> {
    return http.post('/channels/test-connection', { hotelId, channel, hotel_id: otaHotelId })
  },

  async mappingDetails(hotelId: string, channel: string, otaHotelId: string): Promise<MappingResult> {
    return http.get(`/channels/mapping-details?hotelId=${hotelId}&channel=${channel}&hotel_id=${otaHotelId}`)
  },

  async groups(hotelId?: string): Promise<GroupItem[]> {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get(`/channels/groups${query}`)
  },

  async connect(payload: OTAConnectPayload): Promise<OTAConnectResult> {
    return http.post('/channels/connect', payload)
  },

  async deactivate(hotelId: string, channelId: string): Promise<{ success: boolean; message: string }> {
    return http.post(`/channels/${channelId}/deactivate`, { hotelId })
  },

  async bookings(hotelId?: string): Promise<{ data: any[]; total: number }> {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get(`/channels/bookings${query}`)
  },

  async ingestBookings(hotelId?: string): Promise<any> {
    return http.post('/channels/bookings/ingest', hotelId ? { hotelId } : {})
  },

  async iframeToken(hotelId?: string, username?: string): Promise<{ token: string; iframeUrl: string }> {
    const q = new URLSearchParams()
    if (hotelId) q.set('hotelId', hotelId)
    if (username) q.set('username', username)
    return http.get(`/channels/iframe-token?${q.toString()}`)
  },

  async detail(channelId: string): Promise<any> {
    return http.get(`/channels/${channelId}/detail`)
  },

  /**
   * Mapeo de rate plans de un canal YA CREADO. REEMPLAZA el mapeo completo: hay que mandar la
   * lista entera, no un delta — lo que no vaya en el array, Channex lo borra.
   */
  async updateMapping(channelId: string, ratePlans: ChannelRatePlanMapping[]): Promise<{ success: boolean; mapped: number; message: string }> {
    return http.put(`/channels/${channelId}/mapping`, { ratePlans })
  },

  /** Qué falta para poder activar el canal (lo que Channex reporta en check_readiness). */
  async readiness(channelId: string): Promise<{ ready: boolean; issues: string[] }> {
    return http.get(`/channels/${channelId}/readiness`)
  },

  /** Verifica y activa. Si no está listo, devuelve los motivos en `issues`. */
  async activate(channelId: string): Promise<{ success: boolean; message: string; issues: string[] }> {
    return http.post(`/channels/${channelId}/activate`, {})
  },

  async syncLog(hotelId?: string): Promise<any> {
    return http.get(`/channels/sync-log${hotelId ? `?hotelId=${hotelId}` : ''}`)
  },

  /**
   * Credenciales para conectar el canal "Open Channel" de Channex (self-service, sin depender de
   * ninguna OTA real): endpoint fijo del backend, la clave propia del hotel (se genera la primera
   * vez que se pide) y el "Hotel Code" a pegar en el asistente de Channex.
   */
  async openChannelCredentials(): Promise<OpenChannelCredentials> {
    return http.get('/channels/open-channel-key')
  },
}
