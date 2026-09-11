// restaurant/service.ts — Facade del módulo POS de restaurante. Orquesta; la lógica que crece vive en usecases/.
// Depende de RepositoryAdapter, NO del ORM directo. NO importa de otros módulos (va por conectores). Ver openspec/changes/restaurante-pos.
// Los campos son públicos (readonly los repos) porque `usecases/deps.ts` arma desde acá las deps de cada
// usecase (#213: implementa `deps.RestaurantState`); los puertos solo se escriben por los setters de abajo.
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, CurrentUser, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO, LineStatus } from './types'
import type { RestaurantSockets } from './sockets'
import * as categoriesCrud from './usecases/categories-crud'
import * as itemsCrud from './usecases/items-crud'
import * as tablesCrud from './usecases/tables-crud'
import * as orders from './usecases/orders'
import * as orderLines from './usecases/order-lines'
import * as settlement from './usecases/settlement'
import * as kds from './usecases/kds'
import * as modifiersCrud from './usecases/modifiers-crud'
import * as stationsCrud from './usecases/stations-crud'
import * as combosCrud from './usecases/combos-crud'
import * as foodCost from './usecases/food-cost'
import * as publicMenuUsecase from './usecases/public-menu'
import * as voidReasons from './usecases/void-reasons'
import * as events from './usecases/events'
import * as reports from './usecases/reports'
import * as deps from './usecases/deps'
import { composeSockets } from './usecases/compose-sockets'
import type { AuditPort } from '../../shared/usecases/audit'
import type { ReservationPort } from './usecases/reservation-port'

export class RestaurantService implements deps.RestaurantState {
  sockets: RestaurantSockets = {}
  // Puertos de liquidación (folios/payments) que inyecta un conector. RES-5.
  settlementPorts: settlement.SettlementPorts = {}
  // Puerto de recetas (inventario, conector restaurante-inventario.ts): hasRecipe (badge "Sin receta") +
  // F3 getRecipeCost (margen). `undefined` = inventario no montado → food-cost.ts degrada, nunca 500.
  recipePorts: foodCost.RecipePorts = {}
  // #207: auditoría (connectors/restaurante-auditlog.ts). null = sin auditlog montado: anular sigue funcionando, sin rastro.
  auditPort: AuditPort | null = null
  // #208: puertos — reservas por conector (restaurante-reservas.ts; null = room service/cargo a habitación fallan
  // cerrado) y gate del módulo para la carta pública (index.ts → createModuleChecker; null = 404 genérico).
  reservationPort: ReservationPort | null = null
  moduleStatePort: publicMenuUsecase.ModuleStatePort | null = null
  // #213: método real de cada cobro (payments) para el cierre del día. Lo inyecta connectors/restaurante-reports-payments.ts;
  // sin puerto el reporte sigue saliendo, con los cobros directos bajo `other`.
  reportPorts: reports.ReportPorts = {}
  // #211: canal en vivo (SSE) por hotel. Lo alimenta connectors/restaurante-events.ts vía publishEvent.
  private readonly eventHub = new events.RestaurantEventHub()

  constructor(
    readonly stations: RepositoryAdapter<StationDTO>,
    readonly categories: RepositoryAdapter<CategoryDTO>,
    readonly items: RepositoryAdapter<MenuItemDTO>,
    readonly tables: RepositoryAdapter<TableDTO>,
    readonly userRepo: RepositoryAdapter<any>,
    readonly logger: Logger,
    readonly auth: Auth,
    // RES-3: comandas. Opcionales para no romper tests que solo ejercitan carta/mesas.
    readonly orders?: RepositoryAdapter<OrderDTO>,
    readonly lines?: RepositoryAdapter<OrderItemDTO>,
    readonly config?: RepositoryAdapter<any>,
    readonly hotels?: RepositoryAdapter<any>,
    // F1: modificadores/variantes. Opcionales al final (retrocompat con callers/tests existentes).
    readonly modifierGroups?: RepositoryAdapter<ModifierGroupDTO>,
    readonly modifiers?: RepositoryAdapter<ModifierDTO>,
    // F2: catálogo de combos. Opcionales al final (retrocompat con callers/tests existentes).
    readonly combos?: RepositoryAdapter<ComboDTO>, readonly comboItems?: RepositoryAdapter<ComboItemDTO>,
    readonly counterCas?: orders.OrdersDeps['counterCas'], // #206: UPDATE condicional (orm.updateMany) para el numerador de comandas — el orm entra SOLO como esta interface mínima (ver usecases/order-number.ts; misma excepción que promo-codes/promo-atomic.ts)
    readonly transactor?: itemsCrud.ItemsTransactor, // #208: cascada atómica al borrar un ítem (grupos + opciones + ítem). Misma excepción acotada que counterCas: solo `transaction`.
    readonly rooms?: RepositoryAdapter<any>, // #211: número de habitación en el ticket del KDS ("Hab. 204")
  ) {}

