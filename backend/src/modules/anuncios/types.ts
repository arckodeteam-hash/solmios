/**
 * `feature` y `promo` los ofrece el panel de la plataforma desde siempre y el validador ya los
 * aceptaba; faltaban acá, así que el service necesitaba castear para compilar.
 */
export type AnnouncementType = 'info' | 'warning' | 'urgent' | 'maintenance' | 'feature' | 'promo'

/**
 * `urgent` lo pinta el banner (`AnnouncementBanner.vue`) desde siempre, pero el validador no lo
 * aceptaba: el badge de urgencia era inalcanzable.
 */
export type AnnouncementPriority = 'low' | 'medium' | 'high' | 'urgent'

/** A quién va dirigido el anuncio. Ver `usecases/visibility.ts`. */
export type AnnouncementAudience = 'hotel' | 'all' | 'admins'

/** Qué se lista: solo lo vigente (banner) o todo, incluidos programados y vencidos (panel). */
export type AnunciosScope = 'active' | 'all'

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
  startsAt?: string
  endsAt?: string
  createdAt: string
  updatedAt: string
  /**
   * NO es una columna: lo agrega el service por usuario al responder el listado. Va fuera de la
   * entrada cacheada, porque "cerrado" es de cada persona y cachearlo se lo aplicaría a sus
   * compañeros.
   */
  dismissed?: boolean
  seen?: boolean
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
  startsAt?: string
  endsAt?: string
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
  startsAt?: string
  endsAt?: string
}

export interface AnunciosQuery {
  hotelId?: string
  type?: AnnouncementType
  priority?: AnnouncementPriority
  active?: number
  scope?: AnunciosScope
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

/** Una lectura (o cierre) de un anuncio por parte de un usuario concreto. */
export interface AnnouncementReadDTO {
  id: string
  announcementId: string
  userId: string
  hotelId?: string
  seenAt?: string
  dismissedAt?: string
  createdAt: string
  updatedAt: string
}
