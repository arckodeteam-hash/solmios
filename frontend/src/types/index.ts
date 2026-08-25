// === HOTEL ===
export interface Hotel {
  id: string
  name: string
  slug: string
  plan: 'essential' | 'starter' | 'professional' | 'enterprise' | 'ultra'
  country: string
  timezone: string
  currency: string
  createdAt: Date
}

// === ROOM ===
// A-2 (2026-08-19): alineado al enum del backend (single..family) — antes colapsaba
// twin→double y triple/quad→family al leer, y guardar "Familiar" daba 400 (enum sin family).
export type RoomType = 'single' | 'double' | 'twin' | 'triple' | 'quad' | 'suite' | 'deluxe' | 'presidential' | 'family' | 'villa' | 'dorm'
export type RoomStatus = 'available' | 'occupied' | 'pending' | 'cleaning' | 'dirty' | 'out_of_service'

export interface Room {
  id: string
  hotelId: string
  number: string
  name?: string
  type: RoomType
  floor: number
  status: RoomStatus
  amenities: string[]
  maxGuests: number
  basePrice: number
  surfaceArea?: number
  bathrooms?: number
  onlineBookingEnabled?: boolean
  // #648 — solo vienen pobladas cuando RoomService.list() se llama con checkIn/checkOut.
  available?: boolean
  unavailableReason?: string
}

// === GUEST ===
// Naming canónico = modelo DB `guests` (backend huespedes/model.ts). Sin dobles.
export interface Guest {
  id: string
  hotelId: string
  name: string
  email?: string
  phone?: string
  documentType?: string
  document?: string
  nationality: string
  language?: string
  country?: string
  sex?: 'male' | 'female' | 'non_binary' | 'other'
  address?: string
  city?: string
  province?: string
  documentIssueDate?: string
  communicateClient?: 'none' | 'email_confirmation' | 'email_presaless'
  totalStays: number
  totalSpent: number
  loyaltyPoints: number
  birthDate?: string
  preferences?: string[]
  notes?: string
  tier?: string
  profession?: string
  emergencyContact?: EmergencyContact
}

export interface EmergencyContact {
  name: string
  phone: string
  relation: string
  email?: string
}

// === CONTACTOS DE EMERGENCIA DEL HOTEL ===
// Distinto de `EmergencyContact` (ese es el contacto de emergencia del huésped).
// Se persisten en la tabla `configuration` bajo la key `contactos_emergencia`.
export type HotelEmergencyContactKind = 'external' | 'internal'

export interface HotelEmergencyContact {
  id: string
  label: string
  phone: string
  kind: HotelEmergencyContactKind
}

// === CREDIT CARD ( reservation form only ) ===
export interface CreditCardInfo {
  holderName: string
  brand: 'visa' | 'mastercard' | 'amex' | 'discover' | 'other'
  number: string
  cvv: string
  expMonth: string
  expYear: string
}

// === RESERVATION ===
export type ReservationStatus = 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
export type ReservationSource = 'direct' | 'phone' | 'whatsapp' | 'booking' | 'expedia' | 'agoda' | 'airbnb' | 'google' | 'other'

export interface Reservation {
  id: string
  hotelId: string
  guestId: string
  guest?: Guest
  roomId: string
  room?: Room
  checkIn: Date
  checkOut: Date
  adults: number
  children: number
  status: ReservationStatus
  source: ReservationSource
  channelReservationId?: string
  notes?: string
  ownerNotes?: string
  totalAmount: number
  depositAmount: number
  depositPercentage?: number
  depositStatus?: 'unpaid' | 'partial' | 'paid'
  paymentMethod?: string
  paymentStatus: 'pending' | 'partial' | 'paid' | 'refunded'
  promoCode?: string
  regime?: string
  createdAt: Date
  roomNumber?: string
  roomType?: string
  guestName?: string
  guestEmail?: string
  /** Montos APLICADOS al cancelar (los devuelve POST /cancel). Distintos de los de `CancelPreview`,
   *  que es una cotización: entre abrir el modal y confirmar puede cruzarse un borde de tier. */
  cancellationFee?: number
  refundAmount?: number
  emergencyContact?: EmergencyContact
  creditCard?: CreditCardInfo
  /** Tarea 3.4 (corrección 2026-08-25) — eje independiente de `status`: 'pending' = el hotel
   *  apagó "confirmación instantánea" y todavía no revisó esta reserva pagada. */
  approvalStatus?: 'pending' | 'approved' | null
}

