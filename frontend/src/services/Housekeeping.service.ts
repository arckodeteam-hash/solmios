import { http } from './http'

export interface PhotoEvidence {
  url: string
  path?: string
  name: string
  size: number
  mimeType: string
  uploadedAt: string
  /**
   * Área que la camarera fotografió (`bed`, `bathroom`, `x-balcon`…). La app la
   * manda según la foto que se le pidió; el nombre visible sale del catálogo de
   * `photoRequirements`, salvo las áreas del flujo (`start`, `after`, …).
   */
  areaId?: string
}

/** Área fotografiable configurada por el hotel. `areaId` es la clave que viaja en la foto. */
export interface PhotoRequirement {
  id: string
  areaId: string
  areaName: string
  icon?: string
  required?: boolean
  active?: boolean
  tipText?: string
  roomType?: string
}

/** Item del checklist de limpieza tal como lo dejó la camarera. */
export interface ChecklistItem {
  name: string
  done: boolean
}

/** Tamaño de página por defecto del listado. */
export const DEFAULT_PAGE_SIZE = 20

/** Tope que impone el backend (`MAX_LIMIT`): pedir más no trae más. */
export const MAX_PAGE_SIZE = 100

/** Respuesta paginada del listado: `total` es el del hotel, no el de la página. */
export interface HousekeepingPage {
  data: HousekeepingTask[]
  total: number
  page: number
  limit: number
  pages: number
}

/** Video de evidencia de fin (cuando el hotel usa el modo `video` en vez de las
 *  fotos por área). Un solo video por tarea. Los bytes viven en el bucket; acá
 *  solo guardamos su ruta. Para reproducirlo se pide una URL firmada temporal. */
export interface VideoEvidence {
  path?: string
  durationSeconds?: number
  uploadedAt?: string
  codec?: string | null
  width?: number | null
  height?: number | null
  /** `false` cuando el teléfono grabó en HEVC: el navegador no lo decodifica. */
  playableInBrowser?: boolean
  /** El servidor lo está convirtiendo a H.264 en este momento. */
  transcoding?: boolean
}

/** Respuesta de la URL firmada para VER el video. */
export interface VideoViewUrl {
  url: string
  durationSeconds?: number
  expiresInSeconds?: number
}

/**
 * Ítem de la tarea `arrival_setup` (#274): lo que hay que dejar listo antes de la
 * llegada. Mismo shape que el backend (housekeeping/types.ts); nace de la reserva.
 */
export type SetupItem =
  | { type: 'crib'; qty: number }
  | { type: 'amenity'; name: string; qty: number }
  | { type: 'regime'; name: string }
  | { type: 'request'; text: string }

export interface HousekeepingTask {
  id: string
  roomId: string
  hotelId: string
  staffId?: string
  type?: string
  priority?: string
  status?: string
  notes?: string
  assignedDate?: string
  completedDate?: string
  startTime?: string
  endTime?: string
  photos?: PhotoEvidence[]
  /** Calificación 1–10 que el supervisor le pone a la limpieza al aprobarla. */
  rating?: number | null
  /** Video de evidencia de fin (solo si el hotel usa el modo `video`). */
  video?: VideoEvidence | null
  /** Supervisor que aprobó/revisó la limpieza (users.id). */
  supervisorId?: string
  /** Nota que dejó el supervisor al aprobar. */
  supervisorNote?: string
  /** Hora en que el supervisor estuvo en la habitación (foto de presencia). */
  supOnSiteTime?: string
  cleaningItems?: any
  /** Qué preparar para la llegada (#274). Solo en `arrival_setup`; tareas viejas lo traen null. */
  setupItems?: SetupItem[] | null
  /** Reserva que originó la tarea `arrival_setup` (#274). */
  reservationId?: string | null
  createdAt: string
  updatedAt: string
}

export interface StaffStats {
  staffId: string
  completed: number
  avgDurationMs: number
  totalDurationMs: number
}

