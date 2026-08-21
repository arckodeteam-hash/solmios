// restaurant/service.ts — Facade del módulo POS de restaurante. Orquesta; la lógica que crece vive en usecases/.
// Depende de RepositoryAdapter, NO del ORM directo. NO importa de otros módulos (va por conectores). Ver openspec/changes/restaurante-pos.
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, CurrentUser, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO } from './types'
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
import type { LineStatus } from './types'

export class RestaurantService {
  private sockets: RestaurantSockets = {}
  // Puertos de liquidación (folios/payments) que inyecta un conector. RES-5.
  private settlementPorts: settlement.SettlementPorts = {}
  // Puerto de recetas (inventario, conector restaurante-inventario.ts): hasRecipe (badge "Sin receta") +
  // F3 getRecipeCost (margen). `undefined` = inventario no montado → food-cost.ts degrada, nunca 500.
  private recipePorts: foodCost.RecipePorts = {}

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
    private readonly combos?: RepositoryAdapter<ComboDTO>,
    private readonly comboItems?: RepositoryAdapter<ComboItemDTO>,
    private readonly plans?: RepositoryAdapter<any>, private readonly subscriptions?: RepositoryAdapter<any>, // F7: gate del módulo restaurant — plan desde la suscripción activa (resolve-plan.ts)
  ) {}

  // Acumula handlers, nunca pisa el anterior (composición de sockets).
  setSockets(s: Partial<RestaurantSockets>): void {
    const next = s as Record<string, any>
    const cur = this.sockets as Record<string, any>
    for (const key of Object.keys(next)) {
      const h = next[key]
      if (!h) continue
      const prev = cur[key]
      cur[key] = prev ? async (...a: any[]) => { await prev(...a); await h(...a) } : h
    }
  }

  /** Puertos de liquidación (folios/payments) inyectados por conector. Acumula (no pisa). */
  setSettlementDeps(p: Partial<settlement.SettlementPorts>): void {
    this.settlementPorts = { ...this.settlementPorts, ...p }
  }

  /** Puerto de recetas (inventario) inyectado por conector. Acumula (no pisa). Best-effort + graceful. */
  setRecipePorts(p: Partial<foodCost.RecipePorts>): void {
    this.recipePorts = { ...this.recipePorts, ...p }
  }

  private stationDeps(): stationsCrud.StationsCrudDeps {
    return { stations: this.stations, userRepo: this.userRepo, auth: this.auth }
  }
  private catDeps(): categoriesCrud.CategoriesCrudDeps {
    return { categories: this.categories, items: this.items, stations: this.stations, userRepo: this.userRepo, auth: this.auth }
  }
  private itemDeps(): itemsCrud.ItemsCrudDeps {
    return { items: this.items, categories: this.categories, stations: this.stations, userRepo: this.userRepo, auth: this.auth }
  }
  private tableDeps(): tablesCrud.TablesCrudDeps {
    return { tables: this.tables, userRepo: this.userRepo, auth: this.auth }
  }
  private ordersDeps(): orders.OrdersDeps {
    if (!this.orders || !this.lines || !this.config) throw new ValidationError('Comandas no configuradas')
    return { orders: this.orders, lines: this.lines, tables: this.tables, config: this.config, userRepo: this.userRepo, auth: this.auth, sockets: this.sockets }
  }
  private orderLinesDeps(): orderLines.OrderLinesDeps {
    if (!this.orders || !this.lines || !this.config || !this.hotels) throw new ValidationError('Comandas no configuradas')
    return { orders: this.orders, lines: this.lines, items: this.items, categories: this.categories, stations: this.stations, config: this.config, hotels: this.hotels, userRepo: this.userRepo, auth: this.auth, modifierGroups: this.modifierGroups, modifiers: this.modifiers, combos: this.combos, comboItems: this.comboItems }
  }
  private modifierDeps(): modifiersCrud.ModifiersCrudDeps {
    if (!this.modifierGroups || !this.modifiers) throw new ValidationError('Modificadores no configurados')
    return { modifierGroups: this.modifierGroups, modifiers: this.modifiers, items: this.items, userRepo: this.userRepo, auth: this.auth }
  }
  private comboDeps(): combosCrud.CombosCrudDeps {
    if (!this.combos || !this.comboItems) throw new ValidationError('Combos no configurados')
    return { combos: this.combos, comboItems: this.comboItems, items: this.items, userRepo: this.userRepo, auth: this.auth }
  }
  private foodCostDeps(): foodCost.FoodCostDeps {
    return { items: this.items, combos: this.combos, comboItems: this.comboItems, recipePorts: this.recipePorts }
  }
  private settlementDeps(): settlement.SettlementDeps {
    if (!this.orders || !this.lines || !this.hotels) throw new ValidationError('Comandas no configuradas')
    return { orders: this.orders, lines: this.lines, tables: this.tables, hotels: this.hotels, userRepo: this.userRepo, auth: this.auth, sockets: this.sockets, ports: this.settlementPorts }
  }
  private kdsDeps(): kds.KdsDeps {
    if (!this.orders || !this.lines) throw new ValidationError('Comandas no configuradas')
    return { orders: this.orders, lines: this.lines, userRepo: this.userRepo, auth: this.auth, sockets: this.sockets }
  }

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
  cancelOrder(id: string, user: CurrentUser) { return orders.cancelOrder(this.ordersDeps(), id, user) }
  addLine(orderId: string, dto: orderLines.AddLineInput, user: CurrentUser) { return orderLines.addLine(this.orderLinesDeps(), orderId, dto, user) }
  updateLine(orderId: string, lineId: string, dto: orderLines.UpdateLineInput, user: CurrentUser) { return orderLines.updateLine(this.orderLinesDeps(), orderId, lineId, dto, user) }
  removeLine(orderId: string, lineId: string, user: CurrentUser) { return orderLines.removeLine(this.orderLinesDeps(), orderId, lineId, user) }

  // ─── Cuenta + cobro (RES-5) — delegan a usecases/settlement ───
  billOrder(id: string, dto: { tip?: number }, user: CurrentUser) { return settlement.billOrder(this.settlementDeps(), id, dto, user) }
  chargeToRoom(id: string, dto: { reservationId?: string }, user: CurrentUser) { return settlement.chargeToRoom(this.settlementDeps(), id, dto, user) }
  payOrder(id: string, dto: { method: string; successUrl?: string; cancelUrl?: string }, user: CurrentUser) { return settlement.payOrder(this.settlementDeps(), id, dto, user) }
  refundOrder(id: string, user: CurrentUser) { return settlement.refundOrder(this.settlementDeps(), id, user) }
  settlePaidOrder(id: string, paymentId: string, user: CurrentUser) { return settlement.settlePaidOrder(this.settlementDeps(), id, paymentId, user) } // fix-refund-pos-card: llamado por el conector (webhook onPaymentCompleted)
  unsettleOrder(id: string, user: CurrentUser) { return settlement.unsettleOrder(this.settlementDeps(), id, user) } // fix-refund-pos-card: llamado por el conector (webhook onPaymentExpired)

  // ─── KDS / cocina (RES-4) — delegan a usecases/kds ───
  kdsQueue(station: string | undefined, user: CurrentUser) { return kds.kdsQueue(this.kdsDeps(), station, user) }
  setLineStatus(lineId: string, status: LineStatus, user: CurrentUser) { return kds.setLineStatus(this.kdsDeps(), lineId, status, user) }

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
  publicMenu(hotelId: string, lang: string | undefined) { return publicMenuUsecase.publicMenu({ categories: this.categories, items: this.items, stations: this.stations, combos: this.combos!, comboItems: this.comboItems!, userRepo: this.userRepo, hotels: this.hotels!, config: this.config!, plans: this.plans!, subscriptions: this.subscriptions!, logger: this.logger }, hotelId, lang) }
}