// Registro CRUDO de `/api/reservas` (el JSON tal cual lo devuelve el módulo `reservas`), ANTES
// de pasar por `mapReservation()`. No confundir con `Reservation` (modelo del frontend: fechas
// como Date, status/source normalizados). Vive acá y no en el service porque `RescheduleResult`
// lo referencia y los tipos del dominio no pueden depender de la capa de servicios.
export interface ReservationApiRecord {
  id: string
  hotelId: string
  guestId: string | null
  roomId: string | null
  checkIn: string
  checkOut: string
  channel: string
  totalAmount: number
  status: string
  adults?: number
  children?: number
  currency?: string
  deposit?: number
  autoSendEnabled?: boolean
  gdprAccepted?: boolean
  marketingAccepted?: boolean
  termsAccepted?: boolean
  otherCharges?: number
  roomNumber?: string
  roomType?: string
  guestName?: string
  guestEmail?: string
  /** Snapshot que persiste POST /reservas/:id/cancel. Son los montos REALMENTE aplicados —
   *  los del preview son una cotización previa y pueden diferir si se cruzó un borde de tier. */
  cancellationFee?: number
  refundAmount?: number
  cancellationReason?: string
  cancelledAt?: string
  /** Tarea 3.4 (corrección 2026-08-25) — ver `Reservation.approvalStatus`. */
  approvalStatus?: 'pending' | 'approved' | null
}

// === RESCHEDULE (planning: mover / extender una reserva) ===
// Espejo de `backend/src/modules/reservas/usecases/reschedule.ts`.
//
// El quote devuelve SIEMPRE los DOS precios posibles y el frontend hace elegir; `pricingMode` es
// lo único que decide cuál se aplica en el commit. Cambiar de opción NO requiere re-cotizar.
export type ReschedulePricingMode = 'keep' | 'reprice'
export type RescheduleChargeMethod = 'folio' | 'cash' | 'card'

/** Habitación + fechas DESTINO del movimiento (lo que se arrastró en el planning). */
export interface RescheduleTarget {
  roomId: string
  checkIn: string
  checkOut: string
}

/** Bloque de reserva tal como lo maneja la grilla del planning (NO es el `Reservation` del dominio). */
export interface ReschedulableReservation {
  id: string
  name?: string
  roomId?: string | number
  checkIn?: string
  checkOut?: string
}

/** Habitación del planning: solo se usa para mostrar el número en el resumen "antes → después". */
export interface RescheduleRoomRef {
  id: string | number
  number?: string | number
}

export interface RescheduleInput extends Partial<RescheduleTarget> {
  /** Default del backend: `'keep'` (comportamiento histórico). */
  pricingMode?: ReschedulePricingMode
}

export interface RescheduleCommitInput extends RescheduleInput {
  charge?: { method: RescheduleChargeMethod; amount?: number; reason?: string }
  successUrl?: string
  cancelUrl?: string
}

export interface RescheduleQuote {
  reservationId: string
  roomId: string
  checkIn: string
  checkOut: string
  basePrice: number
  oldNights: number
  newNights: number
  previousTotal: number
  /** Total del modo APLICADO (`pricingMode`). Con el default `keep` es el de siempre. */
  quotedNewPrice: number
  /** `quotedNewPrice - previousTotal`. En modo `reprice` puede ser NEGATIVO. */
  difference: number
  /** Eco del modo con el que se calculó `quotedNewPrice`/`difference`. */
  pricingMode: ReschedulePricingMode
  /** Opción 1 — mantener el precio pactado: solo cobra las noches AGREGADAS a tarifa base. */
  keepTotal: number
  keepDifference: number
  /** Opción 2 — repreciar toda la estadía nueva a tarifa vigente (temporadas incluidas). */
  repricedTotal: number
  /** `repricedTotal - previousTotal`. NEGATIVO = saldo a favor del huésped. */
  repricedDifference: number
  /** `false` = no había tarifas cargadas y el recálculo degradó a `rooms.basePrice`. */
  repricedFromRates: boolean
  roomChanged: boolean
  datesChanged: boolean
  currency: string
  available: boolean
  reason: string
}

