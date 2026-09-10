export type AnnouncementType = 'info' | 'warning' | 'urgent' | 'maintenance'
export type AnnouncementPriority = 'low' | 'medium' | 'high'
/** A quién va dirigido el anuncio (#106): todos los hoteles, un hotel o sólo administradores. */
export type AnnouncementAudience = 'all' | 'hotel' | 'admins'

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
  audience?: AnnouncementAudience
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
  audience?: AnnouncementAudience
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
  audience?: AnnouncementAudience
}

export interface AnunciosQuery {
  hotelId?: string
  type?: AnnouncementType
  priority?: AnnouncementPriority
  active?: number
  search?: string
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
