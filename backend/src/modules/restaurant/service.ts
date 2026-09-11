// restaurant/service.ts — Facade del módulo POS de restaurante. Orquesta; la lógica que crece vive en usecases/.
// Depende de RepositoryAdapter, NO del ORM directo. NO importa de otros módulos (va por conectores). Ver openspec/changes/restaurante-pos.
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, CurrentUser, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO, LineStatus, OrderPaymentDTO } from './types'
import type { RestaurantSockets } from './sockets'
import * as categoriesCrud from './usecases/categories-crud'
import * as itemsCrud from './usecases/items-crud'
import * as tablesCrud from './usecases/tables-crud'
import * as orders from './usecases/orders'
import * as orderLines from './usecases/order-lines'
import * as settlement from './usecases/settlement'
import * as splitPayments from './usecases/split-payments'
import * as kds from './usecases/kds'
import * as modifiersCrud from './usecases/modifiers-crud'
import * as stationsCrud from './usecases/stations-crud'
import * as combosCrud from './usecases/combos-crud'
import * as foodCost from './usecases/food-cost'
import * as publicMenuUsecase from './usecases/public-menu'
import * as voidReasons from './usecases/void-reasons'
import * as discounts from './usecases/discounts'
import * as events from './usecases/events'
import * as inHouse from './usecases/in-house'
import * as reports from './usecases/reports'
import { composeSockets } from './usecases/compose-sockets'
import {
  type RestaurantWiring, stationDeps, catDeps, itemDeps, tableDeps, ordersDeps, orderLinesDeps, voidReasonsDeps, discountsDeps,
  modifierDeps, comboDeps, foodCostDeps, settlementDeps, kdsDeps, inHouseDeps, publicMenuDeps, reportsDeps, splitPaymentsDeps,
} from './usecases/deps'
import type { AuditPort } from '../../shared/usecases/audit'
import type { ReservationPort } from './usecases/reservation-port'

export class RestaurantService {
  private sockets: RestaurantSockets = {}
  // Puertos de liquidación (folios/payments) que inyecta un conector. RES-5.
  private settlementPorts: settlement.SettlementPorts = {}
  // Puerto de recetas (conector restaurante-inventario.ts): hasRecipe + F3 getRecipeCost. `undefined` = inventario no montado → food-cost.ts degrada, nunca 500.
  private recipePorts: foodCost.RecipePorts = {}
  private auditPort: AuditPort | null = null   // #207: connectors/restaurante-auditlog.ts. null = sin auditlog montado: anular sigue funcionando, sin rastro
  // #208: reservas por conector (restaurante-reservas.ts; null = room service/cargo a habitación fallan cerrado) y gate del módulo para la carta pública (null = 404 genérico).
  private reservationPort: ReservationPort | null = null
  private moduleStatePort: publicMenuUsecase.ModuleStatePort | null = null
  // #213: la plata del cierre del día sale de `payments`/folio por conectores (restaurante-reports-*.ts), nunca de la comanda. Sin puertos, ventas en cero.
  private reportPorts: reports.ReportPorts = {}
  private readonly eventHub = new events.RestaurantEventHub()   // #211: canal en vivo (SSE) por hotel; lo alimenta connectors/restaurante-events.ts vía publishEvent

