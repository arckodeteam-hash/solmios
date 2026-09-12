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
    // #216 — al enviar a cocina, el POS abre solo la comanda de cocina (80 mm) de esta estación para
    // imprimirla. Lo decide el frontend (comanda.vue) leyendo este flag; el server solo lo guarda.
    autoPrint: { type: 'boolean', default: 0 },
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
    // #215 — descuento a nivel COMANDA (sobre la suma de líneas ya descontadas): `discountType`
    // 'percent' | 'amount', `discountValue` lo que se pidió (el % o el monto), `discountAmount` lo que
    // efectivamente se restó (lo calcula recomputeTotals: un monto mayor que la base se recorta),
    // `discountReason` obligatorio, `discountBy` users.id, `discountAt` ISO. null = sin descuento.
    // `discountTotal` = Σ descuentos de línea + descuento de comanda: lo que el ticket muestra como
    // "Descuentos" y lo que lee el cierre del día (#213) sin recorrer las líneas.
    discountType: { type: 'string' },
    discountValue: { type: 'number' },
    discountAmount: { type: 'number', default: 0 },
    discountReason: { type: 'text' },
    discountBy: { type: 'string' },
    discountAt: { type: 'string' },
    discountTotal: { type: 'number', default: 0 },
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
    // #214 — suma de los pagos parciales YA cobrados (restaurant_order_payments completadas, SIN
    // propina). 0/null = ningún pago parcial. > 0 bloquea líneas, cancelación y el "cobrar todo":
    // la cuenta ya tiene plata adentro y solo se salda por partes. La fuente de verdad del dinero
    // sigue siendo `payments`; esto es el acumulado que la comanda necesita para su saldo.
    amountPaid: { type: 'number', default: 0 },
    // #214 — suma de las partes `pending` VIVAS (Checkout de tarjeta abierto, o una parte que quedó a
    // medias). Se mueve SOLO con UPDATE condicional (`split-payments.ts`: reservar / soltar / completar):
    // es el árbitro contra dos partes concurrentes sobre el mismo saldo y el "hay una parte en curso"
    // que cancelar, cobrar entero y editar líneas consultan (`order-totals.hasOpenPart`).
    amountReserved: { type: 'number', default: 0 },
    // #214 (COR-A) — lock de líneas: ISO hasta el que una edición de líneas (agregar/editar/quitar/anular)
    // tiene tomada la comanda. '' = libre; un valor vencido también cuenta como libre (lease: si el proceso
    // muere a mitad de la edición, la comanda se destraba sola). Mientras está tomado no se reserva saldo
    // (parte / cobro entero) ni se cancela; y todo CAS de dinero condiciona sobre él (usecases/order-cas.ts).
    // TEXT y no `number`: REAL es float4 en Postgres y un epoch ms no cabe con precisión de segundos.
    linesLockedUntil: { type: 'string', default: '' },
  },
  timestamps: true,
}

/**
 * #214 — UNIQUE (orderId, seq) de `restaurant_order_payments`. El ORM no crea índices compuestos: lo
 * crea `migrate-db.ts` y lo recrea el test de split-payments (mismo literal, para que lo que se prueba
 * sea lo que corre). `seq` es el `<n>` de la referencia idempotente `pos:<orderId>:<n>`.
 */
export const RESTAURANT_ORDER_PAYMENTS_SEQ_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS restaurant_order_payments_order_seq ON restaurant_order_payments(orderId, seq)'
/**
 * #214 — `ormMigrate` agrega `amountPaid`/`amountReserved`/`linesLockedUntil` con `ADD COLUMN` y deja las filas viejas en NULL.
 * El UPDATE condicional filtra por igualdad (`amountReserved = ?`) y NULL no matchea nunca: sin este
 * backfill, la primera parte de una comanda anterior a la columna no podría reservar saldo.
 */
