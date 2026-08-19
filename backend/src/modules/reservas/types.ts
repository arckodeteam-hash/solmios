export type ReservationStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'
export type ReservationChannel = 'direct' | 'booking' | 'airbnb' | 'expedia' | 'agoda' | 'trip' | 'phone' | 'email' | 'walk_in'
export type PreCheckinStatus = 'pending' | 'sent' | 'completed' | 'expired'

export interface ReservasDTO {
  id: string
  guestId?: string
  roomId: string
  hotelId: string
  checkIn: string
  checkOut: string
  status?: ReservationStatus
  channel?: ReservationChannel
  totalAmount: number
  deposit?: number
  currency?: string
  adults?: number
  children?: number
  notes?: string
  // OTA + payments
  source?: string
  externalLocator?: string
  commission?: number
  commissionAmount?: number
  paymentMethod?: string
  pendingAmount?: number
  autoSendEnabled?: boolean
  preCheckinStatus?: PreCheckinStatus
  preCheckinHash?: string
  groupId?: string
  otaNotes?: string
  checkedInAt?: string
  checkedOutAt?: string
  folioId?: string
  // F3 MisterPlan: condiciones + otros cobros
  gdprAccepted?: boolean
  marketingAccepted?: boolean
  termsAccepted?: boolean
  otherCharges?: number
  // Pre-checkin público: firma digital + timestamp de aceptación (ver usecases/pre-checkin.ts).
  signatureUrl?: string
  contractAcceptedAt?: string
  // F1/F2 plan #627 — Snapshot de cancelación (lo escribe cancelReservation).
  cancelledAt?: string
  cancellationReason?: string
  cancellationFee?: number
  refundAmount?: number
  policyApplied?: any
  createdAt: string
  updatedAt: string
}

export interface CreateReservasDTO {
  guestId?: string
  roomId: string
  hotelId: string
  checkIn: string
  checkOut: string
  status?: ReservationStatus
  channel?: ReservationChannel
  totalAmount: number
  deposit?: number
  depositPercentage?: number
  depositStatus?: string
  currency?: string
  adults?: number
  children?: number
  notes?: string
  ownerNotes?: string
  source?: string
  externalLocator?: string
  commission?: number
  commissionAmount?: number
  paymentMethod?: string
  pendingAmount?: number
  autoSendEnabled?: boolean
  preCheckinStatus?: PreCheckinStatus
  preCheckinHash?: string
  groupId?: string
  otaNotes?: string
  regime?: string
  promoCode?: string
  communicateClient?: string
  // F3 MisterPlan: condiciones + otros cobros
  gdprAccepted?: boolean
  marketingAccepted?: boolean
  termsAccepted?: boolean
  otherCharges?: number
  // Precio por temporada (panel): `rates` → el backend recalcula el alojamiento server-side
  // (season_assignments → room_rates → fallback rooms.basePrice) y arma
  // totalAmount = sumStayPrice + taxesAmount - promoDiscountAmount. Ausente/`manual` →
  // totalAmount tal cual llega (compat OTA/móvil/connectors). Ver usecases/quote.ts.
  priceFrom?: 'rates' | 'manual'
  taxesAmount?: number
  promoDiscountAmount?: number
}

export interface UpdateReservasDTO {
  guestId?: string
  roomId?: string
  // NOTE: hotelId intentionally NOT here — cannot move reservation between hotels
  checkIn?: string
  checkOut?: string
  status?: ReservationStatus
  channel?: ReservationChannel
  totalAmount?: number
  deposit?: number
  currency?: string
  adults?: number
  children?: number
  notes?: string
  source?: string
  externalLocator?: string
  commission?: number
  commissionAmount?: number
  paymentMethod?: string
  pendingAmount?: number
  autoSendEnabled?: boolean
  preCheckinStatus?: PreCheckinStatus
  preCheckinHash?: string
  groupId?: string
  otaNotes?: string
  checkedInAt?: string
  checkedOutAt?: string
  folioId?: string
  // F3 MisterPlan: condiciones + otros cobros
  gdprAccepted?: boolean
  marketingAccepted?: boolean
  termsAccepted?: boolean
  otherCharges?: number
  // PC-8 (2026-08-19): editar/cambiar/quitar el código promocional. crud.updateReservation
  // valida + consume/libera usos según el cambio (schema Update ya lo declara).
  promoCode?: string
}

export interface ReservasQuery {
  hotelId?: string
  status?: ReservationStatus
  channel?: ReservationChannel
  roomId?: string
  guestId?: string
  checkInFrom?: string
  checkInTo?: string
  search?: string
  page?: number
  limit?: number
}

export interface ReservasPaginated {
  data: ReservasDTO[]
  total: number
  page?: number
  limit?: number
  pages?: number
}

// ── Companions (acompañantes) — tabla Companions (shared/models.ts) ──
export interface CompanionDTO {
  id: string
  reservationId: string
  hotelId?: string
  name: string
  documentType?: string
  documentNumber?: string
  nationality?: string
  birthDate?: string
  isMainGuest?: number
  createdAt?: string
  updatedAt?: string
}
export interface CreateCompanionDTO {
  name: string
  documentType?: string
  documentNumber?: string
  nationality?: string
  birthDate?: string
  isMainGuest?: boolean
}
export interface UpdateCompanionDTO {
  name?: string
  documentType?: string
  documentNumber?: string
  nationality?: string
  birthDate?: string
  isMainGuest?: boolean
}

// ── Addons (ReservationAddons) — tabla ReservationAddons (shared/models.ts) ──
export interface AddonDTO {
  id: string
  reservationId: string
  hotelId?: string
  description: string
  amount: number
  kind?: string
  quantity?: number
  status?: string
  createdAt?: string
  updatedAt?: string
}
export interface CreateAddonDTO {
  description: string
  kind?: string
  amount?: number
  quantity?: number
}

export interface CurrentUser {
  id: string
  role: string
  hotelId?: string
}