  constructor(
    private readonly stations: RepositoryAdapter<StationDTO>,
    private readonly categories: RepositoryAdapter<CategoryDTO>,
    private readonly items: RepositoryAdapter<MenuItemDTO>,
    private readonly tables: RepositoryAdapter<TableDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly auth: Auth,
    // RES-3: comandas. Opcionales para no romper tests que solo ejercitan carta/mesas.
    private readonly orders?: RepositoryAdapter<OrderDTO>,
    private readonly lines?: RepositoryAdapter<OrderItemDTO>,
    private readonly config?: RepositoryAdapter<any>,
    private readonly hotels?: RepositoryAdapter<any>,
    // F1: modificadores/variantes. Opcionales al final (retrocompat con callers/tests existentes).
    private readonly modifierGroups?: RepositoryAdapter<ModifierGroupDTO>,
    private readonly modifiers?: RepositoryAdapter<ModifierDTO>,
    // F2: catálogo de combos. Opcionales al final (retrocompat con callers/tests existentes).
    private readonly combos?: RepositoryAdapter<ComboDTO>, private readonly comboItems?: RepositoryAdapter<ComboItemDTO>,
    private readonly counterCas?: orders.OrdersDeps['counterCas'], // #206: UPDATE condicional (orm.updateMany) para el numerador de comandas — el orm entra SOLO como esta interface mínima (ver usecases/order-number.ts; misma excepción que promo-codes/promo-atomic.ts)
    private readonly transactor?: itemsCrud.ItemsTransactor, // #208: cascada atómica al borrar un ítem (grupos + opciones + ítem). Misma excepción acotada que counterCas: solo `transaction`.
    private readonly rooms?: RepositoryAdapter<any>, // #211: número de habitación en el ticket del KDS ("Hab. 204")
    private readonly guests?: RepositoryAdapter<any>, // #209: nombre del huésped en la comanda de room service ("Hab. 204 · Pérez"), misma lectura acotada que rooms
    private readonly orderPayments?: RepositoryAdapter<OrderPaymentDTO>, // #214: partes del cobro (dividir cuenta / pagos parciales)
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
  /** #213: puertos del cierre del día (payments/folios) inyectados por conector. Acumula (no pisa). */
  setReportPorts(p: Partial<reports.ReportPorts>): void { this.reportPorts = { ...this.reportPorts, ...p } }

  /** Lo que cada usecase recibe se arma en usecases/deps.ts (extraído del service en #209, ver ese archivo). */
  private w(): RestaurantWiring {
    return {
      stations: this.stations, categories: this.categories, items: this.items, tables: this.tables, userRepo: this.userRepo, logger: this.logger, auth: this.auth,
      orders: this.orders, lines: this.lines, config: this.config, hotels: this.hotels, modifierGroups: this.modifierGroups, modifiers: this.modifiers,
      combos: this.combos, comboItems: this.comboItems, counterCas: this.counterCas, transactor: this.transactor, rooms: this.rooms, guests: this.guests,
      orderPayments: this.orderPayments, sockets: this.sockets, settlementPorts: this.settlementPorts, recipePorts: this.recipePorts, auditPort: this.auditPort,
      reservationPort: this.reservationPort, moduleStatePort: this.moduleStatePort, reportPorts: this.reportPorts,
    }
  }

  // ─── Estaciones (RES-0) — pantallas KDS configurables por hotel — delegan a usecases/stations-crud ───
  listStations(user: CurrentUser) { return stationsCrud.listStations(stationDeps(this.w()), user) }
  getStation(id: string, user: CurrentUser) { return stationsCrud.getStation(stationDeps(this.w()), id, user) }
  createStation(dto: stationsCrud.CreateStationInput, user: CurrentUser) { return stationsCrud.createStation(stationDeps(this.w()), dto, user) }
  updateStation(id: string, dto: stationsCrud.UpdateStationInput, user: CurrentUser) { return stationsCrud.updateStation(stationDeps(this.w()), id, dto, user) }
  deleteStation(id: string, user: CurrentUser) { return stationsCrud.deleteStation(stationDeps(this.w()), id, user) }

  // ─── Carta: categorías (RES-1) — delegan a usecases/categories-crud ───
  listCategories(user: CurrentUser, lang?: string) { return categoriesCrud.listCategories(catDeps(this.w()), user, lang) }
  getCategory(id: string, user: CurrentUser, lang?: string) { return categoriesCrud.getCategory(catDeps(this.w()), id, user, lang) }
  createCategory(dto: categoriesCrud.CreateCategoryInput, user: CurrentUser) { return categoriesCrud.createCategory(catDeps(this.w()), dto, user) }
  updateCategory(id: string, dto: categoriesCrud.UpdateCategoryInput, user: CurrentUser) { return categoriesCrud.updateCategory(catDeps(this.w()), id, dto, user) }
  deleteCategory(id: string, user: CurrentUser) { return categoriesCrud.deleteCategory(catDeps(this.w()), id, user) }

  // ─── Carta: ítems (RES-1) — delegan a usecases/items-crud ───
  listItems(categoryId: string | undefined, user: CurrentUser, lang?: string) { return itemsCrud.listItems(itemDeps(this.w()), categoryId, user, lang) }
  getItem(id: string, user: CurrentUser, lang?: string) { return itemsCrud.getItem(itemDeps(this.w()), id, user, lang) }
  createItem(dto: itemsCrud.CreateItemInput, user: CurrentUser) { return itemsCrud.createItem(itemDeps(this.w()), dto, user) }
  updateItem(id: string, dto: itemsCrud.UpdateItemInput, user: CurrentUser) { return itemsCrud.updateItem(itemDeps(this.w()), id, dto, user) }
  setItemAvailability(id: string, available: number | undefined, user: CurrentUser) { return itemsCrud.setAvailability(itemDeps(this.w()), id, available, user) }
  deleteItem(id: string, user: CurrentUser) { return itemsCrud.deleteItem(itemDeps(this.w()), id, user) }

  // ─── Mesas (RES-2) — delegan a usecases/tables-crud ───
  listTables(user: CurrentUser) { return tablesCrud.listTables(tableDeps(this.w()), user) }
  getTable(id: string, user: CurrentUser) { return tablesCrud.getTable(tableDeps(this.w()), id, user) }
  createTable(dto: tablesCrud.CreateTableInput, user: CurrentUser) { return tablesCrud.createTable(tableDeps(this.w()), dto, user) }
  updateTable(id: string, dto: tablesCrud.UpdateTableInput, user: CurrentUser) { return tablesCrud.updateTable(tableDeps(this.w()), id, dto, user) }
  deleteTable(id: string, user: CurrentUser) { return tablesCrud.deleteTable(tableDeps(this.w()), id, user) }

  // ─── Comandas (RES-3) — delegan a usecases/orders + usecases/order-lines ───
  openOrder(dto: orders.OpenOrderInput, user: CurrentUser) { return orders.openOrder(ordersDeps(this.w()), dto, user) }
  listOrders(query: { status?: string; tableId?: string } | undefined, user: CurrentUser) { return orders.listOrders(ordersDeps(this.w()), query, user) }
  getOrder(id: string, user: CurrentUser) { return orders.getOrder(ordersDeps(this.w()), id, user) }
  sendOrder(id: string, user: CurrentUser) { return orders.sendOrder(ordersDeps(this.w()), id, user) }
  cancelOrder(id: string, reason: string | undefined, user: CurrentUser) { return orders.cancelOrder(ordersDeps(this.w()), id, reason, user) }
  addLine(orderId: string, dto: orderLines.AddLineInput, user: CurrentUser) { return orderLines.addLine(orderLinesDeps(this.w()), orderId, dto, user) }
  updateLine(orderId: string, lineId: string, dto: orderLines.UpdateLineInput, user: CurrentUser) { return orderLines.updateLine(orderLinesDeps(this.w()), orderId, lineId, dto, user) }
  removeLine(orderId: string, lineId: string, user: CurrentUser) { return orderLines.removeLine(orderLinesDeps(this.w()), orderId, lineId, user) }
  // #207: anular con motivo una línea ya enviada (no se borra: queda tachada, sale del KDS y de los totales).
  voidLine(orderId: string, lineId: string, reason: string | undefined, user: CurrentUser) { return orderLines.voidLine(orderLinesDeps(this.w()), orderId, lineId, reason, user) }
  getVoidReasons(user: CurrentUser) { return voidReasons.getVoidReasons(voidReasonsDeps(this.w()), user) }
  setVoidReasons(reasons: unknown, user: CurrentUser) { return voidReasons.setVoidReasons(voidReasonsDeps(this.w()), reasons, user) }
  // #215: descuentos y cortesías — usecases/discounts (ruta `restaurant:discount`; tope y motivos por hotel).
  applyOrderDiscount(orderId: string, dto: discounts.DiscountInput, user: CurrentUser) { return discounts.applyOrderDiscount(discountsDeps(this.w()), orderId, dto, user) }
  removeOrderDiscount(orderId: string, user: CurrentUser) { return discounts.removeOrderDiscount(discountsDeps(this.w()), orderId, user) }
  applyLineDiscount(orderId: string, lineId: string, dto: discounts.DiscountInput, user: CurrentUser) { return discounts.applyLineDiscount(discountsDeps(this.w()), orderId, lineId, dto, user) }
  removeLineDiscount(orderId: string, lineId: string, user: CurrentUser) { return discounts.removeLineDiscount(discountsDeps(this.w()), orderId, lineId, user) }
  getDiscountPolicy(user: CurrentUser) { return discounts.getDiscountPolicy(discountsDeps(this.w()), user) }
  setDiscountPolicy(input: discounts.DiscountPolicyInput, user: CurrentUser) { return discounts.setDiscountPolicy(discountsDeps(this.w()), input, user) }

  // ─── Cuenta + cobro (RES-5) — delegan a usecases/settlement ───
  billOrder(id: string, dto: { tip?: number }, user: CurrentUser) { return settlement.billOrder(settlementDeps(this.w()), id, dto, user) }
  chargeToRoom(id: string, dto: { reservationId?: string }, user: CurrentUser) { return settlement.chargeToRoom(settlementDeps(this.w()), id, dto, user) }
  payOrder(id: string, dto: { method: string; successUrl?: string; cancelUrl?: string }, user: CurrentUser) { return settlement.payOrder(settlementDeps(this.w()), id, dto, user) }
  refundOrder(id: string, dto: { reason?: string }, user: CurrentUser) { return settlement.refundOrder(settlementDeps(this.w()), id, dto, user) }
  settlePaidOrder(id: string, paymentId: string, user: CurrentUser) { return settlement.settlePaidOrder(settlementDeps(this.w()), id, paymentId, user) } // fix-refund-pos-card: llamado por el conector (webhook onPaymentCompleted)
  unsettleOrder(id: string, user: CurrentUser) { return settlement.unsettleOrder(settlementDeps(this.w()), id, user) } // fix-refund-pos-card: llamado por el conector (webhook onPaymentExpired)
  listOrderPayments(orderId: string, user: CurrentUser) { return splitPayments.listOrderPayments(splitPaymentsDeps(this.w()), orderId, user) } // #214 dividir cuenta (usecases/split-payments); settle/expire los llama el conector (webhook de Stripe por parte)
  splitPreview(orderId: string, parts: number, user: CurrentUser) { return splitPayments.splitPreview(splitPaymentsDeps(this.w()), orderId, parts, user) }
  addOrderPayment(orderId: string, dto: splitPayments.AddOrderPaymentInput, user: CurrentUser) { return splitPayments.addOrderPayment(splitPaymentsDeps(this.w()), orderId, dto, user) }
  refundOrderPayment(orderId: string, partId: string, dto: { reason?: string }, user: CurrentUser) { return splitPayments.refundOrderPayment(splitPaymentsDeps(this.w()), orderId, partId, dto, user) }
  settleOrderPayment(partId: string, paymentId: string, user: CurrentUser) { return splitPayments.settleOrderPayment(splitPaymentsDeps(this.w()), partId, paymentId, user) }
  expireOrderPayment(partId: string, user: CurrentUser) { return splitPayments.expireOrderPayment(splitPaymentsDeps(this.w()), partId, user) }

  // ─── KDS / cocina (RES-4) — delegan a usecases/kds ───
  kdsQueue(station: string | undefined, user: CurrentUser) { return kds.kdsQueue(kdsDeps(this.w()), station, user) }
  setLineStatus(lineId: string, status: LineStatus, user: CurrentUser) { return kds.setLineStatus(kdsDeps(this.w()), lineId, status, user) }

  // ─── Canal en vivo (#211) — usecases/events. publishEvent lo llama el conector; eventStream/eventsTicket, el controller ───
  publishEvent(hotelId: string, event: Omit<events.RestaurantEvent, 'at'>) { this.eventHub.publish(hotelId, event) }
  eventStream(user: CurrentUser) { return events.eventStream(this.eventHub, user) }
  eventsTicket(user: CurrentUser) { return events.eventsTicket(this.auth, user) }
  closeEventStreams() { this.eventHub.closeAll() }

  // ─── Modificadores/variantes (F1) — delegan a usecases/modifiers-crud ───
  listModifierGroups(menuItemId: string, user: CurrentUser) { return modifiersCrud.listGroups(modifierDeps(this.w()), menuItemId, user) }
  createModifierGroup(menuItemId: string, dto: modifiersCrud.CreateModifierGroupInput, user: CurrentUser) { return modifiersCrud.createGroup(modifierDeps(this.w()), menuItemId, dto, user) }
  updateModifierGroup(id: string, dto: modifiersCrud.UpdateModifierGroupInput, user: CurrentUser) { return modifiersCrud.updateGroup(modifierDeps(this.w()), id, dto, user) }
  deleteModifierGroup(id: string, user: CurrentUser) { return modifiersCrud.deleteGroup(modifierDeps(this.w()), id, user) }
  createModifier(groupId: string, dto: modifiersCrud.CreateModifierInput, user: CurrentUser) { return modifiersCrud.createModifier(modifierDeps(this.w()), groupId, dto, user) }
  updateModifier(id: string, dto: modifiersCrud.UpdateModifierInput, user: CurrentUser) { return modifiersCrud.updateModifier(modifierDeps(this.w()), id, dto, user) }
  deleteModifier(id: string, user: CurrentUser) { return modifiersCrud.deleteModifier(modifierDeps(this.w()), id, user) }

  // ─── Combos/paquetes (F2) — delegan a usecases/combos-crud ───
  listCombos(user: CurrentUser, lang?: string) { return combosCrud.listCombos(comboDeps(this.w()), user, lang) }
  getCombo(id: string, user: CurrentUser, lang?: string) { return combosCrud.getCombo(comboDeps(this.w()), id, user, lang) }
  createCombo(dto: combosCrud.CreateComboInput, user: CurrentUser) { return combosCrud.createCombo(comboDeps(this.w()), dto, user) }
  updateCombo(id: string, dto: combosCrud.UpdateComboInput, user: CurrentUser) { return combosCrud.updateCombo(comboDeps(this.w()), id, dto, user) }
  deleteCombo(id: string, user: CurrentUser) { return combosCrud.deleteCombo(comboDeps(this.w()), id, user) }

  // ─── Food cost (F3) — delegan a usecases/food-cost ───
  itemFoodCost(menuItemId: string, user: CurrentUser) { return foodCost.itemFoodCost(foodCostDeps(this.w()), menuItemId, user) }
  comboFoodCost(comboId: string, user: CurrentUser) { return foodCost.comboFoodCost(foodCostDeps(this.w()), comboId, user) }
  foodCostReport(user: CurrentUser) { return foodCost.foodCostReport(foodCostDeps(this.w()), user) }

  // ─── Carta pública sin sesión (F7): hotelId del PATH, sin req.user ni createModuleGuard ───
  publicMenu(hotelId: string, lang: string | undefined) { return publicMenuUsecase.publicMenu(publicMenuDeps(this.w()), hotelId, lang) }

  // ─── Alojados (#209): buscador por habitación/apellido para room service y cargo a habitación — usecases/in-house ───
  searchInHouse(query: { q?: unknown; id?: unknown }, user: CurrentUser) { return inHouse.searchInHouse(inHouseDeps(this.w()), query, user) }
  // ─── Cierre del día (#213): la plata sale de payments/folio por conectores — usecases/reports ───
  dailyReport(query: reports.DailyReportQuery | undefined, user: CurrentUser) { return reports.dailyReport(reportsDeps(this.w()), query, user) }
}
