export type AnnouncementType = 'info' | 'warning' | 'urgent' | 'maintenance'
export type AnnouncementPriority = 'low' | 'medium' | 'high'

export interface AnunciosDTO {
  id: string
  hotelId?: string
  authorId?: string
  title: string
  message?: string
  type?: AnnouncementType
  priority?: AnnouncementPriority
  active?: number
  date?: string
  /** ISO 8601 desde cuándo se publica; null = ya. */
  startsAt?: string | null
  /** ISO 8601 hasta cuándo se muestra; null = sin vencimiento. */
  endsAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAnunciosDTO {
  hotelId?: string
  authorId?: string
  title: string
  message?: string
  type?: AnnouncementType
  priority?: AnnouncementPriority
  active?: number
  date?: string
  startsAt?: string | null
  endsAt?: string | null
}

export interface UpdateAnunciosDTO {
  // NOTE: hotelId intentionally NOT here
  authorId?: string
  title?: string
  message?: string
  type?: AnnouncementType
  priority?: AnnouncementPriority
  active?: number
  date?: string
  /** undefined conserva el actual; null o '' lo borra. */
  startsAt?: string | null
  endsAt?: string | null
}

export interface AnunciosQuery {
  hotelId?: string
  type?: AnnouncementType
  priority?: AnnouncementPriority
  active?: number
  search?: string
  /**
   * 'active' (default) aplica la ventana de vigencia startsAt/endsAt: lo que ve el banner.
   * 'all' la omite (programados y vencidos incluidos) y es sólo para super_admin.
   */
  scope?: 'active' | 'all'
  page?: number
  limit?: number
}

export interface AnunciosPaginated {
  data: AnunciosDTO[]
  total: number
  page?: number
  limit?: number
  pages?: number
}
