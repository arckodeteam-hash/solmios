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
  /** Cuenta de Channex contra la que corre el hotel: hasta la certificación, `staging` (prueba). */
  environment: 'staging' | 'production'
  /** Tipos y tarifas publicados, según el mapeo guardado del último sync. */
  publishedRoomTypes: number
  publishedRatePlans: number
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

/**
 * Los 6 estados del caso, en el mismo orden que el backend
 * (`canales/usecases/channel-requests.ts`). Espejo a propósito: el hotel ve el mismo ciclo de vida
 * que el admin, con otras palabras. Un estado sin etiqueta acá dejaba la tarjeta de la OTA en
 * blanco — por eso hay un test que los recorre todos.
 */
export const CHANNEL_REQUEST_STATUSES = [
  'pending', 'scheduled', 'in_progress', 'waiting_hotel', 'connected', 'rejected',
] as const
export type ChannelRequestStatus = (typeof CHANNEL_REQUEST_STATUSES)[number]

/** Medio por el que la plataforma va a contactar al hotel. */
export const CHANNEL_REQUEST_MEDIUM_LABELS: Record<string, string> = {
  call: 'Llamada',
  whatsapp: 'WhatsApp',
  video: 'Videollamada',
}

/** Estado de una solicitud de conexión de OTA, tal como lo ve el hotel (sin notas internas). */
export interface ChannelRequest {
  id: string
  channel: string
  channelName?: string | null
  status: ChannelRequestStatus
  message?: string | null
  contactPhone?: string | null
  /** Cuándo lo van a contactar (ISO). El hotel lo ve en la tarjeta de la OTA. */
  appointmentAt?: string | null
  appointmentMedium?: string | null
  /** Por qué se rechazó, cuando corresponde. */
  resolutionReason?: string | null
  createdAt?: string
}

export const CHANNEL_REQUEST_LABELS: Record<ChannelRequestStatus, string> = {
  pending: 'Solicitada',
  scheduled: 'Cita agendada',
  in_progress: 'En configuración',
  waiting_hotel: 'Esperando tu respuesta',
  connected: 'Conectada',
  rejected: 'Rechazada',
}

/**
 * Clases del badge por estado. Viven en el service y no en la vista para que el test las pueda
 * recorrer junto con las etiquetas: cuando se agregaron `scheduled` y `waiting_hotel`, un
 * `REQUEST_CLASSES` incompleto dejaba la tarjeta sin color y sin borde.
 */
export const CHANNEL_REQUEST_CLASSES: Record<ChannelRequestStatus, string> = {
  pending: 'bg-amber/10 text-amber border-2 border-amber/30',
  scheduled: 'bg-cyan/10 text-cyan border-2 border-cyan/30',
  in_progress: 'bg-navy/5 text-navy border-2 border-navy/20',
  waiting_hotel: 'bg-gold/10 text-gold border-2 border-gold/30',
  connected: 'bg-teal/10 text-teal border-2 border-teal/30',
  rejected: 'bg-coral/10 text-coral border-2 border-coral/30',
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

  /**
   * Pausa o reanuda el envío de precios y disponibilidad al channel manager.
   *
   * No borra la propiedad ni los canales del lado de Channex: apaga la marca `syncEnabled` de la
   * configuración del hotel, que es lo que el backend mira antes de publicar. Volver a
   * sincronizar a mano también la reactiva.
   */
  /**
   * Conecta SolmiOS como canal (Open Channel) sin copiar credenciales: el servidor ya conoce el
   * endpoint, la api key y el hotel code, y arma el mapeo desde el último sync.
   */
  async connectOpenChannel(): Promise<{ success: boolean; message: string; channelId?: string }> {
    return http.post('/channels/open-channel/connect', {})
  },

  /**
   * Lo mismo, pero apuntando a OTRO hotel: lo usa el super-admin desde la bandeja de solicitudes.
   * El endpoint es admin-only y `resolveTenant` deja targetear otro hotel solo a `super_admin`.
   */
  async connectOpenChannelFor(hotelId: string): Promise<{ success: boolean; message: string; channelId?: string }> {
    return http.post(`/channels/open-channel/connect?hotelId=${encodeURIComponent(hotelId)}`, {})
  },

  async setSyncEnabled(hotelId: string | undefined, enabled: boolean): Promise<void> {
    const list = await http.get<{ data?: Array<{ id?: string }> } | Array<{ id?: string }>>(`/canales${hotelId ? `?hotelId=${hotelId}` : ''}`)
    const rows = Array.isArray(list) ? list : (list?.data ?? [])
    const id = rows[0]?.id
    if (!id) throw new Error('El hotel no tiene configuración de canales')
    await http.put(`/canales/${id}`, { syncEnabled: enabled ? 1 : 0 })
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

  async bookings(hotelId?: string): Promise<{ data: unknown[]; total: number }> {
    const query = hotelId ? `?hotelId=${hotelId}` : ''
    return http.get(`/channels/bookings${query}`)
  },

  async ingestBookings(hotelId?: string): Promise<{ message?: string }> {
    return http.post('/channels/bookings/ingest', hotelId ? { hotelId } : {})
  },

  async iframeToken(hotelId?: string, username?: string): Promise<{ token: string; iframeUrl: string }> {
    const q = new URLSearchParams()
    if (hotelId) q.set('hotelId', hotelId)
    if (username) q.set('username', username)
    return http.get(`/channels/iframe-token?${q.toString()}`)
  },

  async detail(channelId: string): Promise<unknown> {
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

  async syncLog(hotelId?: string): Promise<{ data?: unknown[] } | unknown[]> {
    return http.get(`/channels/sync-log${hotelId ? `?hotelId=${hotelId}` : ''}`)
  },

  /**
   * Credenciales del canal propio (endpoint del backend + clave del hotel + hotel code).
   *
   * Ya NO son un paso del alta: el canal se conecta de un click. Quedan como diagnóstico, para
   * ver qué se le configuró a Channex cuando algo no conecta.
   */
  async openChannelCredentials(): Promise<OpenChannelCredentials> {
    return http.get('/channels/open-channel-key')
  },

  /**
   * Pide la conexión de una OTA. Conectar Booking o Airbnb necesita contrato y credenciales que
   * gestiona la plataforma: el hotel lo pide, y lo atiende el admin. Antes este botón abría el
   * asistente embebido de Channex y nadie del lado nuestro se enteraba del pedido.
   */
  async requestChannel(
    channel: string, channelName: string, message?: string, contactPhone?: string,
  ): Promise<{ success: boolean; created: boolean; message: string; request: ChannelRequest }> {
    return http.post('/channels/requests', { channel, channelName, message, contactPhone })
  },

  /** Las solicitudes del hotel, para mostrar en qué anda cada una. */
  async listRequests(): Promise<ChannelRequest[]> {
    // El backend responde `{data,total}`, pero una respuesta comprimida puede llegar sin envolver
    // (deuda documentada en el CLAUDE.md): se aceptan las dos formas sin castear a `any`.
    const res = await http.get<{ data?: ChannelRequest[] } | ChannelRequest[]>('/channels/requests')
    if (Array.isArray(res)) return res
    return res?.data ?? []
  },
}