  // Acumula handlers, nunca pisa el anterior (composición de sockets, usecases/compose-sockets.ts).
  setSockets(s: Partial<RestaurantSockets>): void { composeSockets(this.sockets, s) }
  /** #207: puerto de auditoría inyectado por conector (mismo patrón que reservas.setAuditDeps). */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }
  /** #208: puertos inyectados por conector (ver los campos de arriba). */
  setReservationPort(port: ReservationPort): void { this.reservationPort = port }
  setModuleStatePort(port: publicMenuUsecase.ModuleStatePort): void { this.moduleStatePort = port }
  /** Puertos de liquidación (folios/payments) inyectados por conector. Acumula (no pisa). */
  setSettlementDeps(p: Partial<settlement.SettlementPorts>): void { this.settlementPorts = { ...this.settlementPorts, ...p } }
  /** Puerto de recetas (inventario) inyectado por conector. Acumula (no pisa). Best-effort + graceful. */
  setRecipePorts(p: Partial<foodCost.RecipePorts>): void { this.recipePorts = { ...this.recipePorts, ...p } }
  /** #213: puertos del cierre del día (payments) inyectados por conector. Acumula (no pisa). */
  setReportPorts(p: Partial<reports.ReportPorts>): void { this.reportPorts = { ...this.reportPorts, ...p } }

  // Deps de cada usecase: usecases/deps.ts (selección de campos + guard "no configurado", sin lógica).
  private stationDeps() { return deps.stationDeps(this) }
  private catDeps() { return deps.catDeps(this) }
  private itemDeps() { return deps.itemDeps(this) }
  private tableDeps() { return deps.tableDeps(this) }
  private ordersDeps() { return deps.ordersDeps(this) }
  private orderLinesDeps() { return deps.orderLinesDeps(this) }
  private voidReasonsDeps() { return deps.voidReasonsDeps(this) }
  private modifierDeps() { return deps.modifierDeps(this) }
  private comboDeps() { return deps.comboDeps(this) }
  private foodCostDeps() { return deps.foodCostDeps(this) }
  private settlementDeps() { return deps.settlementDeps(this) }
  private reportsDeps() { return deps.reportsDeps(this) }
  private kdsDeps() { return deps.kdsDeps(this) }

  // ─── Estaciones (RES-0) — pantallas KDS configurables por hotel — delegan a usecases/stations-crud ───
  listStations(user: CurrentUser) { return stationsCrud.listStations(this.stationDeps(), user) }
  getStation(id: string, user: CurrentUser) { return stationsCrud.getStation(this.stationDeps(), id, user) }
  createStation(dto: stationsCrud.CreateStationInput, user: CurrentUser) { return stationsCrud.createStation(this.stationDeps(), dto, user) }
  updateStation(id: string, dto: stationsCrud.UpdateStationInput, user: CurrentUser) { return stationsCrud.updateStation(this.stationDeps(), id, dto, user) }
  deleteStation(id: string, user: CurrentUser) { return stationsCrud.deleteStation(this.stationDeps(), id, user) }

  // ─── Carta: categorías (RES-1) — delegan a usecases/categories-crud ───
  listCategories(user: CurrentUser, lang?: string) { return categoriesCrud.listCategories(this.catDeps(), user, lang) }
  getCategory(id: string, user: CurrentUser, lang?: string) { return categoriesCrud.getCategory(this.catDeps(), id, user, lang) }
  createCategory(dto: categoriesCrud.CreateCategoryInput, user: CurrentUser) { return categoriesCrud.createCategory(this.catDeps(), dto, user) }
  updateCategory(id: string, dto: categoriesCrud.UpdateCategoryInput, user: CurrentUser) { return categoriesCrud.updateCategory(this.catDeps(), id, dto, user) }
  deleteCategory(id: string, user: CurrentUser) { return categoriesCrud.deleteCategory(this.catDeps(), id, user) }

  // ─── Carta: ítems (RES-1) — delegan a usecases/items-crud ───
  async listItems(categoryId: string | undefined, user: CurrentUser, lang?: string) {
    const res = await itemsCrud.listItems(this.itemDeps(), categoryId, user, lang)
    // Nivel 2 stock fantasma: enriquece cada plato con `hasRecipe` si el port de inventario está
    // inyectado, para que la UI pinte "Sin receta" y el admin sepa qué recetar. Best-effort + graceful:
    // sin inventario, hasRecipe queda undefined y el badge no se renderiza (la carta no depende del catálogo).
    if (this.recipePorts?.menuItemsWithRecipe) {
      try {
        const withRecipe = new Set(await this.recipePorts.menuItemsWithRecipe(user))
        res.data.forEach((i) => { i.hasRecipe = withRecipe.has(i.id) })
      } catch { /* best-effort: la carta nunca depende del catálogo de inventario */ }
    }
    return res
  }
  getItem(id: string, user: CurrentUser, lang?: string) { return itemsCrud.getItem(this.itemDeps(), id, user, lang) }
  createItem(dto: itemsCrud.CreateItemInput, user: CurrentUser) { return itemsCrud.createItem(this.itemDeps(), dto, user) }
  updateItem(id: string, dto: itemsCrud.UpdateItemInput, user: CurrentUser) { return itemsCrud.updateItem(this.itemDeps(), id, dto, user) }
  setItemAvailability(id: string, available: number | undefined, user: CurrentUser) { return itemsCrud.setAvailability(this.itemDeps(), id, available, user) }
  deleteItem(id: string, user: CurrentUser) { return itemsCrud.deleteItem(this.itemDeps(), id, user) }

  // ─── Mesas (RES-2) — delegan a usecases/tables-crud ───
  listTables(user: CurrentUser) { return tablesCrud.listTables(this.tableDeps(), user) }
  getTable(id: string, user: CurrentUser) { return tablesCrud.getTable(this.tableDeps(), id, user) }
  createTable(dto: tablesCrud.CreateTableInput, user: CurrentUser) { return tablesCrud.createTable(this.tableDeps(), dto, user) }
  updateTable(id: string, dto: tablesCrud.UpdateTableInput, user: CurrentUser) { return tablesCrud.updateTable(this.tableDeps(), id, dto, user) }
  deleteTable(id: string, user: CurrentUser) { return tablesCrud.deleteTable(this.tableDeps(), id, user) }

  // ─── Comandas (RES-3) — delegan a usecases/orders + usecases/order-lines ───
  openOrder(dto: orders.OpenOrderInput, user: CurrentUser) { return orders.openOrder(this.ordersDeps(), dto, user) }
  listOrders(query: { status?: string; tableId?: string } | undefined, user: CurrentUser) { return orders.listOrders(this.ordersDeps(), query, user) }
  getOrder(id: string, user: CurrentUser) { return orders.getOrder(this.ordersDeps(), id, user) }
  sendOrder(id: string, user: CurrentUser) { return orders.sendOrder(this.ordersDeps(), id, user) }
  cancelOrder(id: string, reason: string | undefined, user: CurrentUser) { return orders.cancelOrder(this.ordersDeps(), id, reason, user) }
  addLine(orderId: string, dto: orderLines.AddLineInput, user: CurrentUser) { return orderLines.addLine(this.orderLinesDeps(), orderId, dto, user) }
  updateLine(orderId: string, lineId: string, dto: orderLines.UpdateLineInput, user: CurrentUser) { return orderLines.updateLine(this.orderLinesDeps(), orderId, lineId, dto, user) }
  removeLine(orderId: string, lineId: string, user: CurrentUser) { return orderLines.removeLine(this.orderLinesDeps(), orderId, lineId, user) }
  // #207: anular con motivo una línea ya enviada (no se borra: queda tachada, sale del KDS y de los totales).
  voidLine(orderId: string, lineId: string, reason: string | undefined, user: CurrentUser) { return orderLines.voidLine(this.orderLinesDeps(), orderId, lineId, reason, user) }
  getVoidReasons(user: CurrentUser) { return voidReasons.getVoidReasons(this.voidReasonsDeps(), user) }
  setVoidReasons(reasons: unknown, user: CurrentUser) { return voidReasons.setVoidReasons(this.voidReasonsDeps(), reasons, user) }

  // ─── Cuenta + cobro (RES-5) — delegan a usecases/settlement ───
  billOrder(id: string, dto: { tip?: number }, user: CurrentUser) { return settlement.billOrder(this.settlementDeps(), id, dto, user) }
  chargeToRoom(id: string, dto: { reservationId?: string }, user: CurrentUser) { return settlement.chargeToRoom(this.settlementDeps(), id, dto, user) }
  payOrder(id: string, dto: { method: string; successUrl?: string; cancelUrl?: string }, user: CurrentUser) { return settlement.payOrder(this.settlementDeps(), id, dto, user) }
  refundOrder(id: string, user: CurrentUser) { return settlement.refundOrder(this.settlementDeps(), id, user) }
  settlePaidOrder(id: string, paymentId: string, user: CurrentUser) { return settlement.settlePaidOrder(this.settlementDeps(), id, paymentId, user) } // fix-refund-pos-card: llamado por el conector (webhook onPaymentCompleted)
  unsettleOrder(id: string, user: CurrentUser) { return settlement.unsettleOrder(this.settlementDeps(), id, user) } // fix-refund-pos-card: llamado por el conector (webhook onPaymentExpired)

  // ─── Cierre del día (#213) — usecases/reports ───
  dailyReport(query: reports.DailyReportQuery | undefined, user: CurrentUser) { return reports.dailyReport(this.reportsDeps(), query, user) }

  // ─── KDS / cocina (RES-4) — delegan a usecases/kds ───
  kdsQueue(station: string | undefined, user: CurrentUser) { return kds.kdsQueue(this.kdsDeps(), station, user) }
  setLineStatus(lineId: string, status: LineStatus, user: CurrentUser) { return kds.setLineStatus(this.kdsDeps(), lineId, status, user) }

  // ─── Canal en vivo (#211) — usecases/events. publishEvent lo llama el conector; eventStream/eventsTicket, el controller ───
  publishEvent(hotelId: string, event: Omit<events.RestaurantEvent, 'at'>) { this.eventHub.publish(hotelId, event) }
  eventStream(user: CurrentUser) { return events.eventStream(this.eventHub, user) }
  eventsTicket(user: CurrentUser) { return events.eventsTicket(this.auth, user) }
  closeEventStreams() { this.eventHub.closeAll() }

  // ─── Modificadores/variantes (F1) — delegan a usecases/modifiers-crud ───
  listModifierGroups(menuItemId: string, user: CurrentUser) { return modifiersCrud.listGroups(this.modifierDeps(), menuItemId, user) }
  createModifierGroup(menuItemId: string, dto: modifiersCrud.CreateModifierGroupInput, user: CurrentUser) { return modifiersCrud.createGroup(this.modifierDeps(), menuItemId, dto, user) }
  updateModifierGroup(id: string, dto: modifiersCrud.UpdateModifierGroupInput, user: CurrentUser) { return modifiersCrud.updateGroup(this.modifierDeps(), id, dto, user) }
  deleteModifierGroup(id: string, user: CurrentUser) { return modifiersCrud.deleteGroup(this.modifierDeps(), id, user) }
  createModifier(groupId: string, dto: modifiersCrud.CreateModifierInput, user: CurrentUser) { return modifiersCrud.createModifier(this.modifierDeps(), groupId, dto, user) }
  updateModifier(id: string, dto: modifiersCrud.UpdateModifierInput, user: CurrentUser) { return modifiersCrud.updateModifier(this.modifierDeps(), id, dto, user) }
  deleteModifier(id: string, user: CurrentUser) { return modifiersCrud.deleteModifier(this.modifierDeps(), id, user) }

  // ─── Combos/paquetes (F2) — delegan a usecases/combos-crud ───
  listCombos(user: CurrentUser, lang?: string) { return combosCrud.listCombos(this.comboDeps(), user, lang) }
  getCombo(id: string, user: CurrentUser, lang?: string) { return combosCrud.getCombo(this.comboDeps(), id, user, lang) }
  createCombo(dto: combosCrud.CreateComboInput, user: CurrentUser) { return combosCrud.createCombo(this.comboDeps(), dto, user) }
  updateCombo(id: string, dto: combosCrud.UpdateComboInput, user: CurrentUser) { return combosCrud.updateCombo(this.comboDeps(), id, dto, user) }
  deleteCombo(id: string, user: CurrentUser) { return combosCrud.deleteCombo(this.comboDeps(), id, user) }

  // ─── Food cost (F3) — delegan a usecases/food-cost ───
  itemFoodCost(menuItemId: string, user: CurrentUser) { return foodCost.itemFoodCost(this.foodCostDeps(), menuItemId, user) }
  comboFoodCost(comboId: string, user: CurrentUser) { return foodCost.comboFoodCost(this.foodCostDeps(), comboId, user) }
  foodCostReport(user: CurrentUser) { return foodCost.foodCostReport(this.foodCostDeps(), user) }

  // ─── Carta pública sin sesión (F7): hotelId del PATH, sin req.user ni createModuleGuard ───
  publicMenu(hotelId: string, lang: string | undefined) { return publicMenuUsecase.publicMenu(deps.publicMenuDeps(this), hotelId, lang) }
}
