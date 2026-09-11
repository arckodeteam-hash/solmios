// restaurant/model.ts — Schema del POS de restaurante (RES-0).
// 6 tablas: estaciones (pantallas KDS configurables), carta (menu_categories + menu_items),
// salón (restaurant_tables), y comandas (restaurant_orders + restaurant_order_items).
// DB en inglés, multi-tenant por hotelId, id = TEXT UUID, booleanos = INTEGER 0/1.
// Ver openspec/changes/restaurante-pos/design.md §Modelo de datos.
import type { ModelDefinition, ORM } from 'arckode-framework'

/** Estación de preparación = una pantalla KDS. Configurable por hotel (Cocina, Bar, Parrilla…). */
export const RestaurantStationModel: ModelDefinition = {
  table: 'restaurant_stations',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    active: { type: 'number', default: 1 },
    sortOrder: { type: 'number', default: 0 },
    // #211 — minutos desde el envío a cocina a partir de los cuales el ticket del KDS se pinta ámbar
    // (y rojo al doble). Configurable por estación (la parrilla tarda más que el bar). Null en filas
    // anteriores a la columna (ADD COLUMN no rellena): la UI cae al default 10.
    alertMinutes: { type: 'number', default: 10 },
  },
  timestamps: true,
}

/** Categoría de la carta. `stationId` rutea sus ítems a una pantalla KDS. */
export const MenuCategoryModel: ModelDefinition = {
  table: 'menu_categories',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    // FK lógica a restaurant_stations. Los ítems de la categoría van a esa pantalla. Null = sin ruteo.
    stationId: { type: 'string', indexed: true },
    sortOrder: { type: 'number', default: 0 },
    active: { type: 'number', default: 1 },
    // F4 — { [langCode]: { name } }. NUNCA incluye la clave 'es' (el español vive en `name`, D7).
    // type:'json' nativo del ORM (serializa/deserializa solo). nullable, sin default = sin traducciones.
    translations: { type: 'json' },
  },
  timestamps: true,
}

/** Ítem de la carta. `price` es NETO (sin impuesto; se aplica al facturar, como folio_charges). */
export const MenuItemModel: ModelDefinition = {
  table: 'menu_items',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    categoryId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    description: { type: 'text' },
    price: { type: 'number', required: true },
    // Si null → tasa de configuration('taxes') del hotel al facturar (NO hardcode).
    taxRate: { type: 'number' },
    // Override opcional de estación. Si null → hereda category.stationId.
    stationId: { type: 'string', indexed: true },
    available: { type: 'number', default: 1 },
    imageUrl: { type: 'string' },
    sortOrder: { type: 'number', default: 0 },
    // F4 — { [langCode]: { name?, description? } }. NUNCA incluye la clave 'es' (D7).
    translations: { type: 'json' },
    // F5 — array de strings del catálogo fijo ALLERGEN_TAGS (types.ts). nullable, sin default = sin
    // tags declarados (compat retro). menu_combos NO tiene esta columna — se deriva al leer (D9).
    allergens: { type: 'json' },
    // F6 — "plato del día"/recomendado. Puramente informativo, sin regla de negocio (specs/menu-featured-availability).
    featured: { type: 'number', default: 0 },
    // F6 — franja horaria de disponibilidad "HH:mm". Ambos null (default) = sin restricción horaria,
    // comportamiento IDÉNTICO al actual (compat retro total). Todo-o-nada: se validan juntos en el
    // usecase (items-crud.ts:assertTimeWindow), nunca uno sin el otro.
    availableFrom: { type: 'string' },
    availableTo: { type: 'string' },
  },
  timestamps: true,
}

/** Mesa del salón. `status` se cachea a partir de la comanda abierta. */
export const RestaurantTableModel: ModelDefinition = {
  table: 'restaurant_tables',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    zone: { type: 'string' },
    capacity: { type: 'number', default: 0 },
    // free | occupied | reserved
    status: { type: 'string', default: 'free' },
  },
  timestamps: true,
}

