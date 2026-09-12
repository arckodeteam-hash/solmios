export type ReservationStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show'
export type ReservationChannel = 'direct' | 'booking' | 'airbnb' | 'expedia' | 'agoda' | 'trip' | 'phone' | 'email' | 'walk_in' | 'web'
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
  // Feature "adultos+niños+edades" (2026-09-02) / Requerimiento 12 (2026-09-03) — ver
  // `reservas/model.ts` para el detalle de cada campo. Documentados acá porque `getReservationById`/
  // `listReservations` (crud.ts) devuelven la fila ORM tal cual, sin allow-list.
  childrenAges?: number[]
  childrenAgesAsOf?: string
  // Tarea "Cobro % niños" (2026-09-09) — ver `reservas/model.ts`. Solo la escribe la creación
  // pública, mismo criterio que `childrenAges`/Tarea 22.
  childrenRatePercentApplied?: number | null
  // Tarea 22 (Cuna, 2026-09-08, simplificada 2026-09-09 a Sí/No) — ver `reservas/model.ts`. Solo
  // los escribe la creación pública (bookingengine/usecases/public-booking{,-group}.ts); el panel
  // no tiene UI propia para esto, mismo criterio que `childrenAges`.
  needsCrib?: boolean
  cribCount?: number
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
  /** Horario acordado con este huésped ('HH:MM'). Vacío = manda el del hotel. */
  checkInTime?: string
  checkOutTime?: string
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
  // Tarea 3.4 (corrección 2026-08-25) — 'pending' | 'approved' | undefined (undefined = no
  // aplica, el hotel tiene "confirmación instantánea" prendida). Ver reservas/model.ts.
  // 'rejected' (#271 MR-06): el hotel la rechazó — la reserva queda además `status: 'cancelled'`.
  approvalStatus?: 'pending' | 'approved' | 'rejected'
  // REQ-RWP-04 (#247) — etiqueta de cobro calculada (payments + extras, ver crud.ts). Sólo la
  // devuelven el listado y mark-paid; NO es columna de la tabla.
  paymentState?: 'pending' | 'partial' | 'paid'
  paidAmount?: number
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
  // Reincorporado manualmente en el controller desde el body crudo (el validador nativo descarta
  // `type:'array'` sin avisar) — ver controller.ts `store`/`update`. `childrenAgesAsOf` NO está acá
  // a propósito: nunca es seteable desde el panel, solo lo escribe la creación pública (Req12).
  childrenAges?: number[]
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
  // Ver nota en CreateReservasDTO — mismo criterio de reincorporación manual.
  childrenAges?: number[]
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
  /** Horario acordado con este huésped ('HH:MM'). Vacío = manda el del hotel. */
  checkInTime?: string
  checkOutTime?: string
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
  // Requerimiento 13 (Administración | Composición de huéspedes, 2026-09-03) — filtro para que el
  // panel pueda traer TODAS las habitaciones de una reserva de varias habitaciones (mismo
  // `groupId`, ver `bookingengine/usecases/public-booking-group.ts`). Scoped por `hotelId` igual
  // que el resto de `listReservations` — no es un IDOR nuevo.
  groupId?: string
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
  // #269 — `unitPrice` informativo, `source` 'manual' | 'booking_engine' (fuera del total
  // cobrable), `taxRate` % aplicado al reservar.
  unitPrice?: number
  source?: string
  taxRate?: number
  createdAt?: string
  updatedAt?: string
}
export interface CreateAddonDTO {
  description: string
  kind?: string
  amount?: number
  quantity?: number
  unitPrice?: number
  source?: string
  taxRate?: number
}

export interface CurrentUser {
  id: string
  role: string
  hotelId?: string
}