export const HousekeepingService = {
  /**
   * Listado paginado. `page`/`limit` van SIEMPRE: sin ellos el backend aplica su
   * default de 20 y la vista muestra una parte del hotel como si fuera todo.
   * `sort` acepta `-campo` para descendente (`-completedDate` = más recientes).
   */
  async list(params: {
    hotelId?: string
    status?: string
    page?: number
    limit?: number
    sort?: string
  } = {}) {
    const q = new URLSearchParams()
    if (params.hotelId) q.set('hotelId', params.hotelId)
    if (params.status) q.set('status', params.status)
    q.set('page', String(params.page ?? 1))
    q.set('limit', String(params.limit ?? DEFAULT_PAGE_SIZE))
    if (params.sort) q.set('sort', params.sort)
    return http.get<HousekeepingPage>(`/housekeeping?${q.toString()}`)
  },
  async getById(id: string) {
    return http.get<HousekeepingTask>(`/housekeeping/${id}`)
  },
  async create(data: Partial<HousekeepingTask>) {
    return http.post<HousekeepingTask>('/housekeeping', data)
  },
  async update(id: string, data: Partial<HousekeepingTask>) {
    return http.put<HousekeepingTask>(`/housekeeping/${id}`, data)
  },
  async delete(id: string) {
    return http.delete(`/housekeeping/${id}`)
  },
  // ─── Endpoints de administración (F3 backend) ──────────────────────────────
  async start(id: string) {
    return http.put<HousekeepingTask>(`/housekeeping/${id}/start`)
  },
  async complete(id: string) {
    return http.put<HousekeepingTask>(`/housekeeping/${id}/complete`)
  },
  async uploadPhoto(id: string, photo: string, fileName: string) {
    // La foto viaja como data URL base64 en JSON: el router del framework no propaga
    // req.files al handler, así que multipart no llega. El controller decodifica base64 → archivo.
    return http.post<HousekeepingTask>(`/housekeeping/${id}/photos`, { photo, fileName })
  },
  async removePhoto(id: string, photoUrl: string) {
    return http.delete<HousekeepingTask>(`/housekeeping/${id}/photos?url=${encodeURIComponent(photoUrl)}`)
  },
  /**
   * Catálogo de áreas fotografiables del hotel (`bed` → "Cama tendida", …). Es lo
   * que convierte las miniaturas de evidencia en algo legible: la foto guarda el
   * `areaId`, el nombre visible vive acá y lo configura el admin.
   */
  async photoRequirements() {
    return http.get<PhotoRequirement[]>('/housekeeping/photo-requirements')
  },
  /** URL firmada temporal para reproducir el video de evidencia. El bucket puede
   *  ser privado: el backend firma un GET que expira, en vez de servir una URL
   *  pública. Permiso `view`: lo ve el admin y el supervisor, no solo quien grabó. */
  async videoViewUrl(id: string) {
    return http.get<VideoViewUrl>(`/housekeeping/${id}/video/view-url`)
  },
  /** Marca la presencia del supervisor (sella `supOnSiteTime`). El backend lo exige
   *  antes de aprobar; el admin que revisa desde el panel la marca en el mismo paso. */
  async markPresence(id: string) {
    return http.post(`/housekeeping/${id}/presence`, {})
  },
  /** Aprueba y CALIFICA la limpieza (1–10). Deja `supervisorId`, la nota y pasa la
   *  tarea a `inspected`. `rating` es obligatorio en el backend. */
  async approve(id: string, rating: number, note?: string) {
    return http.post<HousekeepingTask>(`/housekeeping/${id}/approve`, { rating, note })
  },
  async stats(hotelId?: string, from?: string, to?: string) {
    const params = new URLSearchParams()
    if (hotelId) params.set('hotelId', hotelId)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const query = params.toString() ? `?${params.toString()}` : ''
    return http.get<StaffStats[]>(`/housekeeping/stats${query}`)
  },
}
