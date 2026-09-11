// restaurant/types.ts — Contrato TypeScript del módulo (API). El schema de DB vive en model.ts.

export type OrderType = 'dine_in' | 'room_service' | 'takeaway'
// 'processing_payment' (fix-refund-pos-card): cobro con tarjeta esperando la confirmación async del
// webhook de Stripe (Checkout Session abierta). Transitorio entre 'billed' y 'paid' — nunca lo fija
// el cliente, solo payOrder(card)/settlePaidOrder/unsettleOrder.
export type OrderStatus =
  | 'open' | 'sent' | 'preparing' | 'ready' | 'served' | 'billed' | 'charged' | 'paid' | 'cancelled' | 'refunded'
  | 'processing_payment'
// 'voided' (#207): anulada CON motivo después de enviada a cocina. Se conserva en la comanda (tachada)
// pero no cuenta en totales ni en el KDS. 'cancelled' queda como estado legacy (filas anteriores a #207).
export type LineStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'voided'
export type TableStatus = 'free' | 'occupied' | 'reserved'
export type Settlement = 'folio' | 'payment'

// F5 — catálogo FIJO de tags de alérgenos/info dietética (D8, specs/menu-allergens/spec.md). En inglés
// (DB/código en inglés); la UI traduce cada key a su etiqueta en español. NO tabla nueva, mismo patrón
// que OrderType/LineStatus de arriba.
export const ALLERGEN_TAGS = [
  'gluten', 'lactose', 'nuts', 'shellfish', 'egg', 'soy', 'spicy', 'vegan', 'vegetarian', 'gluten_free',
] as const
export type AllergenTag = typeof ALLERGEN_TAGS[number]

export interface StationDTO {
  id: string
  hotelId: string
  name: string
  active?: number
  sortOrder?: number
  /** #211 — umbral de demora del KDS en minutos (ámbar a N, rojo a 2N). Null = default 10. */
  alertMinutes?: number | null
  createdAt: string
  updatedAt: string
}

// F4 — mapa de traducciones por idioma. NUNCA incluye la clave 'es' (el español vive en los campos
// base name/description, D7 — ver specs/menu-i18n/spec.md). Categoría solo traduce `name` (no tiene
// `description`); ítem/combo traducen `name` + `description`.
export interface CategoryTranslation { name?: string }
export interface ItemTranslation { name?: string; description?: string }

export interface CategoryDTO {
  id: string
  hotelId: string
  name: string
  stationId?: string
  sortOrder?: number
  active?: number
  // F4 — undefined cuando se pide con `?lang=` resuelto (no duplicar payload, ver usecases/i18n.ts).
  translations?: Record<string, CategoryTranslation> | null
  createdAt: string
  updatedAt: string
}

export interface MenuItemDTO {
  id: string
  hotelId: string
  categoryId: string
  name: string
  description?: string
  price: number
  taxRate?: number
  stationId?: string
  available?: number
  imageUrl?: string
  sortOrder?: number
  hasRecipe?: boolean
  // F4 — undefined cuando se pide con `?lang=` resuelto (no duplicar payload, ver usecases/i18n.ts).
  translations?: Record<string, ItemTranslation> | null
  // F5 — tags de alérgenos/info dietética del catálogo fijo ALLERGEN_TAGS. null/ausente = sin declarar.
  allergens?: AllergenTag[] | null
  // F6 — "plato del día"/recomendado. Informativo, sin regla de negocio.
  featured?: number
  // F6 — franja horaria "HH:mm". Ambos null/undefined = sin restricción horaria (compat retro).
  availableFrom?: string | null
  availableTo?: string | null
  // F6 — DERIVADO, solo en listItems/getItem: available=1 AND dentro de franja (si tiene una
  // configurada). El frontend SOLO lee este booleano, nunca reimplementa la lógica de franja.
  availableNow?: boolean
  createdAt: string
  updatedAt: string
}

export interface TableDTO {
  id: string
  hotelId: string
  name: string
  zone?: string
  capacity?: number
  status: TableStatus
  createdAt: string
  updatedAt: string
}

export interface OrderDTO {
  id: string
  hotelId: string
  number?: string
  type: OrderType
  tableId?: string
  reservationId?: string
  guestId?: string
  roomId?: string
  waiterId?: string
  status: OrderStatus
  subtotal: number
  tax: number
  tip: number
  total: number
  settlement?: Settlement
  folioId?: string
  paymentId?: string
  openedAt?: string
  closedAt?: string
  // #210 — comensales (cubiertos). Solo en comandas `dine_in` (default 1); undefined en el resto.
  covers?: number
  // #209 — SOLO LECTURA, no son columnas: los calcula usecases/order-labels.ts para room service
  // ("Hab. 204 · Pérez"). Nunca se mandan a `orders.update` (el ORM los descartaría en silencio).
  roomNumber?: string
  guestName?: string
  createdAt: string
  updatedAt: string
}

