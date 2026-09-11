// restaurant/usecases/deps.ts — Cableado de dependencias de cada usecase a partir de lo que tiene el
// service (repos, auth, puertos inyectados por conectores). Vivía como métodos privados `*Deps()` en
// service.ts; se extrajo en #209 porque el service estaba al límite de las 200 líneas (GOD_SERVICE del
// analyzer) y comprimirlo escondía qué recibe cada usecase. Cero lógica: solo arma objetos.
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO } from '../types'
import type { RestaurantSockets } from '../sockets'
import type { AuditPort } from '../../../shared/usecases/audit'
import type * as categoriesCrud from './categories-crud'
import type * as itemsCrud from './items-crud'
import type * as tablesCrud from './tables-crud'
import type * as orders from './orders'
import type * as orderLines from './order-lines'
import type * as settlement from './settlement'
import type * as kds from './kds'
import type * as modifiersCrud from './modifiers-crud'
import type * as stationsCrud from './stations-crud'
import type * as combosCrud from './combos-crud'
import type * as foodCost from './food-cost'
import type * as voidReasons from './void-reasons'
import type * as discounts from './discounts'
import type * as inHouse from './in-house'
import type * as reports from './reports'
import type * as publicMenuUsecase from './public-menu'
import type { ReservationPort } from './reservation-port'

/** Todo lo que el service tiene a mano. Los opcionales lo son por retrocompat con tests que solo ejercitan carta/mesas. */
export interface RestaurantWiring {
  stations: RepositoryAdapter<StationDTO>
  categories: RepositoryAdapter<CategoryDTO>
  items: RepositoryAdapter<MenuItemDTO>
  tables: RepositoryAdapter<TableDTO>
  userRepo: RepositoryAdapter<any>
  logger: Logger
  auth: Auth
  orders?: RepositoryAdapter<OrderDTO>
  lines?: RepositoryAdapter<OrderItemDTO>
  config?: RepositoryAdapter<any>
  hotels?: RepositoryAdapter<any>
  modifierGroups?: RepositoryAdapter<ModifierGroupDTO>
  modifiers?: RepositoryAdapter<ModifierDTO>
  combos?: RepositoryAdapter<ComboDTO>
  comboItems?: RepositoryAdapter<ComboItemDTO>
  counterCas?: orders.OrdersDeps['counterCas']
  transactor?: itemsCrud.ItemsTransactor
  rooms?: RepositoryAdapter<any>
  guests?: RepositoryAdapter<any>
  sockets: RestaurantSockets
  settlementPorts: settlement.SettlementPorts
  recipePorts: foodCost.RecipePorts
  auditPort: AuditPort | null
  reservationPort: ReservationPort | null
  moduleStatePort: publicMenuUsecase.ModuleStatePort | null
  /** #213: la plata del cierre del día (payments + cargo al folio), por conectores. Sin puertos, ventas en cero. */
  reportPorts: reports.ReportPorts
}

const NO_ORDERS = 'Comandas no configuradas'