/** Comanda / cuenta. Los totales los calcula el server; `settlement` = folio XOR payment (una sola vez). */
export const RestaurantOrderModel: ModelDefinition = {
  table: 'restaurant_orders',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    number: { type: 'string' },   // correlativo por hotel (counter atómico en configuration)
    // dine_in | room_service | takeaway
    type: { type: 'string', required: true },
    tableId: { type: 'string', indexed: true },
    reservationId: { type: 'string', indexed: true },
    guestId: { type: 'string' },
    roomId: { type: 'string' },
    waiterId: { type: 'string', indexed: true },   // users.id (nombre se resuelve por /usuarios)
    // open | sent | preparing | ready | served | billed | charged | paid | cancelled
    status: { type: 'string', default: 'open' },
    subtotal: { type: 'number', default: 0 },
    tax: { type: 'number', default: 0 },
    tip: { type: 'number', default: 0 },
    total: { type: 'number', default: 0 },
    // folio | payment | null — cómo se liquidó (mutuamente excluyente)
    settlement: { type: 'string' },
    folioId: { type: 'string' },
    paymentId: { type: 'string' },
    openedAt: { type: 'string' },
    closedAt: { type: 'string' },
    // #210 — comensales de la mesa (cubiertos). Solo se carga en comandas `dine_in` (default 1 al
    // abrirla); en room_service/takeaway queda null. Lo consume el reporte del día (ticket promedio
    // por comensal). null en las filas anteriores a la columna = comanda sin dato, NO "cero comensales".
    covers: { type: 'number' },
    // #213 — motivo con el que se canceló la comanda (lo exige cancelOrder desde #207). Antes vivía
    // solo en el audit log y en las líneas `voided`; una comanda cancelada `open` (nunca fue a cocina,
    // sus líneas no se anulan) no tenía dónde guardarlo y el cierre del día la mostraba sin motivo.
    // null en filas anteriores a la columna: el reporte cae al motivo de la primera línea anulada.
    cancelReason: { type: 'text' },
    // #213 (auditoría) — día contable 'YYYY-MM-DD' en la zona del hotel, fijado al cerrar la comanda
    // (cobro, cargo a habitación o cancelación). El ORM solo consulta por igualdad: el cierre del día
    // pide `{ hotelId, businessDate }` en vez de traer todo el histórico y cortar en memoria. NO cambia
    // al reembolsar: la venta queda en su día y el reembolso se ve en el suyo (payments.businessDate).
    // Filas anteriores a la columna: backfill en migrate-db.ts desde closedAt (zona del hotel).
    businessDate: { type: 'string', indexed: true },
    // #213 (auditoría) — cuándo se reembolsó. Antes refundOrder pisaba closedAt y la venta se mudaba
    // de día en el cierre; ahora closedAt es el cobro y refundedAt la devolución.
    refundedAt: { type: 'string' },
  },
  timestamps: true,
}

/** Línea de la comanda. Snapshot de name/price/estación: la comanda no muta si cambia la carta. */
export const RestaurantOrderItemModel: ModelDefinition = {
  table: 'restaurant_order_items',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    orderId: { type: 'string', required: true, indexed: true },
    menuItemId: { type: 'string', indexed: true },
    name: { type: 'string', required: true },      // snapshot
    unitPrice: { type: 'number', required: true }, // snapshot (neto)
    quantity: { type: 'number', default: 1 },
    notes: { type: 'text' },
    // Tasa de impuesto (%) congelada al agregar la línea (item.taxRate ?? tasa del hotel). Snapshot:
    // la cuenta no cambia si después se reconfigura el impuesto del hotel. NO hardcodeada.
    taxRate: { type: 'number', default: 0 },
    // Estación resuelta y congelada (item.stationId ?? category.stationId ?? 1ª activa).
    stationId: { type: 'string', indexed: true },
    stationName: { type: 'string' },   // snapshot: sobrevive si la estación se borra
    // new | preparing | ready | served | cancelled | voided (ciclo KDS por línea; voided = #207)
    status: { type: 'string', default: 'new' },
    lineTotal: { type: 'number', default: 0 },
    // F1 (carta-experiencia-avanzada): snapshot de modificadores elegidos, EN LA MISMA fila (no
    // sub-líneas) — [{ groupId, groupName, modifierId, name, priceDelta }]. null = sin modificadores
    // (compat retro con líneas viejas). order-totals.ts/settlement.ts no lo leen ni lo necesitan.
    modifiers: { type: 'json' },
    // F2 — 'item' (default, retrocompat) | 'combo_header' | 'combo_component'. El ADD COLUMN con
    // default:'item' deja las filas pre-F2 tratadas como ítem simple, sin migración de datos manual.
    kind: { type: 'string', default: 'item' },
    // F2 — solo en filas kind='combo_header': FK lógica a menu_combos.id.
    comboId: { type: 'string', indexed: true },
    // F2 — solo en filas kind='combo_component': FK lógica (self) a la fila combo_header hermana.
    parentLineId: { type: 'string', indexed: true },
    // #210 — momento en que la línea se confirmó a cocina (POST /orders/:id/send). null = el mozo la
    // agregó pero todavía no tocó "Enviar": es lo ÚNICO que distingue una línea recién cargada de una
    // ya despachada, porque ambas siguen en `status:'new'` hasta que cocina la toma. NO filtra el KDS
    // (la cola sigue mostrando toda línea activa de una comanda en fase de cocina: si el mozo se
    // olvidara de confirmar, el plato igual se prepara). Las filas previas a la columna quedan en null
    // → la comanda abierta al momento del deploy muestra el botón de re-envío una vez; tocarlo la
    // estampa y no vuelve a aparecer.
    sentAt: { type: 'string' },
    // #207 — anulación con motivo de una línea ya enviada a cocina. Solo en filas status='voided'.
    // Declarados acá porque el ORM descarta en silencio los campos que no están en `fields`.
    voidReason: { type: 'text' },
    voidedBy: { type: 'string' },   // users.id de quien anuló
    voidedAt: { type: 'string' },
  },
  timestamps: true,
}

