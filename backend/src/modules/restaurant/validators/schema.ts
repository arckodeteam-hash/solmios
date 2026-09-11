import type { BodyRule as ValidationRule } from '../../../shared/validators/validate-body'

// validateSchema devuelve SOLO los campos declarados acá (los demás se descartan en silencio, mem 1805).

// ─── Estaciones (RES-0) ───
export const CreateStationSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true },
  active: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
  alertMinutes: { type: 'number' as const },   // #211 — rango 1..180 validado en stations-crud.ts
  autoPrint: { type: 'boolean' as const },     // #216 — impresión automática de la comanda de cocina al enviar
}

export const UpdateStationSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const },
  active: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
  alertMinutes: { type: 'number' as const },
  autoPrint: { type: 'boolean' as const },
}

// ─── Carta: categorías (RES-1) ───
export const CreateCategorySchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true },
  stationId: { type: 'string' as const },
  sortOrder: { type: 'number' as const },
  active: { type: 'number' as const },
  // F4 — { [langCode]: { name } }. Forma validada acá (objeto/array); la clave 'es' prohibida y el
  // contenido se validan en el usecase (categories-crud.ts), que sí puede inspeccionar las keys.
  translations: { type: 'json' as const },
}
export const UpdateCategorySchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const },
  stationId: { type: 'string' as const },
  sortOrder: { type: 'number' as const },
  active: { type: 'number' as const },
  translations: { type: 'json' as const },
}

// ─── Carta: ítems (RES-1) ───
export const CreateItemSchema: Record<string, ValidationRule> = {
  categoryId: { type: 'string' as const, required: true },
  name: { type: 'string' as const, required: true },
  description: { type: 'text' as const },
  price: { type: 'number' as const, required: true },
  taxRate: { type: 'number' as const },
  stationId: { type: 'string' as const },
  available: { type: 'number' as const },
  imageUrl: { type: 'string' as const },
  sortOrder: { type: 'number' as const },
  // F4 — { [langCode]: { name?, description? } }. Forma validada acá; clave 'es' prohibida en el
  // usecase (items-crud.ts).
  translations: { type: 'json' as const },
  // F5 — tags de alérgenos/info dietética. Forma validada acá (array); cada elemento se valida contra
  // ALLERGEN_TAGS en el usecase (items-crud.ts:assertAllergens).
  allergens: { type: 'array' as const },
  // F6 — destacado + franja horaria. Formato "HH:mm" y regla todo-o-nada validados en el usecase
  // (items-crud.ts:assertTimeWindow), acá solo la forma (número/string).
  featured: { type: 'number' as const },
  availableFrom: { type: 'string' as const },
  availableTo: { type: 'string' as const },
}
export const UpdateItemSchema: Record<string, ValidationRule> = {
  categoryId: { type: 'string' as const },
  name: { type: 'string' as const },
  description: { type: 'text' as const },
  price: { type: 'number' as const },
  taxRate: { type: 'number' as const },
  stationId: { type: 'string' as const },
  available: { type: 'number' as const },
  imageUrl: { type: 'string' as const },
  sortOrder: { type: 'number' as const },
  translations: { type: 'json' as const },
  allergens: { type: 'array' as const },
  featured: { type: 'number' as const },
  availableFrom: { type: 'string' as const },
  availableTo: { type: 'string' as const },
}
export const AvailabilitySchema: Record<string, ValidationRule> = {
  available: { type: 'number' as const },
}

// ─── Mesas (RES-2) ───
const TABLE_STATUSES = ['free', 'occupied', 'reserved']
export const CreateTableSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true },
  zone: { type: 'string' as const },
  capacity: { type: 'number' as const },
  status: { type: 'string' as const, enum: TABLE_STATUSES },
}
export const UpdateTableSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const },
  zone: { type: 'string' as const },
  capacity: { type: 'number' as const },
  status: { type: 'string' as const, enum: TABLE_STATUSES },
}

