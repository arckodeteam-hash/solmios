// bookingengine/model.ts — Schema de base de datos
// F4 4.2 — Modelo legacy de stock diario BORRADO (tabla + repo + constructor param).
// La disponibilidad se calcula live desde Rooms + Reservations (ver usecases/availability.ts).
// 2 tablas restantes: BookingConfig (config widget) + ConversionEvents (analytics legacy).

import type { ModelDefinition, ORM } from 'arckode-framework'

export const BookingConfigModel: ModelDefinition = {
  table: 'booking_config',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    enabled: { type: 'boolean', default: true },
    theme: { type: 'string', default: 'navy' },
    position: { type: 'string', default: 'corner' },
    currency: { type: 'string', default: 'USD' },
    language: { type: 'string', default: 'es' },
    minNights: { type: 'number', default: 1 },
    maxNights: { type: 'number', default: 30 },
    cancellationPolicy: { type: 'string', default: 'flexible' },
    showComparison: { type: 'boolean', default: true },
    googleAdsEnabled: { type: 'boolean', default: false },
    whatsappConfirmation: { type: 'boolean', default: false },
    instantConfirmation: { type: 'boolean', default: true },
    stripeAccountId: { type: 'string', default: '' },
    allowedCountries: { type: 'json', default: [] },
    // #266 — Minutos para completar el pago de una reserva web (15–1440, default 60).
    // Reemplaza `pendingPaymentTtlHours` de #248: la columna vieja queda huérfana en DB
    // (RUN_MIGRATE no borra columnas) y ya no se lee.
    pendingTtlMinutes: { type: 'number', default: 60 },
    // #271 MR-06 — Horas que el hotel se da para aprobar/rechazar una reserva web con
    // "confirmación instantánea" apagada (1–168, default 24). La pantalla pública se lo
    // muestra al huésped y el cron de recordatorio lo usa como plazo.
    approvalDeadlineHours: { type: 'number', default: 24 },
    // #262 REQ-HAC-07 — Horas antes de la llegada a partir de las cuales el cron de pase
    // pre-llegada asigna automáticamente la habitación sugerida a una reserva sin habitación
    // (0–168; 0 = apagado, manda pase parcial "por asignar").
    autoAssignBeforeArrivalHours: { type: 'number', default: 0 },
  },
}

export const ConversionEventsModel: ModelDefinition = {
  table: 'conversion_events',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    sessionId: { type: 'string', required: true },
    event: { type: 'string', required: true },
    roomType: { type: 'string' },
    amount: { type: 'number' },
    source: { type: 'string' },
    utmSource: { type: 'string' },
    utmMedium: { type: 'string' },
    utmCampaign: { type: 'string' },
    device: { type: 'string' },
    country: { type: 'string' },
  },
}

// Booking público generado por el motor de reservas (POST /api/public/bookings).
// Sin este modelo, `new OrmRepository(orm, 'BookingEngine')` en index.ts referencia
// un modelo inexistente → createBooking/getBooking crashean en runtime.
export const PublicBookingModel: ModelDefinition = {
  table: 'public_bookings',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    roomType: { type: 'string' },
    roomId: { type: 'string', indexed: true },
    guestName: { type: 'string' },
    guestEmail: { type: 'string' },
    guestPhone: { type: 'string' },
    checkIn: { type: 'string', indexed: true },
    checkOut: { type: 'string' },
    adults: { type: 'number', default: 1 },
    children: { type: 'number', default: 0 },
    totalAmount: { type: 'number', default: 0 },
    currency: { type: 'string', default: 'USD' },
    status: { type: 'string', default: 'pending', indexed: true },
    paymentStatus: { type: 'string', default: 'unpaid' },
    paymentRef: { type: 'string', default: '' },
    promoCode: { type: 'string', default: '' },
  },
}

