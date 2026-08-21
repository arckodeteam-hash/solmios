import type { ValidationRule } from 'arckode-framework'

const STATUS_ENUM = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']
const CHANNEL_ENUM = ['direct', 'booking', 'airbnb', 'expedia', 'agoda', 'trip', 'phone', 'email', 'walk_in']
const PRECHECKIN_ENUM = ['pending', 'sent', 'completed', 'expired']

export const CreateReservasSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const, required: true },
  roomId: { type: 'string' as const, required: true },
  checkIn: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  checkOut: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  totalAmount: { type: 'number' as const, required: true, min: 0 },
  guestId: { type: 'string' as const },
  channel: { type: 'string' as const, enum: CHANNEL_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  currency: { type: 'string' as const, min: 3, max: 3 },
  adults: { type: 'number' as const, min: 1, max: 20 },
  children: { type: 'number' as const, min: 0, max: 20 },
  deposit: { type: 'number' as const, min: 0 },
  notes: { type: 'string' as const, max: 2000 },
  source: { type: 'string' as const, max: 50 },
  externalLocator: { type: 'string' as const, max: 100 },
  commission: { type: 'number' as const, min: 0, max: 100 },
  commissionAmount: { type: 'number' as const, min: 0 },
  paymentMethod: { type: 'string' as const, max: 50 },
  pendingAmount: { type: 'number' as const, min: 0 },
  autoSendEnabled: { type: 'boolean' as const },
  preCheckinStatus: { type: 'string' as const, enum: PRECHECKIN_ENUM },
  groupId: { type: 'string' as const },
  otaNotes: { type: 'string' as const, max: 2000 },
  depositPercentage: { type: 'number' as const, min: 0, max: 100 },
  depositStatus: { type: 'string' as const },
  ownerNotes: { type: 'string' as const, max: 2000 },
  regime: { type: 'string' as const },
  promoCode: { type: 'string' as const, max: 50 },
  communicateClient: { type: 'string' as const },
  // F3 MisterPlan: condiciones + otros cobros
  gdprAccepted: { type: 'boolean' as const },
  marketingAccepted: { type: 'boolean' as const },
  termsAccepted: { type: 'boolean' as const },
  otherCharges: { type: 'number' as const, min: 0 },
  // Tarjeta de garantía (MisterPlan): datos parciales, sin número completo ni CVV.
  hasGuaranteeCard: { type: 'boolean' as const },
  cardHolder: { type: 'string' as const, max: 100 },
  cardBrand: { type: 'string' as const, max: 20 },
  cardLast4: { type: 'string' as const, max: 4 },
  cardExpMonth: { type: 'string' as const, max: 2 },
  cardExpYear: { type: 'string' as const, max: 4 },
  // ── Precio por temporada (panel) ──
  // `priceFrom:'rates'` = el alta viene del wizard SIN edición manual de precio → el backend
  // recalcula el alojamiento con la cadena season_assignments → room_rates (fuente de verdad
  // server-side, `crud.ts`). `manual`/ausente = comportamiento histórico: `totalAmount` tal cual
  // (reservas OTA con monto pactado, móvil, connectors). `taxesAmount`/`promoDiscountAmount` son
  // los aditamentos NO-lodging que el wizard muestra: el total server-side es
  // `sumStayPrice(...) + taxesAmount - promoDiscountAmount` (el promoCode se re-valida igual).
  priceFrom: { type: 'string' as const, enum: ['rates', 'manual'] },
  taxesAmount: { type: 'number' as const, min: 0 },
  promoDiscountAmount: { type: 'number' as const, min: 0 },
}

/** Body del quote del wizard (POST /api/reservas/quote). `guests` = ocupación tarifada (adultos).
 *  `hotelId` lo inyecta el controller desde el token (solo super_admin puede pisarlo). */
export const StayQuoteSchema: Record<string, ValidationRule> = {
  hotelId: { type: 'string' as const },
  roomId: { type: 'string' as const, required: true },
  checkIn: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  checkOut: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  guests: { type: 'number' as const, min: 1, max: 20 },
}

