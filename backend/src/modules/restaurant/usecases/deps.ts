// restaurant/usecases/deps.ts — Armado de las `*Deps` de cada usecase a partir del estado del service (#213).
//
// El service es una fachada: repos + puertos que inyectan los conectores. Cada usecase declara su propio
// contrato de dependencias (`OrdersDeps`, `SettlementDeps`, …) y acá se traduce el estado del service a
// ese contrato — antes vivía como 13 métodos privados en service.ts, que pasó el tope de 200 líneas del
// analyzer al sumar el cierre del día. Sin lógica: solo selección de campos y el guard "no configurado".
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { ValidationError } from 'arckode-framework'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO } from '../types'
import type { RestaurantSockets } from '../sockets'
import type { AuditPort } from '../../../shared/usecases/audit'
import type { ReservationPort } from './reservation-port'
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
import type * as publicMenu from './public-menu'
import type * as voidReasons from './void-reasons'
import type * as reports from './reports'

/** Estado del service que los usecases necesitan. Los opcionales lo son por retrocompat con tests que solo ejercitan carta/mesas. */
export interface RestaurantState {
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
  sockets: RestaurantSockets
  settlementPorts: settlement.SettlementPorts
  recipePorts: foodCost.RecipePorts
  auditPort: AuditPort | null
  reservationPort: ReservationPort | null
  moduleStatePort: publicMenu.ModuleStatePort | null
  reportPorts: reports.ReportPorts
}

const NOT_CONFIGURED = 'Comandas no configuradas'

export const stationDeps = (s: RestaurantState): stationsCrud.StationsCrudDeps => ({ stations: s.stations, userRepo: s.userRepo, auth: s.auth })
export const catDeps = (s: RestaurantState): categoriesCrud.CategoriesCrudDeps => ({ categories: s.categories, items: s.items, stations: s.stations, userRepo: s.userRepo, auth: s.auth })
export const itemDeps = (s: RestaurantState): itemsCrud.ItemsCrudDeps => ({ items: s.items, categories: s.categories, stations: s.stations, userRepo: s.userRepo, auth: s.auth, comboItems: s.comboItems, combos: s.combos, modifierGroups: s.modifierGroups, modifiers: s.modifiers, transactor: s.transactor, recipes: s.recipePorts, logger: s.logger })
export const tableDeps = (s: RestaurantState): tablesCrud.TablesCrudDeps => ({ tables: s.tables, userRepo: s.userRepo, auth: s.auth, orders: s.orders, sockets: s.sockets })
export function ordersDeps(s: RestaurantState): orders.OrdersDeps {
  if (!s.orders || !s.lines || !s.config) throw new ValidationError(NOT_CONFIGURED)
  return { orders: s.orders, lines: s.lines, tables: s.tables, config: s.config, counterCas: s.counterCas, userRepo: s.userRepo, auth: s.auth, sockets: s.sockets, audit: s.auditPort, logger: s.logger, reservations: s.reservationPort }
}
export function orderLinesDeps(s: RestaurantState): orderLines.OrderLinesDeps {
  if (!s.orders || !s.lines || !s.config || !s.hotels) throw new ValidationError(NOT_CONFIGURED)
  return { orders: s.orders, lines: s.lines, items: s.items, categories: s.categories, stations: s.stations, config: s.config, hotels: s.hotels, userRepo: s.userRepo, auth: s.auth, modifierGroups: s.modifierGroups, modifiers: s.modifiers, combos: s.combos, comboItems: s.comboItems, audit: s.auditPort, logger: s.logger, sockets: s.sockets }
}
export function voidReasonsDeps(s: RestaurantState): voidReasons.VoidReasonsDeps {
  if (!s.config) throw new ValidationError(NOT_CONFIGURED)
  return { config: s.config }
}
export function modifierDeps(s: RestaurantState): modifiersCrud.ModifiersCrudDeps {
  if (!s.modifierGroups || !s.modifiers) throw new ValidationError('Modificadores no configurados')
  return { modifierGroups: s.modifierGroups, modifiers: s.modifiers, items: s.items, userRepo: s.userRepo, auth: s.auth }
}
export function comboDeps(s: RestaurantState): combosCrud.CombosCrudDeps {
  if (!s.combos || !s.comboItems) throw new ValidationError('Combos no configurados')
  return { combos: s.combos, comboItems: s.comboItems, items: s.items, userRepo: s.userRepo, auth: s.auth }
}
export const foodCostDeps = (s: RestaurantState): foodCost.FoodCostDeps => ({ items: s.items, combos: s.combos, comboItems: s.comboItems, recipePorts: s.recipePorts })
export function settlementDeps(s: RestaurantState): settlement.SettlementDeps {
  if (!s.orders || !s.lines || !s.hotels) throw new ValidationError(NOT_CONFIGURED)
  return { orders: s.orders, lines: s.lines, tables: s.tables, hotels: s.hotels, userRepo: s.userRepo, auth: s.auth, sockets: s.sockets, ports: s.settlementPorts, audit: s.auditPort, logger: s.logger, reservations: s.reservationPort }
}
/** #213 — cierre del día. */
export function reportsDeps(s: RestaurantState): reports.ReportsDeps {
  if (!s.orders || !s.lines || !s.hotels) throw new ValidationError(NOT_CONFIGURED)
  return { orders: s.orders, lines: s.lines, hotels: s.hotels, ports: s.reportPorts }
}
export function kdsDeps(s: RestaurantState): kds.KdsDeps {
  if (!s.orders || !s.lines) throw new ValidationError(NOT_CONFIGURED)
  return { orders: s.orders, lines: s.lines, userRepo: s.userRepo, auth: s.auth, sockets: s.sockets, tables: s.tables, rooms: s.rooms }
}
/** Carta pública (F7): hotelId del PATH, sin req.user. `combos`/`comboItems`/`hotels` van con `!` como antes (montados en index.ts). */
export const publicMenuDeps = (s: RestaurantState): publicMenu.PublicMenuDeps => ({ categories: s.categories, items: s.items, stations: s.stations, combos: s.combos!, comboItems: s.comboItems!, userRepo: s.userRepo, hotels: s.hotels!, moduleState: s.moduleStatePort, logger: s.logger })