// F2 2.3 (spec booking-widget) — Upsells: extras del widget de reservas (desayuno,
// transfer, late checkout). Modelo `Upsells`, tabla `upsells`. Vive como sub-dominio
// de bookingengine (no es módulo aparte): comparte hotelId y se gestiona desde el
// panel del hotel junto con la config del motor.
//
// Anti-patrón ORM (mem 1805): TODO campo persistido por service/DTO/validator está
// declarado acá — case-sensitive (`sortOrder` ≠ `sortorder`). `kind` se valida en el
// usecase (enum cerrado). `price` se guarda en la MONEDA DEL HOTEL (multi-moneda F2
// es display-only, el cobro siempre es en hotels.currency).
export const UpsellModel: ModelDefinition = {
  table: 'upsells',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    // 'Desayuno buffet', 'Transfer aeropuerto', 'Late checkout', etc.
    name: { type: 'string', required: true },
    // Descripción marketing para mostrar en el widget (opcional).
    description: { type: 'text' },
    // Precio en la moneda del hotel. >=0 validado en el usecase.
    price: { type: 'number', required: true },
    // 'per_room' | 'per_person' | 'per_stay' | 'per_night' | 'per_person_per_night' — cómo se
    // multiplica (qty/huésped/noche). Los dos últimos son de MR-10 (#275); enum cerrado en
    // `types.ts#UpsellKind`, matemática en `usecases/upsell-pricing.ts`.
    kind: { type: 'string', required: true },
    // Toggle visible desde el panel sin borrar. Default 1 (activo).
    active: { type: 'boolean', default: true },
    // Orden dentro del hotel para el step de upsells del widget. Default 0.
    sortOrder: { type: 'number', default: 0 },
  },
}

// tasks.md 2.2/2.4 (solmi-direct-booking-qa-fixes) — Regímenes de alimentación: catálogo FIJO
// de 3 códigos configurables por hotel (no es un catálogo abierto como `upsells` — el hotel no
// inventa nombres, solo activa/desactiva y fija precio de cada uno de los 3). "Solo alojamiento"
// es la base implícita (siempre disponible, sin costo) — no tiene fila acá.
//
// Separado de `Upsells` a propósito (decisión de producto 2026-08-22, ver
// specs/booking-content-policies/spec.md): el régimen es una elección ÚNICA por habitación
// (reemplaza la base), los extras son selección MÚLTIPLE — mezclarlos en la misma tabla
// obligaría a que el widget distinga "de elegir uno" vs. "de sumar varios" desde un solo campo.
// Mismo criterio arquitectónico que `Upsells` sí: sub-dominio de bookingengine, no módulo aparte.
export const MealPlanModel: ModelDefinition = {
  table: 'meal_plans',
  timestamps: true,
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    // 'breakfast' | 'half_board' | 'all_inclusive' — enum cerrado, validado en el usecase.
    code: { type: 'string', required: true },
    // Toggle: ¿el hotel ofrece este régimen? Default false (el hotel lo activa a propósito).
    active: { type: 'boolean', default: false },
    // 'included' (ya está en la tarifa, sin cargo aparte) | 'per_person_per_night' (con costo).
    priceMode: { type: 'string', default: 'included' },
    // Precio por persona por noche, en la moneda del hotel. Solo aplica si priceMode='per_person_per_night'.
    price: { type: 'number', default: 0 },
  },
}

export function registerBookingengineModels(orm: ORM): void {
  orm.define('BookingConfig', BookingConfigModel)
  orm.define('ConversionEvents', ConversionEventsModel)
  orm.define('BookingEngine', PublicBookingModel)
  // F2 2.3 (spec booking-widget) — Upsells: extras del widget público (desayuno, transfer,
  // late checkout). Sub-dominio de bookingengine: comparte hotelId, NO amerita módulo
  // aparte. Dueño: este modelo (NO definir en shared/models.ts — regla anti-modelo-dual).
  orm.define('Upsells', UpsellModel)
  orm.define('MealPlans', MealPlanModel)
  // #292 — `ChildAmenities` (catálogo global de amenidades para niños/bebés, REQ-01 #233) se dio
  // de baja: las amenidades salen SÓLO por habitación (`RoomAmenities`, #290). La tabla
  // `child_amenities` queda huérfana sin migración que la dropee; el snapshot histórico vive en
  // `Reservations.childAmenities`.
}