export const UpdateReservasSchema: Record<string, ValidationRule> = {
  roomId: { type: 'string' as const },
  checkIn: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  checkOut: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  totalAmount: { type: 'number' as const, min: 0 },
  guestId: { type: 'string' as const },
  channel: { type: 'string' as const, enum: CHANNEL_ENUM },
  status: { type: 'string' as const, enum: STATUS_ENUM },
  currency: { type: 'string' as const, min: 3, max: 3 },
  adults: { type: 'number' as const, min: 1, max: 20 },
  children: { type: 'number' as const, min: 0, max: 20 },
  deposit: { type: 'number' as const, min: 0 },
  notes: { type: 'string' as const, max: 2000 },
  source: { type: 'string' as const, max: 50 },
  externalLocator: { type: 'string' as const, max: 100 },
  commission: { type: 'number' as const, min: 0, max: 100 },
  commissionAmount: { type: 'number' as const, min: 0 },
  paymentMethod: { type: 'string' as const, max: 50 },
  pendingAmount: { type: 'number' as const, min: 0 },
  autoSendEnabled: { type: 'boolean' as const },
  preCheckinStatus: { type: 'string' as const, enum: PRECHECKIN_ENUM },
  groupId: { type: 'string' as const },
  otaNotes: { type: 'string' as const, max: 2000 },
  // F3 MisterPlan: condiciones + otros cobros
  gdprAccepted: { type: 'boolean' as const },
  marketingAccepted: { type: 'boolean' as const },
  termsAccepted: { type: 'boolean' as const },
  otherCharges: { type: 'number' as const, min: 0 },
  // Tarjeta de garantía (MisterPlan): datos parciales, sin número completo ni CVV.
  hasGuaranteeCard: { type: 'boolean' as const },
  cardHolder: { type: 'string' as const, max: 100 },
  cardBrand: { type: 'string' as const, max: 20 },
  cardLast4: { type: 'string' as const, max: 4 },
  cardExpMonth: { type: 'string' as const, max: 2 },
  cardExpYear: { type: 'string' as const, max: 4 },
  // PC-8 (2026-08-19): el wizard manda promoCode también al EDITAR; sin esta declaración
  // validateSchema lo descartaba en silencio (cambiar/quitar el código en edición no hacía
  // nada). crud.updateReservation lo valida/consume/libera según cambie.
  promoCode: { type: 'string' as const, max: 50 },
}

export const ReservasValidator = { create: CreateReservasSchema, update: UpdateReservasSchema }

// ── Companions (F2) ──
export const CompanionSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true, min: 2, max: 200 },
  documentType: { type: 'string' as const, enum: ['dni', 'passport', 'other'] },
  documentNumber: { type: 'string' as const, max: 50 },
  nationality: { type: 'string' as const, max: 50 },
  birthDate: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  isMainGuest: { type: 'boolean' as const },
}

// ── Addons (F2) ──
export const AddonSchema: Record<string, ValidationRule> = {
  description: { type: 'string' as const, required: true, min: 2, max: 500 },
  kind: { type: 'string' as const, enum: ['service', 'discount'] },
  amount: { type: 'number' as const, min: 0 },
  quantity: { type: 'number' as const, min: 1, max: 100 },
}

// ── Traza de envío MANUAL al huésped (WhatsApp/SMS/email desde el modal de reserva) ──
// `reference` guarda QUÉ plantilla se usó, no el cuerpo del mensaje (el body puede traer datos
// personales del huésped y `message_logs` no es el lugar para almacenarlos).
//
// Los enums viven acá y SOLO acá: `usecases/message-log.ts` los importa en vez de repetirlos, así
// no puede pasar que el validador acepte un valor que el usecase reescribe por su cuenta.
/** Canales que puede registrar un envío manual desde el panel. */
export const MANUAL_MESSAGE_TYPES = ['whatsapp', 'sms', 'email'] as const
/** El panel sólo puede declarar "abierto/encolado" o "falló al abrir" — nunca `sent`. */
export const MANUAL_MESSAGE_STATUS = ['queued', 'failed'] as const

export const ManualMessageLogSchema: Record<string, ValidationRule> = {
  messageType: { type: 'string' as const, enum: [...MANUAL_MESSAGE_TYPES] },
  recipient: { type: 'string' as const, max: 200 },
  reference: { type: 'string' as const, max: 200 },
  status: { type: 'string' as const, enum: [...MANUAL_MESSAGE_STATUS] },
}

