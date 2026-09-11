// services/Restaurant.service.ts — Cliente API del POS de restaurante (RES-7).
// Interfaces del dominio inline (convención de módulos nuevos). El http client desenvuelve el envelope
// del framework y inyecta el token/hotelId por JWT; acá NUNCA se toca el token. Backend: /api/restaurant/*.
import { http } from './http'
import type { PosPaymentMethod } from './Caja.service'

// ─── Tipos del dominio (espejo de backend/src/modules/restaurant/types.ts) ───
export type OrderType = 'dine_in' | 'room_service' | 'takeaway'
// 'processing_payment' (fix-refund-pos-card): cobro con tarjeta esperando la confirmación async del
// webhook de Stripe (Checkout Session abierta). Ver cobrar.vue: poll a GET /orders/:id hasta 'paid'.
export type OrderStatus =
  | 'open' | 'sent' | 'preparing' | 'ready' | 'served' | 'billed' | 'charged' | 'paid' | 'refunded' | 'cancelled'
  | 'processing_payment'
// 'voided' (#207): anulada CON motivo después de enviada a cocina — queda en la comanda tachada, no cuenta.
export type LineStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled' | 'voided'
export type TableStatus = 'free' | 'occupied' | 'reserved'
export type Settlement = 'folio' | 'payment'

// F5 — catálogo FIJO de tags de alérgenos/info dietética (espejo de backend/src/modules/restaurant/types.ts,
// D8). En inglés (DB/código); acá se traduce cada key a su etiqueta en español + ícono para la UI.
export const ALLERGEN_TAGS = [
  'gluten', 'lactose', 'nuts', 'shellfish', 'egg', 'soy', 'spicy', 'vegan', 'vegetarian', 'gluten_free',
] as const
export type AllergenTag = typeof ALLERGEN_TAGS[number]
export const ALLERGEN_LABELS: Record<AllergenTag, string> = {
  gluten: '🌾 Gluten',
  lactose: '🥛 Lactosa',
  nuts: '🥜 Frutos secos',
  shellfish: '🦐 Mariscos',
  egg: '🥚 Huevo',
  soy: '🌿 Soja',
  spicy: '🌶️ Picante',
  vegan: '🌱 Vegano',
  vegetarian: '🥕 Vegetariano',
  gluten_free: '🚫🌾 Sin gluten',
}
export const ALLERGEN_OPTIONS = ALLERGEN_TAGS.map((value) => ({ value, label: ALLERGEN_LABELS[value] }))

export interface Station {
  id: string
  hotelId: string
  name: string
  active?: number
  sortOrder?: number
  /** #211 — minutos desde el envío a cocina para pintar el ticket ámbar (rojo al doble). Null = DEFAULT_ALERT_MINUTES. */
  alertMinutes?: number | null
  createdAt?: string
  updatedAt?: string
}

/** #211 — umbral de demora por defecto del KDS (espejo de backend stations-crud.ts). */
export const DEFAULT_ALERT_MINUTES = 10

// F4 — mapa de traducciones por idioma (espejo de backend/src/modules/restaurant/types.ts).
// NUNCA incluye la clave 'es' (el español vive en name/description, D7). Categoría solo traduce
// `name` (no tiene `description`); ítem/combo traducen `name` + `description`.
export interface CategoryTranslation { name?: string }
export interface ItemTranslation { name?: string; description?: string }

export interface MenuCategory {
  id: string
  hotelId: string
  name: string
  stationId?: string
  sortOrder?: number
  active?: number
  // F4 — undefined cuando se pidió con `?lang=` resuelto (el backend no duplica el payload).
  translations?: Record<string, CategoryTranslation> | null
  createdAt?: string
  updatedAt?: string
}