// F1 — snapshot de una opción elegida, congelado en la línea (sobrevive a editar/borrar el modificador).
// inventoryItemId/inventoryQuantity viajan acá (no solo en menu_item_modifiers) para que
// `consumeForSaleWithModifiers` (inventario/usecases/recipes.ts) los lea directo de la línea sin
// cross-importar del módulo restaurant — el conector solo delega la línea completa (D2, design.md).
export interface OrderItemModifierSnapshot {
  groupId: string
  groupName: string
  modifierId: string
  name: string
  priceDelta: number
  inventoryItemId?: string
  inventoryQuantity?: number
}

export interface OrderItemDTO {
  id: string
  hotelId: string
  orderId: string
  menuItemId?: string
  name: string
  unitPrice: number
  quantity: number
  notes?: string
  taxRate?: number
  stationId?: string
  stationName?: string
  status: LineStatus
  lineTotal: number
  // F1: snapshot de modificadores elegidos, en la MISMA fila (no sub-líneas). null/ausente = sin modificadores.
  modifiers?: OrderItemModifierSnapshot[] | null
  // F2 — 'item' (default, retrocompat) | 'combo_header' | 'combo_component'. Ver model.ts.
  kind?: 'item' | 'combo_header' | 'combo_component'
  // F2 — solo en filas kind='combo_header': FK lógica a menu_combos.id.
  comboId?: string
  // F2 — solo en filas kind='combo_component': FK lógica (self) a la fila combo_header hermana.
  parentLineId?: string
  // #210 — ISO del envío a cocina. undefined = agregada después de enviar y todavía sin confirmar
  // (sigue en `status:'new'`, que por sí solo no distingue "recién cargada" de "ya despachada").
  sentAt?: string
  // #207 — solo en filas status='voided': motivo, quién (users.id) y cuándo se anuló.
  voidReason?: string
  voidedBy?: string
  voidedAt?: string
  createdAt: string
  updatedAt: string
}

// F1 — Grupo de modificadores de un ítem (ej. "Tamaño").
export type ModifierSelectionType = 'single' | 'multiple'
export interface ModifierGroupDTO {
  id: string
  hotelId: string
  menuItemId: string
  name: string
  selectionType: ModifierSelectionType
  required?: number
  minSelect?: number
  maxSelect?: number
  sortOrder?: number
  // Derivado (no persistido en menu_item_modifier_groups): sus opciones, adjuntadas por listGroups
  // (mismo patrón que MenuItemDTO.hasRecipe). undefined si no fue enriquecido por ese usecase.
  modifiers?: ModifierDTO[]
  createdAt: string
  updatedAt: string
}

// F1 — Opción de un grupo de modificadores (ej. "Grande", "+tocino").
export interface ModifierDTO {
  id: string
  hotelId: string
  groupId: string
  name: string
  priceDelta: number
  inventoryItemId?: string
  inventoryQuantity?: number
  active?: number
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

// F2 — Componente de un combo (ej. 2× Hamburguesa dentro de "Combo Familiar").
export interface ComboItemDTO {
  id: string
  hotelId: string
  comboId: string
  menuItemId: string
  quantity: number
  sortOrder?: number
  createdAt: string
  updatedAt: string
}

// F2 — Combo/paquete de la carta. `price` es NETO propio del combo (no la suma de sus componentes).
export interface ComboDTO {
  id: string
  hotelId: string
  name: string
  description?: string
  price: number
  taxRate?: number
  imageUrl?: string
  available?: number
  sortOrder?: number
  // Derivado (no persistido en menu_combos): sus componentes, adjuntados por listCombos/getCombo
  // (mismo patrón que ModifierGroupDTO.modifiers). undefined si no fue enriquecido por ese usecase.
  items?: ComboItemDTO[]
  // F4 — undefined cuando se pide con `?lang=` resuelto (no duplicar payload, ver usecases/i18n.ts).
  translations?: Record<string, ItemTranslation> | null
  // F5 — DERIVADO (no persistido en menu_combos, NUNCA aceptado en el body): unión de los allergens
  // de todos sus componentes, calculada por listCombos/getCombo. undefined si no fue enriquecido.
  allergens?: AllergenTag[]
  createdAt: string
  updatedAt: string
}

// Usuario autenticado del JWT (req.user). Para ownership (IDOR) y forzar hotelId.
export interface CurrentUser {
  id: string
  hotelId?: string | null
  role?: string
  /** Permisos efectivos del rol (`module:action`), cargados por loadPermissions. Los usa
   *  `removeLine` (#205) para exigir `restaurant:delete` solo cuando la comanda ya fue enviada. */
  permissions?: string[]
}