export function stationDeps(w: RestaurantWiring): stationsCrud.StationsCrudDeps { return { stations: w.stations, userRepo: w.userRepo, auth: w.auth } }
export function catDeps(w: RestaurantWiring): categoriesCrud.CategoriesCrudDeps { return { categories: w.categories, items: w.items, stations: w.stations, userRepo: w.userRepo, auth: w.auth } }
export function itemDeps(w: RestaurantWiring): itemsCrud.ItemsCrudDeps {
  return { items: w.items, categories: w.categories, stations: w.stations, userRepo: w.userRepo, auth: w.auth, comboItems: w.comboItems, combos: w.combos, modifierGroups: w.modifierGroups, modifiers: w.modifiers, transactor: w.transactor, recipes: w.recipePorts, logger: w.logger }
}
export function tableDeps(w: RestaurantWiring): tablesCrud.TablesCrudDeps { return { tables: w.tables, userRepo: w.userRepo, auth: w.auth, orders: w.orders, sockets: w.sockets } }
export function ordersDeps(w: RestaurantWiring): orders.OrdersDeps {
  if (!w.orders || !w.lines || !w.config) throw new ValidationError(NO_ORDERS)
  return { orders: w.orders, lines: w.lines, tables: w.tables, config: w.config, counterCas: w.counterCas, userRepo: w.userRepo, auth: w.auth, sockets: w.sockets, audit: w.auditPort, logger: w.logger, reservations: w.reservationPort, labels: { rooms: w.rooms, guests: w.guests }, guests: w.guests, rooms: w.rooms, hotels: w.hotels }
}
export function orderLinesDeps(w: RestaurantWiring): orderLines.OrderLinesDeps {
  if (!w.orders || !w.lines || !w.config || !w.hotels) throw new ValidationError(NO_ORDERS)
  return { orders: w.orders, lines: w.lines, items: w.items, categories: w.categories, stations: w.stations, config: w.config, hotels: w.hotels, userRepo: w.userRepo, auth: w.auth, modifierGroups: w.modifierGroups, modifiers: w.modifiers, combos: w.combos, comboItems: w.comboItems, audit: w.auditPort, logger: w.logger, sockets: w.sockets }
}
export function voidReasonsDeps(w: RestaurantWiring): voidReasons.VoidReasonsDeps { if (!w.config) throw new ValidationError(NO_ORDERS); return { config: w.config } }
/** #215: descuentos/cortesías. Mismos repos que las líneas + config (tope y motivos) + audit. */
export function discountsDeps(w: RestaurantWiring): discounts.DiscountsDeps {
  if (!w.orders || !w.lines || !w.config) throw new ValidationError(NO_ORDERS)
  return { orders: w.orders, lines: w.lines, config: w.config, userRepo: w.userRepo, auth: w.auth, audit: w.auditPort, logger: w.logger, sockets: w.sockets }
}
export function modifierDeps(w: RestaurantWiring): modifiersCrud.ModifiersCrudDeps {
  if (!w.modifierGroups || !w.modifiers) throw new ValidationError('Modificadores no configurados')
  return { modifierGroups: w.modifierGroups, modifiers: w.modifiers, items: w.items, userRepo: w.userRepo, auth: w.auth }
}
export function comboDeps(w: RestaurantWiring): combosCrud.CombosCrudDeps {
  if (!w.combos || !w.comboItems) throw new ValidationError('Combos no configurados')
  return { combos: w.combos, comboItems: w.comboItems, items: w.items, userRepo: w.userRepo, auth: w.auth }
}
export function foodCostDeps(w: RestaurantWiring): foodCost.FoodCostDeps { return { items: w.items, combos: w.combos, comboItems: w.comboItems, recipePorts: w.recipePorts } }
export function settlementDeps(w: RestaurantWiring): settlement.SettlementDeps {
  if (!w.orders || !w.lines || !w.hotels) throw new ValidationError(NO_ORDERS)
  return { orders: w.orders, lines: w.lines, tables: w.tables, hotels: w.hotels, userRepo: w.userRepo, auth: w.auth, sockets: w.sockets, ports: w.settlementPorts, audit: w.auditPort, logger: w.logger, reservations: w.reservationPort }
}
export function kdsDeps(w: RestaurantWiring): kds.KdsDeps {
  if (!w.orders || !w.lines) throw new ValidationError(NO_ORDERS)
  return { orders: w.orders, lines: w.lines, userRepo: w.userRepo, auth: w.auth, sockets: w.sockets, tables: w.tables, rooms: w.rooms }
}
/** #213: cierre del día. */
export function reportsDeps(w: RestaurantWiring): reports.ReportsDeps {
  if (!w.orders || !w.lines || !w.hotels) throw new ValidationError(NO_ORDERS)
  return { orders: w.orders, lines: w.lines, hotels: w.hotels, ports: w.reportPorts }
}
/** #209: buscador de alojados. Sin puerto de reservas el usecase falla cerrado. */
export function inHouseDeps(w: RestaurantWiring): inHouse.InHouseDeps { return { reservations: w.reservationPort, userRepo: w.userRepo } }
export function publicMenuDeps(w: RestaurantWiring): publicMenuUsecase.PublicMenuDeps {
  return { categories: w.categories, items: w.items, stations: w.stations, combos: w.combos!, comboItems: w.comboItems!, userRepo: w.userRepo, hotels: w.hotels!, moduleState: w.moduleStatePort, logger: w.logger }
}