export interface RescheduleCharge {
  method: RescheduleChargeMethod
  applied: boolean
  target: string
  folioId?: string
  chargeId?: string
  paymentId?: string
  checkoutUrl?: string
  message?: string
}

export interface RescheduleResult {
  reservation: ReservationApiRecord
  quote: RescheduleQuote & {
    chargeAmount: number
    newTotal: number
    /** `max(0, previousTotal - newTotal)` — saldo a favor. Se INFORMA, no se devuelve solo. */
    creditAmount: number
  }
  charge: RescheduleCharge | null
}

// === STAY QUOTE (wizard de nueva reserva: precio por temporada) ===
// Espejo de `backend/src/modules/reservas/usecases/quote.ts`. El wizard antes cotizaba
// `basePrice × noches` en el frontend e ignoraba la grilla de temporadas; este quote trae el
// desglose noche a noche con la temporada de cada fecha.
export interface StayQuoteNight {
  date: string
  /** Nombre de la temporada asignada a la fecha (null = sin temporada → precio base). */
  season: string | null
  seasonLabel: string | null
  seasonColor: string | null
  price: number
  /** `true` si el precio salió de la grilla `room_rates` (no del fallback basePrice). */
  fromRate: boolean
}

export interface StayQuote {
  roomId: string
  roomType: string
  /** Precio por noche sin temporadas — lo que cotizaba el wizard antes de esto. */
  basePrice: number
  nights: StayQuoteNight[]
  nightsCount: number
  /** Suma noche a noche (no `precio × noches`). */
  subtotal: number
  /** Promedio, solo cuando TODAS las noches valen lo mismo (para "N noches × $X"). */
  pricePerNight: number | null
  /** `false` = ninguna noche salió de la grilla → aviso "tarifa base" (pattern repricedFromRates). */
  fromRates: boolean
  /** Noches cuya tarifa está cerrada en la grilla (aviso, no bloqueo). */
  closedNights: number
}

// === CANCELACIÓN (planning / listado: cancelar una reserva aplicando la política) ===
// Espejo de `backend/src/modules/reservas/usecases/cancel.ts` + `shared/usecases/cancellation-math.ts`.
//
// Cancelar NO es `update({status:'cancelled'})`: el endpoint real (`POST /reservas/:id/cancel`)
// aplica la política del hotel (penalidad + reembolso), guarda el motivo y libera los depósitos
// retenidos. El preview (`GET /reservas/:id/cancel-preview`) es el MISMO cálculo en seco, para
// que nadie cancele sin ver antes cuánta plata se pierde.

/** De dónde salió la política aplicada: propia del hotel, preset elegido, o el fallback del sistema. */
export type CancelPolicySource = 'custom' | 'preset' | 'default'

export interface CancelPreview {
  reservationId: string
  status: string
  /** `false` = la reserva no se puede cancelar (ver `blockedReason`): ya cerró el ciclo o está en curso. */
  canCancel: boolean
  blockedReason: string
  guestName: string
  checkIn: string
  checkOut: string
  /** Horas que faltan para la entrada. Es lo que decide qué tramo de la política aplica. */
  hoursUntilCheckIn: number
  totalAmount: number
  deposit: number
  currency: string
  refundable: boolean
  penaltyPercent: number
  cancellationFee: number
  refundAmount: number
  /** `'default'` = el hotel NO cargó política; por eso se devuelve todo. */
  policySource: CancelPolicySource
  policyLabel: string
  tierLabel: string
}

/** Motivo de la cancelación. Obligatorio en la UI (el backend lo acepta vacío por compatibilidad). */
export interface CancelReservationInput {
  reason?: string
}

/**
 * Bloque de reserva tal como lo tienen el planning y el listado (NO es el `Reservation` del
 * dominio): lo único que necesita el modal de cancelación para encabezar la confirmación.
 */
export interface CancellableReservation {
  id: string
  guestName?: string
  roomNumber?: string | number
  checkIn: string
  checkOut: string
  amount?: number
}

// === RESERVATION DETAIL (GET /reservations/:id — composition-root.ts:1202) ===
// Sub-tipos que reflejan EXACTAMENTE el response del backend (guest usa `name`/`document`,
// no firstName/lastName; room usa number/type/basePrice).
export interface ReservationDetailGuest {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  document?: string | null
  nationality?: string | null
  language?: string | null
  birthDate?: string | null
  loyaltyPoints?: number
  totalStays?: number
  totalSpent?: number
  tier?: string
  communicateClient?: string
  country?: string | null
  address?: string | null
  city?: string | null
  province?: string | null
  sex?: string | null
  documentType?: string | null
  documentIssueDate?: string | null
  notes?: string | null
}