// ─── Comandas (RES-3) ───
const ORDER_TYPES = ['dine_in', 'room_service', 'takeaway']
export const OpenOrderSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, required: true, enum: ORDER_TYPES },
  tableId: { type: 'string' as const },
  reservationId: { type: 'string' as const },
  guestId: { type: 'string' as const },
  roomId: { type: 'string' as const },
  waiterId: { type: 'string' as const },
  // #210 — comensales. El rango (entero 1..200) lo valida el usecase `openOrder`: el schema no
  // distingue entero de decimal, y el default por tipo de comanda es regla de negocio.
  covers: { type: 'number' as const },
}
export const AddLineSchema: Record<string, ValidationRule> = {
  // F2: menuItemId ya NO es required a nivel schema — un combo llega con comboId en su lugar.
  // El schema no puede expresar XOR entre menuItemId/comboId (D3, design.md); esa regla ("exactamente
  // uno de los dos, nunca ambos, nunca ninguno") la enforza el usecase addLine (order-lines.ts).
  menuItemId: { type: 'string' as const },
  comboId: { type: 'string' as const },
  quantity: { type: 'number' as const },
  notes: { type: 'text' as const },
  // F1: opciones elegidas ({ modifierId }[]). El validator NO valida required/minSelect/maxSelect
  // de grupo (eso vive en el usecase, order-lines.ts) — acá solo la forma del array.
  modifiers: { type: 'array' as const },
}
export const UpdateLineSchema: Record<string, ValidationRule> = {
  quantity: { type: 'number' as const },
  notes: { type: 'text' as const },
}

// ─── F1: modificadores/variantes de la carta ───
const SELECTION_TYPES = ['single', 'multiple']
export const CreateModifierGroupSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true },
  selectionType: { type: 'string' as const, enum: SELECTION_TYPES },
  required: { type: 'number' as const },
  minSelect: { type: 'number' as const },
  maxSelect: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
}
export const UpdateModifierGroupSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const },
  selectionType: { type: 'string' as const, enum: SELECTION_TYPES },
  required: { type: 'number' as const },
  minSelect: { type: 'number' as const },
  maxSelect: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
}
export const CreateModifierSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true },
  priceDelta: { type: 'number' as const, required: true },
  inventoryItemId: { type: 'string' as const },
  inventoryQuantity: { type: 'number' as const },
  active: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
}
export const UpdateModifierSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const },
  priceDelta: { type: 'number' as const },
  inventoryItemId: { type: 'string' as const },
  inventoryQuantity: { type: 'number' as const },
  active: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
}

// ─── F2: combos/paquetes ───
// `items` viaja como array de { menuItemId, quantity, sortOrder? } — el validator solo valida la
// forma (array); menuItemId de cada componente y su ownership (mismo hotel) se validan en el usecase
// (combos-crud.ts:assertComponent), igual patrón que items-crud.ts:assertCategory.
// F5 — `allergens` NO se declara acá a propósito: un combo NUNCA tiene allergens propio, se deriva de
// sus componentes al leer (combos-crud.ts). Si llega en el body, el whitelist de validateSchema lo
// descarta en silencio (mem 1805) — comportamiento esperado, no un bug.
export const CreateComboSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const, required: true },
  description: { type: 'text' as const },
  price: { type: 'number' as const, required: true },
  taxRate: { type: 'number' as const },
  imageUrl: { type: 'string' as const },
  available: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
  items: { type: 'array' as const, required: true },
  // F4 — { [langCode]: { name?, description? } }. Forma validada acá; clave 'es' prohibida en el
  // usecase (combos-crud.ts).
  translations: { type: 'json' as const },
}
export const UpdateComboSchema: Record<string, ValidationRule> = {
  name: { type: 'string' as const },
  description: { type: 'text' as const },
  price: { type: 'number' as const },
  taxRate: { type: 'number' as const },
  imageUrl: { type: 'string' as const },
  available: { type: 'number' as const },
  sortOrder: { type: 'number' as const },
  items: { type: 'array' as const },
  translations: { type: 'json' as const },
}

