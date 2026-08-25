// hoteles/types.ts — DTOs completos del módulo

export type HotelStatus = 'active' | 'inactive' | 'suspended'
export type HotelPlan = 'essential' | 'starter' | 'professional' | 'enterprise' | 'ultra'
export type AccommodationType = 'hotel' | 'apartment' | 'hostel' | 'villa' | 'bnb'
export type CleaningType = 'checkout' | 'daily' | 'weekly'
export type DepositType = 'none' | 'fixed' | 'percentage'
export type AdvanceType = 'percentage' | 'fixed'
export type DefaultPaymentMethod = 'transfer' | 'card' | 'cash' | 'gateway'

export interface HotelesDTO {
  id: string
  name: string
  address?: string
  phone?: string
  email?: string
  country?: string
  currency?: string
  timezone?: string
  plan?: HotelPlan
  status?: HotelStatus
  roomsCount?: number
  active?: number
  // Check-in / Check-out
  checkIn?: string
  checkOut?: string
  // Politicas
  freeCancellation?: boolean
  /** #34: 'flexible' | 'moderate' | 'strict' | 'non_refundable' — excluyente con freeCancellation (assertCancellationCompatible). */
  cancellationType?: string
  depositRequired?: boolean
  depositPercent?: number
  weekendSurcharge?: number
  // Propietario
  ownerName?: string
  ownerTaxId?: string
  deviceEmail?: string
  // Alojamiento
  accommodationType?: AccommodationType
  registrationNumber?: string
  website?: string
  bookingEngineUrl?: string
  phone2?: string
  warningPhone?: string
  secondaryCurrency?: string
  youtubeUrl?: string
  starRating?: string
  onlineBookingStatus?: string
  motorVersion?: string
  // Localizacion
  latitude?: number
  longitude?: number
  province?: string
  municipality?: string
  locality?: string
  postalCode?: string
  // Condiciones
  cleaningType?: CleaningType
  depositType?: DepositType
  depositFixed?: number
  advanceType?: AdvanceType
  advanceAmount?: number
  releaseHours?: number
  defaultPaymentMethod?: DefaultPaymentMethod
  // Resenas
  requestReviews?: boolean
  publishReviewScore?: boolean
  publishReviewComments?: boolean
  // Impuestos
  taxName?: string
  taxRate?: number
  // Multilingue
  descriptionJson?: string
  // WiFi
  wifiNetwork?: string
  wifiPassword?: string
  // Timestamps
  createdAt?: string
  updatedAt?: string
}

export interface CreateHotelesDTO {
  name: string
  address?: string
  phone?: string
  email?: string
  country?: string
  currency?: string
  timezone?: string
  plan?: HotelPlan
  status?: HotelStatus
  roomsCount?: number
  active?: number
  checkIn?: string
  checkOut?: string
  freeCancellation?: boolean
  cancellationType?: string
  depositRequired?: boolean
  depositPercent?: number
  weekendSurcharge?: number
  ownerName?: string
  ownerTaxId?: string
  deviceEmail?: string
  accommodationType?: AccommodationType
  registrationNumber?: string
  website?: string
  bookingEngineUrl?: string
  phone2?: string
  warningPhone?: string
  secondaryCurrency?: string
  youtubeUrl?: string
  starRating?: string
  onlineBookingStatus?: string
  motorVersion?: string
  latitude?: number
  longitude?: number
  province?: string
  municipality?: string
  locality?: string
  postalCode?: string
  cleaningType?: CleaningType
  depositType?: DepositType
  depositFixed?: number
  advanceType?: AdvanceType
  advanceAmount?: number
  releaseHours?: number
  defaultPaymentMethod?: DefaultPaymentMethod
  requestReviews?: boolean
  publishReviewScore?: boolean
  publishReviewComments?: boolean
  taxName?: string
  taxRate?: number
  descriptionJson?: string
  wifiNetwork?: string
  wifiPassword?: string
}

export interface UpdateHotelesDTO extends Partial<Omit<CreateHotelesDTO, 'id'>> {}

export interface HotelesQuery {
  hotelId?: string
  status?: HotelStatus
  type?: AccommodationType
  category?: string
  search?: string
  page?: number
  limit?: number
}

export interface HotelesPaginated {
  data: HotelesDTO[]
  total: number
  page?: number
  limit?: number
  pages?: number
}
