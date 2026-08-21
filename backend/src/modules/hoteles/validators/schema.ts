import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

const HOTEL_STATUS_ENUM = ['active', 'inactive', 'suspended']
// Incluye 'host' (plan de entrada, scripts/create-plans-table.ts): sin él, el super-admin
// no puede editar un hotel cuyo espejo `hotels.plan` sea 'host' — el enum estaba viejo.
const HOTEL_PLAN_ENUM = ['host', 'essential', 'starter', 'professional', 'enterprise', 'ultra']
const ACCOMMODATION_TYPE_ENUM = ['hotel', 'apartment', 'hostel', 'villa', 'bnb']
const CLEANING_TYPE_ENUM = ['checkout', 'daily', 'weekly']
const DEPOSIT_TYPE_ENUM = ['none', 'fixed', 'percentage']
const ADVANCE_TYPE_ENUM = ['percentage', 'fixed']
const PAYMENT_METHOD_ENUM = ['transfer', 'card', 'cash', 'gateway']
const CANCELLATION_TYPE_ENUM = ['flexible', 'moderate', 'strict', 'non_refundable']

export const CreateHotelesSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true, min: 2, max: 100 },
  address: { type: 'string' as const, max: 200 },
  phone: { type: 'string' as const, min: 7, max: 20 },
  email: { type: 'string' as const, max: 200 },
  country: { type: 'string' as const, max: 100 },
  currency: { type: 'string' as const, min: 3, max: 3 },
  timezone: { type: 'string' as const, max: 50 },
  plan: { type: 'string' as const, enum: HOTEL_PLAN_ENUM },
  status: { type: 'string' as const, enum: HOTEL_STATUS_ENUM },
  roomsCount: { type: 'number' as const, min: 0 },
  active: { type: 'number' as const },
  // Check-in / Check-out
  checkIn: { type: 'string' as const, pattern: /^\d{2}:\d{2}$/ },
  checkOut: { type: 'string' as const, pattern: /^\d{2}:\d{2}$/ },
  // Policies
  freeCancellation: { type: 'boolean' as const },
  depositRequired: { type: 'boolean' as const },
  depositPercent: { type: 'number' as const, min: 0, max: 100 },
  weekendSurcharge: { type: 'number' as const, min: 0, max: 100 },
  // Owner
  ownerName: { type: 'string' as const, max: 100 },
  ownerTaxId: { type: 'string' as const, max: 50 },
  deviceEmail: { type: 'string' as const, max: 200 },
  // Accommodation
  accommodationType: { type: 'string' as const, enum: ACCOMMODATION_TYPE_ENUM },
  registrationNumber: { type: 'string' as const, max: 50 },
  website: { type: 'string' as const, max: 200 },
  logo: { type: 'string' as const, max: 500 },
  bookingEngineUrl: { type: 'string' as const, max: 200 },
  phone2: { type: 'string' as const, max: 20 },
  warningPhone: { type: 'string' as const, max: 20 },
  secondaryCurrency: { type: 'string' as const, min: 3, max: 3 },
  youtubeUrl: { type: 'string' as const, max: 200 },
  starRating: { type: 'string' as const },
  onlineBookingStatus: { type: 'string' as const },
  motorVersion: { type: 'string' as const },
  // Location
  latitude: { type: 'number' as const, min: -90, max: 90 },
  longitude: { type: 'number' as const, min: -180, max: 180 },
  province: { type: 'string' as const, max: 100 },
  municipality: { type: 'string' as const, max: 100 },
  locality: { type: 'string' as const, max: 100 },
  postalCode: { type: 'string' as const, max: 20 },
  // Conditions
  cancellationType: { type: 'string' as const, enum: CANCELLATION_TYPE_ENUM },
  cleaningType: { type: 'string' as const, enum: CLEANING_TYPE_ENUM },
  depositType: { type: 'string' as const, enum: DEPOSIT_TYPE_ENUM },
  depositFixed: { type: 'number' as const, min: 0 },
  advanceType: { type: 'string' as const, enum: ADVANCE_TYPE_ENUM },
  advanceAmount: { type: 'number' as const, min: 0 },
  releaseHours: { type: 'number' as const, min: 0 },
  defaultPaymentMethod: { type: 'string' as const, enum: PAYMENT_METHOD_ENUM },
  // Reviews
  requestReviews: { type: 'boolean' as const },
  publishReviewScore: { type: 'boolean' as const },
  publishReviewComments: { type: 'boolean' as const },
  // Taxes
  taxName: { type: 'string' as const, max: 50 },
  taxRate: { type: 'number' as const, min: 0, max: 100 },
  // Multilingual
  descriptionJson: { type: 'string' as const },
  // WiFi
  wifiNetwork: { type: 'string' as const, max: 100 },
  wifiPassword: { type: 'string' as const, max: 100 },
}