export interface ReservationDetailRoom {
  id: string
  number: string
  name?: string | null
  type: string
  basePrice: number
  capacity?: number
  floor?: number | null
}

export interface ReservationDetailCompanion {
  id: string
  name: string
  documentType?: string | null
  documentNumber?: string | null
  nationality?: string | null
  birthDate?: string | null
  isMainGuest?: boolean
}

export interface ReservationDetailLockCode {
  code?: string | null
  status?: string
  startDate?: string | null
  endDate?: string | null
}

export interface ReservationDetailPayment {
  /** `payment_requests.id` — necesario para reusar un link ya creado en vez de generar otro. */
  id?: string
  amount?: number
  currency?: string
  status?: string
  stripePaymentUrl?: string | null
  sentVia?: string
  paidAt?: string | null
}

/** Proyección segura de `message_logs` que devuelve el detalle de la reserva.
 *  `response` NO viaja: guarda el error crudo del transporte de email (dato de infraestructura,
 *  ver backend `reservas/usecases/message-log.ts` → `toMessageLogView`). */
export interface ReservationDetailMessageLog {
  id?: string
  messageType?: string
  status?: string | null
  recipient?: string | null
  sentAt?: string | null
  /** Plantilla/motivo. Sólo en los envíos manuales hechos desde el panel. */
  reference?: string | null
  /** `users.id` de quien lo mandó. Sólo en los envíos manuales. */
  sentByUserId?: string | null
  manual?: boolean
}

export interface ReservationDetailAddon {
  id: string
  description: string
  kind?: 'service' | 'discount'
  amount?: number
  quantity?: number
}

export interface CurrencyConfig {
  secondaryCurrency?: string
  exchangeRate?: number
}

export interface GuaranteeCardData {
  cardHolder: string
  cardBrand: string
  cardLast4: string
  cardExpMonth: string
  cardExpYear: string
}

// === AUDIT LOG (historial de cambios de una reserva) ===
export interface AuditLogEntry {
  id: string
  action: string
  performedBy?: string | null
  details?: string | null
  createdAt?: string
}

export interface ReservationDetail {
  id: string
  hotelId: string
  guestId: string | null
  roomId: string
  checkIn: string
  checkOut: string
  status: string
  channel?: string
  source?: string
  externalLocator?: string | null
  totalAmount: number
  deposit?: number
  /** Saldo REAL a cobrar = chargeableTotal − paidAmount. Lo calcula el backend
   *  (`shared/utils/reservation-balance.ts`): incluye addons y otherCharges. */
  pendingAmount?: number
  /** Lo ya cobrado según `payments` (backend `shared/usecases/reservation-paid.ts`). NO es
   *  `deposit`: incluye lo pagado por folio y por factura, que no tocan esa columna. */
  paidAmount?: number
  /** Total cobrable de la reserva: alojamiento + otros cobros + extras. Fuente única del backend. */
  chargeableTotal?: number
  /** Suma con signo de los addons (los `discount` restan). */
  addonsTotal?: number
  currency?: string
  commission?: number
  commissionAmount?: number
  paymentMethod?: string | null
  depositPercentage?: number
  depositStatus?: string
  regime?: string
  notes?: string | null
  otaNotes?: string | null
  ownerNotes?: string | null
  promoCode?: string | null
  autoSendEnabled?: boolean
  communicateClient?: string
  emergencyContact?: { name: string; phone: string; relation: string; email?: string }
  adults?: number
  children?: number
  createdAt?: string
  checkedInAt?: string | null
  checkedOutAt?: string | null
  // F3 MisterPlan: condiciones + otros cobros + código de check-in digital
  gdprAccepted?: boolean
  marketingAccepted?: boolean
  termsAccepted?: boolean
  otherCharges?: number
  checkinCode?: string
  // Tarjeta de garantía (MisterPlan): bandera; los datos se revelan vía unlock con PIN.
  hasGuaranteeCard?: boolean
  guest?: ReservationDetailGuest | null
  room?: ReservationDetailRoom | null
  companions?: ReservationDetailCompanion[]
  lockCodes?: ReservationDetailLockCode[]
  payments?: ReservationDetailPayment[]
  messageLogs?: ReservationDetailMessageLog[]
  addons?: ReservationDetailAddon[]
}