export const RESTAURANT_ORDERS_BACKFILL_AMOUNTS_SQL = [
  'UPDATE restaurant_orders SET amountPaid = 0 WHERE amountPaid IS NULL',
  'UPDATE restaurant_orders SET amountReserved = 0 WHERE amountReserved IS NULL',
  "UPDATE restaurant_orders SET linesLockedUntil = '' WHERE linesLockedUntil IS NULL",
]

/**
 * #214 — Una PARTE del cobro de una comanda (dividir cuenta / pagos parciales). Una comanda tiene N
 * filas; cada una apunta al `payment` (cash/card/transfer) o al folio (room) que la respalda —
 * `payments`/`folio_charges` siguen siendo la única fuente de verdad del dinero. `seq` es el `<n>`
 * de la referencia idempotente `pos:<orderId>:<n>`; UNIQUE (orderId, seq) lo crea `migrate-db.ts`
 * (el ORM no hace unique compuesto) y es el árbitro contra dos partes concurrentes con el mismo n.
 */
export const RestaurantOrderPaymentModel: ModelDefinition = {
  table: 'restaurant_order_payments',
  fields: {
    id: { type: 'string', required: true },
    hotelId: { type: 'string', required: true, indexed: true },
    orderId: { type: 'string', required: true, indexed: true },
    seq: { type: 'number', required: true },
    // cash | card | transfer | room
    method: { type: 'string', required: true },
    // Lo que se aplica al SALDO de la comanda (bruto: neto + impuesto). Sin propina.
    amount: { type: 'number', required: true },
    // Propina de esta parte: se cobra encima de `amount` (payment = amount + tip). Nunca en `room`.
    tip: { type: 'number', default: 0 },
    // pending (Checkout de tarjeta abierto / a medias) | completed | expired | failed | refunding | refunded.
    // `failed`/`expired` conservan su `seq`: la referencia `pos:<orderId>:<n>` ya pudo quedar reclamada en
    // payments y la siguiente parte toma n+1 (nunca hereda un payment ajeno).
    status: { type: 'string', default: 'pending' },
    paymentId: { type: 'string', indexed: true },   // payments.id (cash/card/transfer)
    folioId: { type: 'string' },                    // folio al que fue la parte `room`
    reservationId: { type: 'string' },
    // Dividir por líneas: ids de restaurant_order_items que esta parte paga. null = por monto/partes iguales.
    lineIds: { type: 'json' },
    createdBy: { type: 'string' },
    completedAt: { type: 'string' },
    refundedAt: { type: 'string' },
    refundReason: { type: 'text' },   // motivo de la devolución (obligatorio al devolver: efectivo/transferencia salen del cajón)
    failedAt: { type: 'string' },
    failReason: { type: 'string' },   // por qué falló el puerto de dinero (mensaje, recortado)
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
    // Lo que cocina (KDS) o el mozo (comanda) cambió de la receta de este plato:
    // { removed: string[], added: string[], doubled: string[] } = SIN / CON / DOBLE (nombres de
    // ingrediente, texto). Es una anotación de preparación, NO un modificador: no toca precio ni
    // `lineTotal` (un extra que se cobra es un modificador). null = el plato va como dice la receta.
    // Lo escribe `kds.setLineIngredients`; lo leen el tablero, la comanda y la comanda impresa.
    ingredientChanges: { type: 'json' },
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
    // #215 — descuento a nivel LÍNEA. `lineTotal` sigue siendo el neto BRUTO (precio + modificadores ×
    // cantidad, computeLineTotal); lo que se resta vive en `discountAmount` (recalculado por
    // recomputeTotals al cambiar la cantidad: un % se mantiene, un monto se recorta al total de la
    // línea). Cortesía = percent 100. La línea se mantiene en la venta (no es una anulación).
    discountType: { type: 'string' },
    discountValue: { type: 'number' },
    discountAmount: { type: 'number', default: 0 },
    discountReason: { type: 'text' },
    discountBy: { type: 'string' },
    discountAt: { type: 'string' },
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
  orm.define('RestaurantOrderPayments', RestaurantOrderPaymentModel)   // #214
}