/** F1 — Grupo de modificadores de un ítem (ej. "Tamaño": chico/grande). selectionType: single|multiple. */
export const MenuItemModifierGroupModel: ModelDefinition = {
  table: 'menu_item_modifier_groups',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    menuItemId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    selectionType: { type: 'string', default: 'single' },   // single | multiple
    required: { type: 'number', default: 0 },                // booleano como INTEGER
    minSelect: { type: 'number', default: 1 },               // solo aplica si selectionType='multiple'
    maxSelect: { type: 'number' },                           // null = sin tope
    sortOrder: { type: 'number', default: 0 },
  },
  timestamps: true,
}

/** F1 — Opción de un grupo de modificadores (ej. "Grande", "+tocino"). priceDelta puede ser negativo. */
export const MenuItemModifierModel: ModelDefinition = {
  table: 'menu_item_modifiers',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    groupId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    priceDelta: { type: 'number', default: 0 },
    // Consumo opcional de inventario propio (FK lógica a inventory_items, dueño del módulo inventario;
    // ninguna FK física — mismo patrón que menu_item_recipes.inventoryItemId).
    inventoryItemId: { type: 'string', indexed: true },
    inventoryQuantity: { type: 'number' },
    active: { type: 'number', default: 1 },
    sortOrder: { type: 'number', default: 0 },
  },
  timestamps: true,
}

/** F2 — Combo/paquete (ej. "Combo Familiar"). `price` es NETO propio del combo (no suma de componentes). */
export const MenuComboModel: ModelDefinition = {
  table: 'menu_combos',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    name: { type: 'string', required: true },
    description: { type: 'text' },
    price: { type: 'number', required: true },
    // Si null → tasa de configuration('taxes') del hotel al facturar (mismo criterio que menu_items.taxRate).
    taxRate: { type: 'number' },
    imageUrl: { type: 'string' },
    available: { type: 'number', default: 1 },
    sortOrder: { type: 'number', default: 0 },
    // F4 — { [langCode]: { name?, description? } }. NUNCA incluye la clave 'es' (D7).
    translations: { type: 'json' },
  },
  timestamps: true,
}

/** F2 — Componente de un combo. `quantity` = unidades del ítem por unidad de combo vendida. */
export const MenuComboItemModel: ModelDefinition = {
  table: 'menu_combo_items',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    comboId: { type: 'string', required: true, indexed: true },
    // FK lógica a menu_items.id, MISMO hotel (validada en combos-crud.ts, no hay FK física).
    menuItemId: { type: 'string', required: true, indexed: true },
    quantity: { type: 'number', default: 1 },
    sortOrder: { type: 'number', default: 0 },
  },
  timestamps: true,
}

export function registerRestaurantModels(orm: ORM): void {
  orm.define('RestaurantStations', RestaurantStationModel)
  orm.define('MenuCategories', MenuCategoryModel)
  orm.define('MenuItems', MenuItemModel)
  orm.define('RestaurantTables', RestaurantTableModel)
  orm.define('RestaurantOrders', RestaurantOrderModel)
  orm.define('RestaurantOrderItems', RestaurantOrderItemModel)
  orm.define('MenuItemModifierGroups', MenuItemModifierGroupModel)
  orm.define('MenuItemModifiers', MenuItemModifierModel)
  orm.define('MenuCombos', MenuComboModel)
  orm.define('MenuComboItems', MenuComboItemModel)
}