// ─── Cuenta + cobro (RES-5) ───
export const BillSchema: Record<string, ValidationRule> = {
  tip: { type: 'number' as const },
}
export const ChargeToRoomSchema: Record<string, ValidationRule> = {
  reservationId: { type: 'string' as const },
}
// #205: los métodos que el POS cobra. Espejo de `PAYMENT_METHODS` en frontend/src/services/Caja.service.ts.
// Sin el enum, "xyz" llegaba a `payments.createPayment` como un cobro `completed`.
export const POS_PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const
export const PaySchema: Record<string, ValidationRule> = {
  method: { type: 'string' as const, required: true, enum: [...POS_PAYMENT_METHODS] },
  // fix-refund-pos-card: obligatorios SOLO para method==='card' (Stripe Checkout Session). El schema
  // no valida condicional-por-campo; el usecase (`settlement.payOrder`) rechaza con ValidationError si
  // faltan y el método es 'card'. cash/transfer los ignoran.
  successUrl: { type: 'string' as const },
  cancelUrl: { type: 'string' as const },
}

// ─── Dividir cuenta / pagos parciales (#214) ───
// `room` además de los métodos del POS: una parte puede ir al folio de una reserva (`reservationId`).
// `amount` no es required: con `lineIds` el usecase lo calcula de las líneas (y si viene, tiene que coincidir).
export const ORDER_PAYMENT_METHODS = [...POS_PAYMENT_METHODS, 'room'] as const
export const AddOrderPaymentSchema: Record<string, ValidationRule> = {
  method: { type: 'string' as const, required: true, enum: [...ORDER_PAYMENT_METHODS] },
  amount: { type: 'number' as const },
  tip: { type: 'number' as const },
  reservationId: { type: 'string' as const },
  lineIds: { type: 'array' as const },
  successUrl: { type: 'string' as const },
  cancelUrl: { type: 'string' as const },
}

// ─── KDS (RES-4) ───
// #207: 'cancelled' ya no es un estado que cocina pueda fijar — sacar un plato enviado es
// POST /orders/:id/items/:lineId/void con motivo (VoidLineSchema).
const LINE_STATUSES = ['new', 'preparing', 'ready', 'served']
export const KdsLineStatusSchema: Record<string, ValidationRule> = {
  status: { type: 'string' as const, required: true, enum: LINE_STATUSES },
}

// ─── Anulaciones con motivo (#207) ───
// `text` (no `string`) para que un motivo "Otro" tipeado a mano no quede truncado por un límite de
// VARCHAR; el usecase exige que no venga vacío.
export const VoidLineSchema: Record<string, ValidationRule> = {
  reason: { type: 'text' as const, required: true, min: 1, max: 500 },
}
export const CancelOrderSchema: Record<string, ValidationRule> = {
  reason: { type: 'text' as const, required: true, min: 1, max: 500 },
}
// POST /orders/:id/refund y /orders/:id/payments/:partId/refund (#214): la devolución de un cobro directo
// (efectivo/transferencia incluidos) exige motivo — sin él, una devolución en mano es un faltante de caja sin dueño.
export const RefundOrderSchema: Record<string, ValidationRule> = {
  reason: { type: 'text' as const, required: true, min: 1, max: 500 },
}
// Motivos predefinidos del hotel (configuration('restaurant_void_reasons')). Array de strings.
export const VoidReasonsSchema: Record<string, ValidationRule> = {
  reasons: { type: 'array' as const, required: true, min: 1 },
}

// ─── Descuentos y cortesías (#215) ───
// `type` enum, `value` > 0 (y ≤ 100 si percent — lo valida el usecase, que también aplica el tope por
// rol), `reason` obligatorio: sin motivo el descuento es un faltante de caja sin dueño.
export const DISCOUNT_TYPES = ['percent', 'amount'] as const
export const DiscountSchema: Record<string, ValidationRule> = {
  type: { type: 'string' as const, required: true, enum: [...DISCOUNT_TYPES] },
  value: { type: 'number' as const, required: true },
  reason: { type: 'text' as const, required: true, min: 1, max: 500 },
}
// Política del hotel: tope (0..100, lo acota el usecase) y/o motivos predefinidos.
export const DiscountPolicySchema: Record<string, ValidationRule> = {
  maxDiscountPercent: { type: 'number' as const, min: 0, max: 100 },
  reasons: { type: 'array' as const, min: 1 },
}

export const RestaurantValidator = { createStation: CreateStationSchema, updateStation: UpdateStationSchema }
