// hoteles/model.ts — Schema de base de datos del hotel
// Todos los campos según spec de MisterPlan (ANALISIS-MRPLAN.md)
import type { ModelDefinition, ORM } from 'arckode-framework'

export const HotelesModel: ModelDefinition = {
  table: 'hotels',
  fields: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    address: { type: 'string' },
    phone: { type: 'string' },
    email: { type: 'string' },
    country: { type: 'string' },
    currency: { type: 'string', default: 'USD' },
    timezone: { type: 'string', default: 'America/Santo_Domingo' },
    plan: { type: 'string', default: 'professional' },
    status: { type: 'string', default: 'active' },
    roomsCount: { type: 'number', default: 0 },
    active: { type: 'number', default: 1 },
    // Check-in / Check-out
    checkIn: { type: 'string', default: '15:00' },
    checkOut: { type: 'string', default: '12:00' },
    // Políticas
    // cancellationType: la UI ofrecía los 4 valores desde siempre, pero la columna no existía:
    // se mandaba al guardar, la whitelist lo descartaba, y al releer se buscaba con otro nombre
    // ('freeCancellationType', inexistente) → el radio volvía a 'flexible' hiciera lo que hiciera.
    cancellationType: { type: 'string', default: 'flexible' },
    freeCancellation: { type: 'boolean', default: true },
    depositRequired: { type: 'boolean', default: true },
    depositPercent: { type: 'number', default: 30 },
    weekendSurcharge: { type: 'number', default: 15 },
    // Tab 1: Propietario
    ownerName: { type: 'string' },
    ownerTaxId: { type: 'string' },
    deviceEmail: { type: 'string' },
    // Tab 2: Alojamiento
    accommodationType: { type: 'string', default: 'hotel' },
    registrationNumber: { type: 'string' },
    website: { type: 'string' },
    bookingEngineUrl: { type: 'string' },
    phone2: { type: 'string' },
    // WhatsApp PÚBLICO del hotel (#241): el número al que el huésped le escribe desde la
    // confirmación de reserva. Distinto de `phone` (puede ser fijo) y de la línea conectada a
    // Meta (`ai-recepcionista`, es de la IA y el hotel no siempre quiere publicarla). Se edita en
    // Página pública → General junto a phone/email; vacío = no se muestra el botón.
    whatsapp: { type: 'string' },
    warningPhone: { type: 'string' },
    secondaryCurrency: { type: 'string' },
    youtubeUrl: { type: 'string' },
    starRating: { type: 'string' },
    onlineBookingStatus: { type: 'string', default: 'active' },
    motorVersion: { type: 'string', default: 'v1' },
    // Tab 4: Localización
    latitude: { type: 'number', default: 0 },
    longitude: { type: 'number', default: 0 },
    province: { type: 'string' },
    municipality: { type: 'string' },
    locality: { type: 'string' },
    postalCode: { type: 'string' },
    // Condiciones adicionales
    cleaningType: { type: 'string', default: 'checkout' },
    depositType: { type: 'string', default: 'none' },
    depositFixed: { type: 'number', default: 0 },
    advanceType: { type: 'string', default: 'percentage' },
    advanceAmount: { type: 'number', default: 0 },
    releaseHours: { type: 'number', default: 0 },
    defaultPaymentMethod: { type: 'string', default: 'transfer' },
    // Reseñas
    requestReviews: { type: 'boolean', default: false },
    publishReviewScore: { type: 'boolean', default: false },
    publishReviewComments: { type: 'boolean', default: false },
    // Impuestos
    taxName: { type: 'string', default: 'ITBIS' },
    taxRate: { type: 'number', default: 18.0 },
    // Multilingüe
    descriptionJson: { type: 'string' },
    // WiFi (para auto-mensajes)
    wifiNetwork: { type: 'string' },
    wifiPassword: { type: 'string' },
    // Branding
    logo: { type: 'string' },
    // F0 — Direct booking / Página pública (openspec/changes/solmi-direct-booking).
    // Anti-patrón ORM (D5): las 3 columnas MUST estar declaradas acá, case-sensitive —
    // sin declaración, el ORM las descarta silenciosamente al persistir (mem 1805).
    // slug: estable, NO computado del name en runtime. Nullable: se puebla con seeder
    // idempotente (scripts/seed-hotel-slugs.ts). Unique global (namespace público,
    // GET /api/public/hotels/:slug). Editar `name` NUNCA cambia `slug` automáticamente.
    slug: { type: 'string' },
    // Amenities DEL HOTEL (pool/gym/spa/parking/wifi/restaurant/bar/...) — DISTINTO de
    // RoomAmenities (nivel habitaciones). Array de strings del catálogo fijo en código
    // (mismo patrón que ALLERGEN_TAGS del módulo restaurant).
    amenities: { type: 'json' },
    // Multilingüe de la descripción pública: { [lang]: { title, description } }. NUNCA
    // incluye 'es' (el español base vive en `descriptionJson` arriba — D7, dos fuentes
    // de verdad). Mismo formato que menu_items.translations (restaurant/model.ts:57).
    // type:'json' nativo del ORM serializa/deserializa solo; nullable, sin default.
    descriptionTranslations: { type: 'json' },
  },
  timestamps: true,
}

export function registerHotelesModels(orm: ORM): void {
  orm.define('Hotels', HotelesModel)
}
