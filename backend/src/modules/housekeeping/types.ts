export type CleaningType = 'full_cleaning' | 'quick_cleaning' | 'deep_cleaning' | 'inspection' | 'maintenance' | 'arrival_setup'
export type CleaningPriority = 'low' | 'medium' | 'high' | 'urgent'
export type CleaningStatus = 'pending' | 'in_progress' | 'completed' | 'inspected'

/** Usuario autenticado derivado del JWT (HotelAuth reinyecta hotelId). */
export type HousekeepingUser = { id: string; role: string; hotelId?: string }

export interface CleaningItem {
  name: string
  done: boolean
}

/**
 * Ítem de la tarea `arrival_setup` (#274): lo que hay que dejar listo en la habitación antes
 * de que llegue el huésped. Se deriva de la reserva (cuna, amenidades infantiles, régimen,
 * pedido especial), no lo carga nadie a mano.
 */
export type SetupItem =
  | { type: 'crib'; qty: number }
  | { type: 'amenity'; name: string; qty: number }
  | { type: 'regime'; name: string }
  | { type: 'request'; text: string }

export interface PhotoEvidence {
  /** A qué requisito/área corresponde la foto (cama, baño, `supervisor_presence`…).
   *  La app lo usa para llenar los recuadros de evidencia; se persiste desde `addPhoto`. */
  areaId?: string
  url: string
  path: string
  name: string
  size: number
  mimeType: string
  uploadedAt: string
}

/**
 * Video de evidencia de fin, cuando el hotel usa el modo `video`. Uno solo por
 * tarea. Los bytes NO pasan por el backend: la app los sube directo al bucket con
 * una URL prefirmada y después confirma acá la url + la duración.
 */
export interface VideoEvidence {
  url: string
  path: string
  /** Duración REAL leída del archivo en el bucket, no la que declaró la app. */
  durationSeconds: number
  mimeType: string
  uploadedAt: string
  /** Tamaño real del objeto. */
  sizeBytes?: number
  /** `avc1` (H.264), `hvc1`/`hev1` (HEVC). */
  codec?: string | null
  width?: number | null
  height?: number | null
  /**
   * `false` cuando el teléfono grabó en HEVC: el navegador no lo decodifica y el
   * panel ofrece descargarlo en vez de mostrar un cuadro negro. El servidor lo
   * convierte a H.264 y entonces pasa a `true`.
   */
  playableInBrowser?: boolean
  /** El servidor lo está convirtiendo a H.264 en este momento. */
  transcoding?: boolean
  /** Codec con el que se grabó, si hubo que convertirlo (queda como rastro). */
  originalCodec?: string | null
}

export interface StaffStats {
  staffId: string
  completed: number
  avgDurationMs: number
  totalDurationMs: number
}

export interface StaffStatsQuery {
  hotelId?: string
  from?: string
  to?: string
}

export interface HousekeepingDTO {
  id: string
  roomId: string
  hotelId: string
  staffId?: string
  type?: CleaningType
  priority?: CleaningPriority
  status?: CleaningStatus
  notes?: string
  assignedDate?: string
  completedDate?: string
  cleaningItems?: CleaningItem[]
  /** Solo en tareas `arrival_setup`: qué preparar para la llegada. Null en las demás. */
  setupItems?: SetupItem[] | null
  /** Reserva que originó la tarea (`arrival_setup`). Null en las tareas manuales. */
  reservationId?: string | null
  startTime?: string
  endTime?: string
  /** Pausa del cronómetro: `pausedAt` = pausada desde (null si corre); `pausedSeconds` = acumulado. */
  pausedAt?: string | null
  pausedSeconds?: number
  photos?: PhotoEvidence[]
  supervisorId?: string
  /** Motivo con el que el supervisor/admin DEVOLVIÓ la limpieza (reject). La app lo muestra a la camarera. */
  supervisorNote?: string | null
  supOnSiteTime?: string
  /** Calificación 1–10 que el supervisor le puso a la limpieza al aprobarla. */
  rating?: number | null
  /** Video de evidencia de fin (solo si el hotel usa el modo `video`). */
  video?: VideoEvidence | null
  createdAt: string
  updatedAt: string
}

export interface CreateHousekeepingDTO {
  roomId: string
  hotelId: string
  staffId?: string
  type?: CleaningType
  priority?: CleaningPriority
  status?: CleaningStatus
  notes?: string
  assignedDate?: string
  completedDate?: string
  cleaningItems?: CleaningItem[]
  setupItems?: SetupItem[] | null
  reservationId?: string | null
}

export interface UpdateHousekeepingDTO {
  roomId?: string
  // NOTE: hotelId intentionally NOT here — cannot move task between hotels
  staffId?: string
  type?: CleaningType
  priority?: CleaningPriority
  status?: CleaningStatus
  notes?: string
  assignedDate?: string
  completedDate?: string
  cleaningItems?: CleaningItem[]
  startTime?: string
  endTime?: string
  photos?: PhotoEvidence[]
}

export interface HousekeepingQuery {
  hotelId?: string
  status?: CleaningStatus
  type?: CleaningType
  priority?: CleaningPriority
  roomId?: string
  staffId?: string
  search?: string
  page?: number
  limit?: number
  /**
   * Orden del listado: `campo` (ascendente) o `-campo` (descendente), p.ej.
   * `-completedDate` para las limpiezas terminadas más recientes. Sin esto el
   * orden lo decide la base — sirve para "las últimas N", no para paginar a ciegas.
   */
  sort?: string
}

export interface HousekeepingPaginated {
  data: HousekeepingDTO[]
  total: number
  page?: number
  limit?: number
  pages?: number
}