export const UpdateHotelesSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, max: 100 },
  address: { type: 'string' as const, max: 200 },
  phone: { type: 'string' as const, min: 7, max: 20 },
  email: { type: 'string' as const, max: 200 },
  country: { type: 'string' as const, max: 100 },
  currency: { type: 'string' as const, min: 3, max: 3 },
  timezone: { type: 'string' as const, max: 50 },
  // plan y status NO se editan acá: son operación de plataforma (super_admin vía PUT /api/admin/hoteles/:id).
  // Al no declararlos, validateSchema los descarta → un merchant no puede auto-subirse de plan ni re-activarse.
  roomsCount: { type: 'number' as const, min: 0 },
  active: { type: 'number' as const },
  checkIn: { type: 'string' as const, pattern: /^\d{2}:\d{2}$/ },
  checkOut: { type: 'string' as const, pattern: /^\d{2}:\d{2}$/ },
  freeCancellation: { type: 'boolean' as const },
  depositRequired: { type: 'boolean' as const },
  depositPercent: { type: 'number' as const, min: 0, max: 100 },
  weekendSurcharge: { type: 'number' as const, min: 0, max: 100 },
  ownerName: { type: 'string' as const, max: 100 },
  ownerTaxId: { type: 'string' as const, max: 50 },
  deviceEmail: { type: 'string' as const, max: 200 },
  accommodationType: { type: 'string' as const, enum: ACCOMMODATION_TYPE_ENUM },
  registrationNumber: { type: 'string' as const, max: 50 },
  website: { type: 'string' as const, max: 200 },
  logo: { type: 'string' as const, max: 500 },
  bookingEngineUrl: { type: 'string' as const, max: 200 },
  phone2: { type: 'string' as const, max: 20 },
  warningPhone: { type: 'string' as const, max: 20 },
  secondaryCurrency: { type: 'string' as const, min: 3, max: 3 },
  youtubeUrl: { type: 'string' as const, max: 200 },
  starRating: { type: 'string' as const },
  onlineBookingStatus: { type: 'string' as const },
  motorVersion: { type: 'string' as const },
  latitude: { type: 'number' as const, min: -90, max: 90 },
  longitude: { type: 'number' as const, min: -180, max: 180 },
  province: { type: 'string' as const, max: 100 },
  municipality: { type: 'string' as const, max: 100 },
  locality: { type: 'string' as const, max: 100 },
  postalCode: { type: 'string' as const, max: 20 },
  cancellationType: { type: 'string' as const, enum: CANCELLATION_TYPE_ENUM },
  cleaningType: { type: 'string' as const, enum: CLEANING_TYPE_ENUM },
  depositType: { type: 'string' as const, enum: DEPOSIT_TYPE_ENUM },
  depositFixed: { type: 'number' as const, min: 0 },
  advanceType: { type: 'string' as const, enum: ADVANCE_TYPE_ENUM },
  advanceAmount: { type: 'number' as const, min: 0 },
  releaseHours: { type: 'number' as const, min: 0 },
  defaultPaymentMethod: { type: 'string' as const, enum: PAYMENT_METHOD_ENUM },
  requestReviews: { type: 'boolean' as const },
  publishReviewScore: { type: 'boolean' as const },
  publishReviewComments: { type: 'boolean' as const },
  taxName: { type: 'string' as const, max: 50 },
  taxRate: { type: 'number' as const, min: 0, max: 100 },
  descriptionJson: { type: 'string' as const },
  wifiNetwork: { type: 'string' as const, max: 100 },
  wifiPassword: { type: 'string' as const, max: 100 },
  // F0 0.21 (solmi-direct-booking) — Página pública. Slug estable (namespace público de la
  // landing /h/:slug); amenities del hotel (nivel hotel, distinto de RoomAmenities);
  // descriptionTranslations: { [lang]: { title, description } } — la clave 'es' la rechaza el
  // usecase con assertNoBaseLangKey (el español base vive en descriptionJson). `pattern` cubre
  // el formato y `max` la longitud razonable; uniqueness global la chequea el frontend en vivo
  // y, fallback definitivo, el seeder/endpoint público al resolverlo.
  slug: { type: 'string' as const, pattern: /^[a-z0-9-]+$/, max: 80, message: 'Solo minúsculas, números y guiones' },
  amenities: { type: 'array' as const },
  descriptionTranslations: { type: 'json' as const },
}

export const SetConfigSchema: Record<string, ValidationRule> = {
  clave: { type: 'string' as const, required: true, min: 1, max: 100 },
  // valor puede ser string/number/object (se serializa a JSON en el service) —
  // aceptamos string aquí como mínimo común y dejamos pasar cualquier otro tipo sin coercionar.
  hotelId: { type: 'string' as const, max: 100 },
}

export const HotelesValidator = { create: CreateHotelesSchema, update: UpdateHotelesSchema, setConfig: SetConfigSchema }