// === FOLIO ===
export interface FolioItem {
  id: string
  description: string
  amount: number
  type: 'room' | 'service' | 'minibar' | 'tax' | 'discount'
  createdAt: Date
}

export interface RoomFolio {
  id: string
  reservationId: string
  items: FolioItem[]
  total: number
}

// === PAYMENT ===
export type PaymentMethod = 'card' | 'transfer' | 'cash' | 'link' | 'deposit'
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded'

export interface Payment {
  id: string
  hotelId: string
  reservationId?: string
  guestId: string
  amount: number
  currency: string
  method: PaymentMethod
  status: PaymentStatus
  cardLast4?: string
  cardBrand?: string
  createdAt: Date
}

// === EMPLOYEE ===
export type Department = 'reception' | 'housekeeping' | 'maintenance' | 'accounting' | 'management' | 'kitchen' | 'bar'

export interface Employee {
  id: string
  hotelId: string
  firstName: string
  lastName: string
  position: string
  department: Department
  email: string
  phone: string
  hireDate: Date
  status: 'active' | 'inactive'
  salary: number
}

// === DASHBOARD ===
export interface DashboardStats {
  occupancy: number
  arrivalsToday: number
  departuresToday: number
  pendingClean: number
  openIncidents: number
  revenueToday: number
  revenueMTD: number
  avgRate: number
  revpar: number
}

// === DASHBOARD: Pendientes de hoy (GET /api/checkin) ===
// Espeja backend CheckinItemDTO/CheckinListDTO (dashboard/types.ts:48-66).
// `depositStatus` y `deposit` NO están en el DTO pero llegan en el response porque
// getCheckinList hace spread `...r` de la reserva cruda (depositStatus es model field
// real: 'unpaid'|'partial'|'paid'). Se usan para el badge de pago del panel.
export interface CheckinListItem {
  id: string
  guestId: string
  roomId: string
  checkIn: string
  checkOut: string
  status: string
  totalAmount?: number
  guestName?: string
  guestEmail?: string
  roomNumber?: string
  depositStatus?: string
  deposit?: number
  /** Saldo pendiente PERSISTIDO (`reservations.pendingAmount`). Misma fórmula que
   *  `ReservationDetail.pendingAmount`: el backend la recalcula en cada escritura que mueve el
   *  total cobrable (alta/baja de extras y `otherCharges`) — ver
   *  `shared/usecases/sync-reservation-pending.ts`. */
  pendingAmount?: number
}

export interface CheckinListData {
  checkins: CheckinListItem[]
  checkouts: CheckinListItem[]
  pendingCheckins: number
  todayCheckouts: number
}

 // === USER ===
export type UserRole = 'super_admin' | 'hotel_admin' | 'receptionist' | 'housekeeper' | 'maintenance' | 'supervisor' | 'waiter' | 'kitchen'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  hotelId: string
  hotelName: string
  phone?: string
  avatar?: string
  plan?: string
  rooms?: number
  permissions?: string[]
  emailVerified?: boolean
}

// === CHECKIN ===
export interface CheckinRoom {
  id: string
  number: string
  type: string
  status: RoomStatus
  basePrice: number
  floor: number
  capacity: number
  bathrooms: number
  surfaceArea: number
  guestName: string | null
  channel: string | null
  checkIn: string | null
  checkOut: string | null
  checkDates: string
  guestEmail: string | null
  resId: string | null
}

export interface CheckinGuest {
  id: string
  guestName: string
  guestEmail: string
  initials: string
  roomNumber: string
  roomId: string
  checkIn: string
  checkOut: string
  nights: number
  status: string
  channel: string
  channelLabel: string
  channelColor: string
  totalAmount: number
  adults: number
  children: number
  checkedIn: boolean
  checkedOut: boolean
  /** `Reservations.notes` crudo (pedido especial, llegada estimada, etc. — mismo campo que
   *  `ReservationModal.vue` muestra como "Notas"). Null si la reserva no tiene nada cargado. */
  notes: string | null
}

