// canales/types.ts — DTOs y tipos de queries
// Contrato TypeScript del módulo (cómo se ven los datos).
// El schema de DB vive en ./model.ts — son conceptos distintos.

// Configuración del channel manager por hotel (tabla canales_config).
export interface CanalesDTO {
  id: string
  hotelId: string
  channexPropertyId?: string | null
  channexApiKey?: string | null
  channexGroupId?: string | null
  syncEnabled?: number
    lastSync?: string | null
  config?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateCanalesDTO {
  hotelId: string
  channexPropertyId?: string
  syncEnabled?: number
}

export interface UpdateCanalesDTO {
  channexPropertyId?: string
  syncEnabled?: number
    lastSync?: string
}
// ─── Entidades Channex ─────────────────────────────────
export interface ChannelDTO {
  id?: string
    name: string
    type: string
  conectado: boolean
    active?: boolean
  bookings?: number
    lastSync?: string | null
  otaCode?: string
    icon?: string
  color?: string
    description?: string
}

export interface OTAChannelMeta {
  id: string
    name: string
  channexCode: string
  aliases?: string[]
    icon: string
  color: string
    description: string
    type: string
}

export interface ChannelsResultDTO {
  data: ChannelDTO[]
  connectedCount: number
  pendingBookings: number
  syncEnabled: boolean
    lastSync: string | null
  channexPropertyId: string | null
  /**
   * Con qué cuenta de Channex está hablando el hotel. El panel lo muestra porque hasta la
   * certificación TODO corre contra el entorno de prueba: un hotelero que ve precios publicados
   * tiene que saber que todavía no llegan a las OTAs de verdad.
   */
  environment: 'staging' | 'production'
  /** Tipos y tarifas efectivamente publicados, contados del mapping local (sin pegarle a Channex). */
  publishedRoomTypes: number
  publishedRatePlans: number
}

// Resumen de tipo de habitación (para sincronización ARI).
export interface RoomTypeSummary {
    type: string
    basePrice: number
    capacity: number
  cnt: number
}

export interface SyncResultDTO {
  success: boolean
  message: string
  channexPropertyId: string
  roomTypes: number
  ratePlans: number
}

/** Rango de fechas inclusivo (YYYY-MM-DD), tal como Channex espera date_from/date_to. */
export interface DateRange {
  startDate: string
  endDate: string
}

/**
 * Resultado del push de tarifas por temporada. `skipped` sin desglose era mudo: el hotel
 * cargaba un precio, el push respondía 200 y la tarifa nunca llegaba a la OTA. Las listas
 * nombran QUÉ hay que ir a arreglar (temporada sin fechas, temporada vencida, room type
 * sin rate plan) para que el aviso sea accionable y no un contador anónimo.
 */
export interface PushRatesResultDTO {
  pushed: number
  skipped: number
  /** El hotel todavía no tiene propiedad sincronizada en Channex: no hay dónde empujar. */
  notConnected: boolean
  /**
   * Temporadas impublicables: sin fechas propias Y sin días asignados en el planning.
   * Una temporada sin fechas pero pintada en el planning NO entra acá — se publica con esos rangos.
   */
  seasonsWithoutDates: string[]
  /** Temporadas cuyo rango ya terminó — no se empujan fechas pasadas. */
  expiredSeasons: string[]
  /** Tipos de habitación sin rate plan en Channex (falta sincronizar la propiedad). */
  roomTypesWithoutRatePlan: string[]
  /**
   * Ids de las tareas que Channex encoló para este push (`data[].id` de la respuesta).
   * Es el único identificador con el que se rastrea un ARI update del lado de Channex —
   * soporte lo pide y la certificación PMS lo exige por test. Vacío si no se empujó nada.
   */
  taskIds?: string[]
}

// ─── Channel API (conexión OTA) ────────────────────────
export interface TestConnectionDTO {
  channel: string
  hotel_id: string
}

export interface TestConnectionResultDTO {
  success: boolean
  message: string
  details?: unknown
}

export interface MappingDetailDTO {
  id: number
  title: string
  rates?: MappingRateDTO[]
  max_children?: number | null
}

export interface MappingRateDTO {
  id: number
  title: string
  pricing: string
  max_persons: number
  occupancies: number[]
  readonly?: boolean
}

export interface OTAChannelCreateDTO {
  channel: string
  title: string
  groupId: string
  propertyId: string
  ratePlans: OTAChannelMappingDTO[]
  settings?: Record<string, unknown>
}

export interface OTAChannelMappingDTO {
  ratePlanId: string
  roomTypeCode: number
  ratePlanCode: number
  occupancy: number
  pricingType: string
  primaryOcc?: boolean
}

export interface OTAChannelResultDTO {
  success: boolean
  message: string
  channelId?: string
  steps?: { test: boolean; mapping: boolean; create: boolean; activate: boolean }
}

export interface GroupDTO {
  id: string
  name: string
  properties?: string[]
}

// ─── Bookings ──────────────────────────────────────
export interface BookingRevisionDTO {
  id: string
  propertyId: string
  bookingId: string
  uniqueId: string
  otaReservationCode: string
  otaName: string
  status: 'new' | 'modified' | 'cancelled'
  arrivalDate: string
  departureDate: string
  amount: string
  currency: string
  customer: { name?: string; surname?: string; mail?: string; phone?: string }
  rooms: BookingRoomDTO[]
  insertedAt: string
}

export interface BookingRoomDTO {
  roomTypeId: string | null
  ratePlanId: string | null
  checkinDate: string
  checkoutDate: string
  amount: string
  occupancy: { adults: number; children: number; infants: number }
}

export interface BookingIngestionResult {
  success: boolean
  message: string
  ingested: number
  acknowledged: number
  errors: string[]
}

// ─── Consultas y paginación ────────────────────────────
export interface CanalesQuery {
  hotelId?: string
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
}

export interface CanalesPaginated {
  data: CanalesDTO[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface CurrentUser {
  id: string
  hotelId?: string | null
  role?: string
}
