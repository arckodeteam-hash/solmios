export type NotificationType = 'system' | 'reservation' | 'payment' | 'housekeeping' | 'maintenance' | 'announcement' | 'support'
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'whatsapp'

export interface NotificationMetadata {
  [key: string]: unknown
}

export interface NotificacionesDTO {
  id: string
  hotelId: string
  userId?: string
  type?: NotificationType
  title: string
  message?: string
  read?: number
  sent?: number
  date?: string
  channel?: NotificationChannel
  metadata?: NotificationMetadata
  createdAt: string
  updatedAt: string
}

export interface CreateNotificacionesDTO {
  hotelId: string
  userId?: string
  type?: NotificationType
  title: string
  message?: string
  read?: number
  sent?: number
  date?: string
  channel?: NotificationChannel
  metadata?: NotificationMetadata
}

export interface UpdateNotificacionesDTO {
  // NOTE: hotelId intentionally NOT here
  userId?: string
  type?: NotificationType
  title?: string
  message?: string
  read?: number
  sent?: number
  date?: string
  channel?: NotificationChannel
  metadata?: NotificationMetadata
}

export interface NotificacionesQuery {
  hotelId?: string
  type?: NotificationType
  channel?: NotificationChannel
  userId?: string
  read?: number
  search?: string
  page?: number
  limit?: number
}

export interface NotificacionesPaginated {
  data: NotificacionesDTO[]
  total: number
  page?: number
  limit?: number
  pages?: number
}