// === FEEDBACK ===
export type FeedbackPriority = 'low' | 'medium' | 'high'
export type FeedbackCategory = 'UI' | 'Bug' | 'Improvement'
export type FeedbackStatus = 'open' | 'in_progress' | 'done'

export interface FeedbackPin {
  id: string
  x: number
  y: number
  route: string
  comment: string
  priority: FeedbackPriority
  category: FeedbackCategory
  status: FeedbackStatus
  viewportWidth: number
  viewportHeight: number
  browser: string
  createdAt: Date
  /** URL del issue de GitHub si el pin fue enviado como feedback (lo devuelve el server). */
  githubIssueUrl?: string
}

export interface CreateFeedbackPayload {
  x: number
  y: number
  route: string
  comment: string
  priority: FeedbackPriority
  category: FeedbackCategory
  screenshot?: string
  viewportWidth: number
  viewportHeight: number
  browser: string
}

// === MARKETING (auto-messages, plantillas WhatsApp, message logs — backend/src/modules/marketing) ===
export type MarketingChannel = 'email' | 'whatsapp' | 'both' | string

export interface MarketingAutoMessage {
  id: string
  hotelId: string
  title: string
  color: string
  emailSubject?: string
  emailBody?: string
  whatsappBody?: string
  channel: MarketingChannel
  triggerEvent: string
  triggerOffset: number
  variables?: string | null
  isActive: boolean | number
  event?: string
  language?: string
  triggerType?: string
  createdAt?: string
  updatedAt?: string
}

export interface CreateMarketingAutoMessage {
  hotelId?: string
  title: string
  color?: string
  emailSubject?: string
  emailBody?: string
  whatsappBody?: string
  channel?: MarketingChannel
  triggerEvent?: string
  triggerOffset?: number
  variables?: string
  isActive?: boolean
  event?: string
  language?: string
  triggerType?: string
}

export interface MarketingWhatsappTemplate {
  id: string
  hotelId: string
  name: string
  body: string
  category: string
  isActive: boolean | number
  createdAt?: string
  updatedAt?: string
}

export interface CreateMarketingWhatsappTemplate {
  hotelId?: string
  name: string
  body?: string
  category?: string
  isActive?: boolean
}

export interface MarketingMessageLog {
  id: string
  hotelId: string
  reservationId?: string | null
  messageId?: string | null
  messageType: string
  status: string
  recipient?: string | null
  response?: string | null
  sentAt?: string | null
  createdAt?: string
}

// === AUDIT LOG — plataforma (backend/src/modules/auditlog, distinto de AuditLogEntry de reserva) ===
export interface AuditLogRecord {
  id: string
  hotelId?: string
  userId?: string
  userName?: string
  action: string
  entity?: string
  entityId?: string
  detail?: string
  ip?: string
  createdAt: string
  updatedAt: string
}

export interface AuditLogQuery {
  hotelId?: string
  status?: string
  type?: string
  category?: string
  search?: string
  /** Filtros del panel (/panel/config/auditoria, M3 qa-ui config-2026-08-22). */
  userId?: string
  action?: string
  /** Rango de fechas ISO (YYYY-MM-DD), límites inclusive. */
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface AuditLogListResponse {
  data: AuditLogRecord[]
  total: number
}

// === PUSH TOKENS (backend/src/modules/pushtokens — alta/baja del propio dispositivo) ===
export interface PushToken {
  id: string
  hotelId: string
  userId: string
  token: string
  platform: string | null
  createdAt: string
  updatedAt: string
}

export interface RegisterPushTokenPayload {
  token: string
  platform?: string
}

// F0 0.19/0.20 (solmi-direct-booking) — Tipos del dominio público y booking.
// viven en archivos propios (namespace separado: sin hotelId, sin datos del hotelero) y se
// re-exportan acá para mantener el `import from '@/types'` único del resto del frontend.
export * from './public-hotel'
export * from './booking'

// F1 1.7 (solmi-direct-booking) — Tipos de la landing pública por bloques.
// `LandingBlock` espeja el endpoint público `/api/public/hotels/:slug/landing`.
export * from './landing'

// Enum global de monedas (refactor cross-cutting). Source of truth backend en
// `backend/src/shared/currency.ts`; este archivo es el espejo frontend. Todos los componentes
// que necesiten la lista de monedas o un CurrencyCode deben importar de acá o de
// `@/data/intl-catalogs` (que re-exporta la lista runtime-derived).
export * from './currency'