// ── Cancel (F2 plan #627): aplica política de cancelación. reason opcional ──
export const CancelReservationSchema: Record<string, ValidationRule> = {
  reason: { type: 'string' as const, max: 500 },
}

// ── Reschedule (planning): mover/extender reserva ──
// El objeto `charge` se valida aparte con RescheduleChargeSchema (validateSchema no anida objetos).
export const RescheduleSchema: Record<string, ValidationRule> = {
  roomId: { type: 'string' as const },
  checkIn: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  checkOut: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  // 'keep' = respeta el precio pactado (default histórico); 'reprice' = reprecia toda la estadía
  // nueva a la tarifa vigente del cuarto destino. Ver usecases/reschedule.ts.
  pricingMode: { type: 'string' as const, enum: ['keep', 'reprice'] },
  successUrl: { type: 'string' as const, max: 500 },
  cancelUrl: { type: 'string' as const, max: 500 },
}

export const RescheduleChargeSchema: Record<string, ValidationRule> = {
  method: { type: 'string' as const, required: true, enum: ['folio', 'cash', 'card'] },
  amount: { type: 'number' as const, min: 0 },
  reason: { type: 'string' as const, max: 300 },
}

// ── Settlement en checkout (F?): datos financieros del cierre de folio ──
export const SettleSchema: Record<string, ValidationRule> = {
  method: { type: 'string' as const, required: true, max: 50 },
  amount: { type: 'number' as const, required: true, min: 0 },
  reference: { type: 'string' as const, max: 200 },
}

// ── Pre-Checkin (público) ──
// Nombres de campo alineados con lo que MANDA el form público (pre-checkin/index.vue: `name`,
// `document`, no `guestName`/`documentNumber` — con la clave vieja el check nunca se ejecutaba,
// siempre llegaba `undefined` y `validateSchema` lo salteaba en silencio sin validar nada real).
// Solo `name` es obligatorio en la UI (único campo con asterisco) — el resto son opcionales, así
// que quedan sin `required`; el pre-checkin/index.vue del frontend NO manda estos campos cuando
// el huésped los deja vacíos (si mandara `''`, `validateSchema` los toma como presentes y los
// rechaza por `min`/`pattern` aunque sean opcionales — bug real que rompía el submit para
// cualquier huésped que no completara Nacionalidad/Fecha de nacimiento).
// Flujo 8-pasos (prototipo): documentos (address/city/country), contrato+firma, GDPR/marketing.
// `contractAccepted`/`gdprAccepted`/`signature` son obligatorios acá — PERO `required: true` en
// `validateSchema` (kernel/validator.ts) solo exige que el campo esté PRESENTE (no undefined/null);
// un checkbox sin marcar manda `false`, que pasa la validación de tipo boolean limpio. El corte
// real de "no aceptó" vive en `submitPreCheckin` (usecases/pre-checkin.ts), que compara `=== true`
// ANTES de tocar storage o la DB. Este schema es la primera capa (campo presente + tipo correcto).
export const PreCheckinSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, min: 2, required: true },
  email: { type: 'string' as const },
  phone: { type: 'string' as const, max: 30 },
  documentType: { type: 'string' as const, enum: ['dni', 'passport', 'other'] },
  document: { type: 'string' as const, min: 5, max: 50 },
  nationality: { type: 'string' as const, min: 2, max: 50 },
  birthDate: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
  address: { type: 'string' as const, max: 200 },
  city: { type: 'string' as const, max: 100 },
  country: { type: 'string' as const, max: 100 },
  // Data URL base64 de la firma dibujada en el canvas (`data:image/png;base64,...`).
  signature: { type: 'string' as const, required: true },
  contractAccepted: { type: 'boolean' as const, required: true },
  gdprAccepted: { type: 'boolean' as const, required: true },
  marketingAccepted: { type: 'boolean' as const },
}

// ── Pre-Checkin — foto del documento (público) ──
// Sube la foto del documento del titular (escaneada u opcional aun sin OCR exitoso) como
// respaldo para el staff, independiente del submit final. Mismo patrón data-URL que housekeeping.
export const PreCheckinPhotoSchema: Record<string, ValidationRule> = {
  photo: { type: 'string' as const, required: true },
  fileName: { type: 'string' as const },
}