export interface MenuItem {
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
  // F4 — undefined cuando se pidió con `?lang=` resuelto (el backend no duplica el payload).
  translations?: Record<string, ItemTranslation> | null
  // F5 — tags de alérgenos/info dietética del catálogo fijo ALLERGEN_TAGS. null/ausente = sin declarar.
  allergens?: AllergenTag[] | null
  // F6 — "plato del día"/recomendado (sin regla de negocio) + franja horaria "HH:mm" (null/ausente =
  // sin restricción). `availableNow` es DERIVADO por el backend, solo lectura (nunca se reimplementa).
  featured?: number
  availableFrom?: string | null
  availableTo?: string | null
  availableNow?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface RestaurantTable {
  id: string
  hotelId: string
  name: string
  zone?: string
  capacity?: number
  status: TableStatus
  createdAt?: string
  updatedAt?: string
}

// F1 — snapshot de una opción elegida, congelado en la línea (sobrevive a editar/borrar el modificador).
export interface OrderLineModifierSnapshot {
  groupId: string
  groupName: string
  modifierId: string
  name: string
  priceDelta: number
  inventoryItemId?: string
  inventoryQuantity?: number
}

export interface OrderLine {
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
  // F1: modificadores elegidos, snapshot en la MISMA fila. null/ausente = sin modificadores.
  modifiers?: OrderLineModifierSnapshot[] | null
  // F2 — 'item' (default, retrocompat) | 'combo_header' | 'combo_component'.
  kind?: 'item' | 'combo_header' | 'combo_component'
  // F2 — solo en filas kind='combo_header': FK lógica a Combo.id.
  comboId?: string
  // F2 — solo en filas kind='combo_component': FK lógica (self) a la fila combo_header hermana.
  parentLineId?: string
  // #210 — ISO del envío a cocina. Ausente = el mozo la agregó y todavía no tocó "Enviar": `status`
  // sigue en 'new' tanto antes como después del envío, así que este campo es el único discriminador.
  sentAt?: string
  // #207 — solo en filas status='voided': motivo, quién (users.id) y cuándo se anuló.
  voidReason?: string
  voidedBy?: string
  voidedAt?: string
  createdAt?: string
  updatedAt?: string
}

/** #207: motivos predefinidos de anulación del hotel (configuration('restaurant_void_reasons')). */
export interface VoidReasons { reasons: string[]; isDefault: boolean }
/** #207: una línea viva es la que cuenta en totales/cocina; `voided`/`cancelled` quedan tachadas. */
export const isLineActive = (l: Pick<OrderLine, 'status'>): boolean => l.status !== 'voided' && l.status !== 'cancelled'

// F1 — Grupo de modificadores de un ítem (ej. "Tamaño": chico/grande).
export type ModifierSelectionType = 'single' | 'multiple'
export interface ModifierGroup {
  id: string
  hotelId: string
  menuItemId: string
  name: string
  selectionType: ModifierSelectionType
  required?: number
  minSelect?: number
  maxSelect?: number
  sortOrder?: number
  // Derivado: sus opciones, adjuntadas por GET .../modifier-groups (no hay ruta propia de listado).
  modifiers?: Modifier[]
  createdAt?: string
  updatedAt?: string
}

// F1 — Opción de un grupo de modificadores (ej. "Grande", "+tocino").
export interface Modifier {
  id: string
  hotelId: string
  groupId: string
  name: string
  priceDelta: number
  inventoryItemId?: string
  inventoryQuantity?: number
  active?: number
  sortOrder?: number
  createdAt?: string
  updatedAt?: string
}

export interface Order {
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
  // #210 — comensales (cubiertos). Solo en comandas `dine_in`; ausente en room service / para llevar.
  covers?: number
  // #209 — solo lectura, los calcula el server para room service ("Hab. 204 · Pérez"). No se mandan al abrir.
  roomNumber?: string
  guestName?: string
  createdAt?: string
  updatedAt?: string
}

export type OrderWithLines = Order & { lines: OrderLine[] }

// #209 — fila del buscador "quién está alojado" (GET /restaurant/in-house). Espejo de
// `restaurant/usecases/reservation-port.ts#InHouseReservation`. Sin saldo a propósito: el mozo no lo ve.
export interface InHouseReservation {
  id: string
  hotelId: string
  roomId: string
  roomNumber: string
  guestId: string | null
  guestName: string
  checkIn: string
  checkOut: string
  nights: number
  /** `checked_in` = alojado; `confirmed` = llega hoy / vigente sin check-in (se marca "Sin check-in"); otro solo por lookup de id. */
  status: string
}

export interface InHouseSearchResult {
  data: InHouseReservation[]
  /** Coincidencias reales; `data.length < total` = el server recortó la lista y hay que afinar el término. */
  total: number
}

/** Etiqueta corta del estado de una reserva en el buscador; vacío para un alojado (lo normal). */
export function inHouseStatusLabel(r: Pick<InHouseReservation, 'status'>): string {
  if (r.status === 'confirmed') return 'Sin check-in'
  if (r.status === 'checked_out') return 'Con checkout'
  if (r.status === 'cancelled' || r.status === 'no_show') return 'Cancelada'
  return ''
}

/** "Hab. 204 · Pérez" — etiqueta corta de una comanda de room service; vacío si el server no la resolvió. */
export function roomServiceLabel(o: Pick<Order, 'roomNumber' | 'guestName'>): string {
  const parts: string[] = []
  if (o.roomNumber) parts.push(`Hab. ${o.roomNumber}`)
  if (o.guestName) parts.push(o.guestName)
  return parts.join(' · ')
}

// F2 — Componente de un combo (ej. 2× Hamburguesa dentro de "Combo Familiar").
export interface ComboItem {
  id: string
  comboId: string
  menuItemId: string
  quantity: number
  sortOrder?: number
  createdAt?: string
  updatedAt?: string
}

// F2 — Combo/paquete de la carta. `price` es NETO propio del combo (no la suma de sus componentes).
export interface Combo {
  id: string
  hotelId: string
  name: string
  description?: string
  price: number
  taxRate?: number
  imageUrl?: string
  available?: number
  sortOrder?: number
  // Derivado: sus componentes, adjuntados por listCombos/getCombo (mismo patrón que ModifierGroup.modifiers).
  items?: ComboItem[]
  // F4 — undefined cuando se pidió con `?lang=` resuelto (el backend no duplica el payload).
  translations?: Record<string, ItemTranslation> | null
  // F5 — DERIVADO por el backend (unión de allergens de sus componentes). NUNCA se envía en ComboPayload.
  allergens?: AllergenTag[]
  createdAt?: string
  updatedAt?: string
}

/** Ticket del KDS: comanda + sus líneas activas (new/preparing/ready) de la estación. */
export interface KdsTicket {
  order: Pick<Order, 'id' | 'number' | 'type' | 'tableId' | 'openedAt' | 'status'> & {
    // #211 — resueltos por el server: "Terraza · Mesa 3" / "Hab. 204".
    tableName?: string
    tableZone?: string
    roomNumber?: string
  }
  lines: OrderLine[]
}

// #211 — canal en vivo (SSE). Espejo de backend/src/modules/restaurant/usecases/events.ts.
export type RestaurantEventType = 'hello' | 'ping' | 'order.sent' | 'line.status' | 'order.closed' | 'table.changed'
export interface RestaurantEvent {
  type: RestaurantEventType
  at: string
  orderId?: string
  tableId?: string
  lineId?: string
  status?: string
  /** order.sent / line.status: estaciones involucradas ('' = sin estación). */
  stationIds?: string[]
}

// ─── Payloads ───
export interface StationPayload { name: string; active?: number; sortOrder?: number; alertMinutes?: number }
export interface CategoryPayload {
  name: string; stationId?: string; sortOrder?: number; active?: number
  translations?: Record<string, CategoryTranslation> | null
}
export interface MenuItemPayload {
  categoryId: string; name: string; description?: string; price: number
  taxRate?: number; stationId?: string; available?: number; imageUrl?: string; sortOrder?: number
  translations?: Record<string, ItemTranslation> | null
  // F5 — tags de alérgenos/info dietética. NO existe en ComboPayload (D9: se deriva, nunca se persiste).
  allergens?: AllergenTag[]
  // F6 — "plato del día" + franja horaria "HH:mm". '' en availableFrom/availableTo = "Sin restricción"
  // (el usecase lo persiste como null; ver items-crud.ts:assertTimeWindow).
  featured?: number
  availableFrom?: string
  availableTo?: string
}
export interface TablePayload { name: string; zone?: string; capacity?: number; status?: TableStatus }
export interface OpenOrderPayload {
  type: OrderType; tableId?: string; reservationId?: string; guestId?: string; roomId?: string; waiterId?: string
  // #210 — comensales. El backend lo persiste SOLO en `dine_in` (default 1) y valida entero 1..200.
  covers?: number
}
// F2: menuItemId ya NO es obligatorio a nivel payload — un combo llega con comboId en su lugar
// (mutuamente excluyente, la regla XOR la enforza el usecase `addLine` en el backend).
export interface AddLinePayload { menuItemId?: string; comboId?: string; quantity?: number; notes?: string; modifiers?: { modifierId: string }[] }
export interface UpdateLinePayload { quantity?: number; notes?: string }
export interface ModifierGroupPayload { name: string; selectionType?: ModifierSelectionType; required?: number; minSelect?: number; maxSelect?: number; sortOrder?: number }
export interface ModifierPayload { name: string; priceDelta: number; inventoryItemId?: string; inventoryQuantity?: number; active?: number; sortOrder?: number }

// F2 — Combo/paquete: alta/edición vía carta.vue, venta vía comanda.vue (AddLinePayload.comboId).
// F5 — a propósito SIN `allergens`: el combo nunca declara los suyos, se derivan de sus componentes
// (Combo.allergens, solo lectura). Enviarlo acá sería inútil: el backend lo descarta en silencio.
export interface ComboItemPayload { menuItemId: string; quantity: number; sortOrder?: number }
export interface ComboPayload {
  name: string; description?: string; price: number; taxRate?: number; imageUrl?: string
  available?: number; sortOrder?: number; items: ComboItemPayload[]
  translations?: Record<string, ItemTranslation> | null
}

// F3 — Food cost: costo de receta + margen de un ítem/combo (espejo de restaurant/usecases/food-cost.ts).
// `cost`/`margin`/`marginPercent` null = inventario no montado en este hotel (available:false) o ítem sin
// receta (hasRecipe:false) — en AMBOS casos el margen NO se muestra (no "0%" ni "100%" falso).
export interface FoodCost {
  menuItemId?: string
  comboId?: string
  price: number
  cost: number | null
  hasRecipe?: boolean
  complete?: boolean
  available: boolean
  margin: number | null
  marginPercent: number | null
}
export interface FoodCostReportRow {
  id: string
  kind: 'item' | 'combo'
  name: string
  price: number
  cost: number
  margin: number
  marginPercent: number | null
  complete: boolean
  hasRecipe: boolean
}

// F7 — Carta pública de solo lectura (GET /api/public/menu/:hotelId, SIN sesión/token). DTO curado
// por el backend (allow-list, nunca los mismos MenuItem/Combo internos — esos traen campos que acá
// NUNCA deben existir: cost, hotelId, stationId, taxRate, etc.).
export interface PublicMenuItem {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
  allergens?: AllergenTag[] | null
  featured?: number
  availableFrom?: string | null
  availableTo?: string | null
  availableNow?: boolean
}
export interface PublicMenuCategory { id: string; name: string; items: PublicMenuItem[] }
export interface PublicMenuCombo {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
  allergens?: AllergenTag[]
  featured?: number
  components: { name: string; quantity: number }[]
}
export interface PublicMenu {
  hotel: { name: string }
  categories: PublicMenuCategory[]
  combos: PublicMenuCombo[]
}

export const RestaurantService = {
  // ─── Estaciones (pantallas KDS configurables) ───
  async listStations(): Promise<Station[]> {
    const res = await http.get<{ data: Station[]; total: number }>('/restaurant/stations')
    return res.data ?? []
  },
  createStation: (data: StationPayload): Promise<Station> => http.post('/restaurant/stations', data),
  updateStation: (id: string, data: Partial<StationPayload>): Promise<Station> => http.put(`/restaurant/stations/${id}`, data),
  deleteStation: (id: string): Promise<void> => http.delete(`/restaurant/stations/${id}`),

  // ─── Carta: categorías ───
  async listCategories(lang?: string): Promise<MenuCategory[]> {
    const qs = lang ? `?lang=${encodeURIComponent(lang)}` : ''
    const res = await http.get<{ data: MenuCategory[]; total: number }>(`/restaurant/categories${qs}`)
    return res.data ?? []
  },
  createCategory: (data: CategoryPayload): Promise<MenuCategory> => http.post('/restaurant/categories', data),
  updateCategory: (id: string, data: Partial<CategoryPayload>): Promise<MenuCategory> => http.put(`/restaurant/categories/${id}`, data),
  deleteCategory: (id: string): Promise<void> => http.delete(`/restaurant/categories/${id}`),

  // ─── Carta: ítems ───
  async listItems(categoryId?: string, lang?: string): Promise<MenuItem[]> {
    const qs = new URLSearchParams()
    if (categoryId) qs.set('categoryId', categoryId)
    if (lang) qs.set('lang', lang)
    const q = qs.toString()
    const res = await http.get<{ data: MenuItem[]; total: number }>(`/restaurant/menu-items${q ? `?${q}` : ''}`)
    return res.data ?? []
  },
  createItem: (data: MenuItemPayload): Promise<MenuItem> => http.post('/restaurant/menu-items', data),
  updateItem: (id: string, data: Partial<MenuItemPayload>): Promise<MenuItem> => http.put(`/restaurant/menu-items/${id}`, data),
  setItemAvailability: (id: string, available: number): Promise<MenuItem> => http.put(`/restaurant/menu-items/${id}/availability`, { available }),
  deleteItem: (id: string): Promise<void> => http.delete(`/restaurant/menu-items/${id}`),

  // ─── Mesas / salón ───
  async listTables(): Promise<RestaurantTable[]> {
    const res = await http.get<{ data: RestaurantTable[]; total: number }>('/restaurant/tables')
    return res.data ?? []
  },
  createTable: (data: TablePayload): Promise<RestaurantTable> => http.post('/restaurant/tables', data),
  updateTable: (id: string, data: Partial<TablePayload>): Promise<RestaurantTable> => http.put(`/restaurant/tables/${id}`, data),
  deleteTable: (id: string): Promise<void> => http.delete(`/restaurant/tables/${id}`),

  // ─── Comandas ───
  async listOrders(query?: { status?: string; tableId?: string }): Promise<Order[]> {
    const qs = new URLSearchParams()
    if (query?.status) qs.set('status', query.status)
    if (query?.tableId) qs.set('tableId', query.tableId)
    const q = qs.toString()
    const res = await http.get<{ data: Order[]; total: number }>(`/restaurant/orders${q ? `?${q}` : ''}`)
    return res.data ?? []
  },
  getOrder: (id: string): Promise<OrderWithLines> => http.get(`/restaurant/orders/${id}`),
  // #209 — alojados (y confirmadas que llegan hoy) del hotel por número de habitación (prefijo) o apellido.
  // Va por /restaurant y no por /reservas porque el mozo no tiene `reservations:view`. `q` vacío = todos.
  async searchInHouse(q: string): Promise<InHouseSearchResult> {
    const term = q.trim()
    const res = await http.get<InHouseSearchResult>(`/restaurant/in-house${term ? `?q=${encodeURIComponent(term)}` : ''}`)
    return { data: res?.data ?? [], total: Number(res?.total ?? res?.data?.length ?? 0) }
  },
  // #209 — una reserva puntual del hotel (cualquier estado) por el mismo endpoint: Cobrar preselecciona la de
  // la comanda sin traerse a todos los alojados. `null` si no existe o no es del hotel.
  async getInHouseById(id: string): Promise<InHouseReservation | null> {
    const res = await http.get<InHouseSearchResult>(`/restaurant/in-house?id=${encodeURIComponent(id)}`)
    return res?.data?.[0] ?? null
  },
  openOrder: (data: OpenOrderPayload): Promise<Order> => http.post('/restaurant/orders', data),
  sendOrder: (id: string): Promise<Order> => http.post(`/restaurant/orders/${id}/send`),
  // #207: el motivo es obligatorio (400 sin él). Las líneas ya enviadas quedan `voided` con ese motivo.
  cancelOrder: (id: string, reason: string): Promise<Order> => http.post(`/restaurant/orders/${id}/cancel`, { reason }),
  addLine: (orderId: string, data: AddLinePayload): Promise<OrderLine> => http.post(`/restaurant/orders/${orderId}/items`, data),
  updateLine: (orderId: string, lineId: string, data: UpdateLinePayload): Promise<OrderLine> => http.put(`/restaurant/orders/${orderId}/items/${lineId}`, data),
  // Solo mientras la comanda está `open` (error de toma). Enviada a cocina → 409: usar voidLine.
  removeLine: (orderId: string, lineId: string): Promise<void> => http.delete(`/restaurant/orders/${orderId}/items/${lineId}`),
  // #207: anular con motivo una línea ya enviada. Queda tachada en la comanda, sale del KDS y del total.
  voidLine: (orderId: string, lineId: string, reason: string): Promise<OrderLine> => http.post(`/restaurant/orders/${orderId}/items/${lineId}/void`, { reason }),
  voidReasons: (): Promise<VoidReasons> => http.get('/restaurant/void-reasons'),
  setVoidReasons: (reasons: string[]): Promise<VoidReasons> => http.put('/restaurant/void-reasons', { reasons }),

  // ─── Cuenta + cobro ───
  billOrder: (id: string, data: { tip?: number }): Promise<Order> => http.post(`/restaurant/orders/${id}/bill`, data),
  chargeToRoom: (id: string, data: { reservationId?: string }): Promise<Order> => http.post(`/restaurant/orders/${id}/charge-to-room`, data),
  // fix-refund-pos-card: method==='card' exige successUrl/cancelUrl (retorno del Checkout de Stripe)
  // y la respuesta trae `checkoutUrl` cuando el pago quedó `processing` — cobrar.vue redirige ahí.
  // #205: `method` es el enum del backend (PaySchema: cash|card|transfer), no un string libre.
  payOrder: (id: string, data: { method: PosPaymentMethod; successUrl?: string; cancelUrl?: string }): Promise<Order & { checkoutUrl?: string }> =>
    http.post(`/restaurant/orders/${id}/pay`, data),
  // Reembolso: solo órdenes status='paid' con settlement='payment' (cobro con tarjeta).
  // Backend devuelve 409 ConflictError si la orden no cumple la condición.
  refundOrder: (id: string): Promise<Order> => http.post(`/restaurant/orders/${id}/refund`),

  // ─── KDS / cocina ───
  async kdsQueue(station?: string): Promise<KdsTicket[]> {
    const qs = station ? `?station=${encodeURIComponent(station)}` : ''
    const res = await http.get<{ data: KdsTicket[]; total: number }>(`/restaurant/kds${qs}`)
    return res.data ?? []
  },
  setLineStatus: (lineId: string, status: LineStatus): Promise<OrderLine> => http.put(`/restaurant/kds/lines/${lineId}`, { status }),

  // ─── Canal en vivo (#211) ───
  /** Ticket de 60 s para abrir `GET /restaurant/events` con EventSource (que no manda headers). Lo usa useRestaurantEvents. */
  eventsTicket: (): Promise<{ ticket: string; expiresIn: number }> => http.get('/restaurant/events/ticket'),

  // ─── Modificadores/variantes (F1) ───
  async listModifierGroups(menuItemId: string): Promise<ModifierGroup[]> {
    const res = await http.get<{ data: ModifierGroup[]; total: number }>(`/restaurant/menu-items/${menuItemId}/modifier-groups`)
    return res.data ?? []
  },
  createModifierGroup: (menuItemId: string, data: ModifierGroupPayload): Promise<ModifierGroup> => http.post(`/restaurant/menu-items/${menuItemId}/modifier-groups`, data),
  updateModifierGroup: (id: string, data: Partial<ModifierGroupPayload>): Promise<ModifierGroup> => http.put(`/restaurant/modifier-groups/${id}`, data),
  deleteModifierGroup: (id: string): Promise<void> => http.delete(`/restaurant/modifier-groups/${id}`),
  createModifier: (groupId: string, data: ModifierPayload): Promise<Modifier> => http.post(`/restaurant/modifier-groups/${groupId}/modifiers`, data),
  updateModifier: (id: string, data: Partial<ModifierPayload>): Promise<Modifier> => http.put(`/restaurant/modifiers/${id}`, data),
  deleteModifier: (id: string): Promise<void> => http.delete(`/restaurant/modifiers/${id}`),

  // ─── Combos/paquetes (F2) ───
  async listCombos(lang?: string): Promise<Combo[]> {
    const qs = lang ? `?lang=${encodeURIComponent(lang)}` : ''
    const res = await http.get<{ data: Combo[]; total: number }>(`/restaurant/combos${qs}`)
    return res.data ?? []
  },
  getCombo: (id: string): Promise<Combo> => http.get(`/restaurant/combos/${id}`),
  createCombo: (data: ComboPayload): Promise<Combo> => http.post('/restaurant/combos', data),
  updateCombo: (id: string, data: Partial<ComboPayload>): Promise<Combo> => http.put(`/restaurant/combos/${id}`, data),
  deleteCombo: (id: string): Promise<void> => http.delete(`/restaurant/combos/${id}`),

  // ─── Food cost (F3) — gate 'restaurant-catalog:view', solo hotel_admin lo ve ───
  itemFoodCost: (id: string): Promise<FoodCost> => http.get(`/restaurant/menu-items/${id}/food-cost`),
  comboFoodCost: (id: string): Promise<FoodCost> => http.get(`/restaurant/combos/${id}/food-cost`),
  async foodCostReport(): Promise<FoodCostReportRow[]> {
    const res = await http.get<{ data: FoodCostReportRow[]; total: number }>('/restaurant/food-cost/report')
    return res.data ?? []
  },

  // ─── Carta pública (F7) — SIN sesión. `http` no fuerza Authorization si no hay token guardado, y
  // `/public/` ya está en la whitelist de isPublicAuthPath (http.ts) para no disparar un logout falso. ───
  getPublicMenu: (hotelId: string, lang?: string): Promise<PublicMenu> =>
    http.get(`/public/menu/${hotelId}${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`),
}

// ─── Labels ES para la UI ───
export const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'En salón', room_service: 'Room service', takeaway: 'Para llevar',
}
export const ORDER_STATUS_LABELS: Record<string, string> = {
  open: 'Abierta', sent: 'Enviada', preparing: 'En preparación', ready: 'Lista', served: 'Servida',
  billed: 'Con cuenta', charged: 'Cargada a habitación', paid: 'Pagada', refunded: 'Reembolsada', cancelled: 'Cancelada',
  processing_payment: 'Esperando confirmación de pago',
}
export const LINE_STATUS_LABELS: Record<string, string> = {
  new: 'Nueva', preparing: 'Preparando', ready: 'Lista', served: 'Servida', cancelled: 'Cancelada', voided: 'Anulada',
}
// #210 — color del badge de estado de línea. MISMA paleta que el KDS (`cocina.vue` pinta el borde del
// ticket con navy/30 → navy → gold): el mozo y la cocina leen el mismo código de color, así que vive
// acá y no duplicado en cada página.
export const LINE_STATUS_BADGE: Record<string, string> = {
  new: 'bg-navy/10 text-navy',
  preparing: 'bg-navy text-white',
  ready: 'bg-gold text-white',
  served: 'bg-teal/15 text-teal',
  cancelled: 'bg-coral/15 text-coral',
  voided: 'bg-coral/15 text-coral',
}
export const TABLE_STATUS_LABELS: Record<string, string> = {
  free: 'Libre', occupied: 'Ocupada', reserved: 'Reservada',
}
