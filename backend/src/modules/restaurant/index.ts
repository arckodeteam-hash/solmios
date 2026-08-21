// restaurant/index.ts — PUERTA PÚBLICA del módulo POS de restaurante.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
import { createModule, OrmRepository } from 'arckode-framework'
import { registerRestaurantModels } from './model'
import { RestaurantService } from './service'
import { RestaurantController } from './controller'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { RestaurantService }
export type {
  StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO,
  OrderType, OrderStatus, LineStatus, TableStatus, Settlement,
  ModifierGroupDTO, ModifierDTO, ModifierSelectionType, OrderItemModifierSnapshot,
} from './types'
export type { RestaurantSockets } from './sockets'
export { RestaurantValidator, CreateStationSchema, UpdateStationSchema } from './validators/schema'
export { registerRestaurantModels } from './model'
export type { SettlementPorts, ChargeToFolioInput, RecordPaymentInput, ChargeCardPaymentInput } from './usecases/settlement'
export type { ComboDTO, ComboItemDTO } from './types'

export function RestaurantModule() {
  return createModule({
    name: 'restaurant',
    version: '1.0.0',
    description: 'POS de restaurante (estaciones/KDS, carta, mesas, comandas, cuenta)',

    contract: {
      name: 'restaurant',
      version: '1.0.0',
      description: 'POS de restaurante',
      actions: ['listStations', 'getStation', 'createStation', 'updateStation', 'deleteStation'],
      events: ['onOrderSent', 'onLineStatusChanged', 'onOrderCharged', 'onOrderPaid', 'onOrderRefunded'],
      tables: [
        'restaurant_stations', 'menu_categories', 'menu_items',
        'restaurant_tables', 'restaurant_orders', 'restaurant_order_items',
      ],
      dependencies: [],
      rules: ['No importar de otros módulos', 'hotelId del JWT (multi-tenant)', 'Estaciones configurables (no hardcode)'],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('restaurant: auth dependency required')
      registerRestaurantModels(orm)

      const stations = new OrmRepository<StationDTO>(orm, 'RestaurantStations')
      const categories = new OrmRepository<CategoryDTO>(orm, 'MenuCategories')
      const items = new OrmRepository<MenuItemDTO>(orm, 'MenuItems')
      const tables = new OrmRepository<TableDTO>(orm, 'RestaurantTables')
      const ordersRepo = new OrmRepository<OrderDTO>(orm, 'RestaurantOrders')
      const linesRepo = new OrmRepository<OrderItemDTO>(orm, 'RestaurantOrderItems')
      const configRepo = new OrmRepository<any>(orm, 'Configuration')
      const hotelsRepo = new OrmRepository<any>(orm, 'Hotels')
      const userRepo = new OrmRepository<any>(orm, 'Users')
      // F1: modificadores/variantes de la carta.
      const modifierGroupsRepo = new OrmRepository<ModifierGroupDTO>(orm, 'MenuItemModifierGroups')
      const modifiersRepo = new OrmRepository<ModifierDTO>(orm, 'MenuItemModifiers')
      // F2: catálogo de combos/paquetes.
      const combosRepo = new OrmRepository<ComboDTO>(orm, 'MenuCombos')
      const comboItemsRepo = new OrmRepository<ComboItemDTO>(orm, 'MenuComboItems')
      // F7: carta pública sin sesión — el gate del módulo restaurant necesita el plan del hotel.
      const plansRepo = new OrmRepository<any>(orm, 'Plans')
      // Suscripción SaaS: fuente de verdad del plan (resolve-plan.ts), el espejo hotels.plan
      // solo aplica para hoteles legacy sin fila de suscripción.
      const subscriptionsRepo = new OrmRepository<any>(orm, 'Subscriptions')
      const log = logger.child('restaurant')
      const service = new RestaurantService(
        stations, categories, items, tables, userRepo, log, auth,
        ordersRepo, linesRepo, configRepo, hotelsRepo, modifierGroupsRepo, modifiersRepo,
        combosRepo, comboItemsRepo, plansRepo, subscriptionsRepo,
      )
      const controller = new RestaurantController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('restaurant')]

      // Estaciones (pantallas KDS configurables) — RES-0. Lectura: 'restaurant' (el POS necesita
      // listarlas para rutear la carta). Mutación: 'restaurant-catalog' (QA-ALTO: separado de
      // 'restaurant' para que mesero/cocina, que tienen restaurant:create/edit para operar el POS,
      // NO puedan crear/editar/borrar estaciones — antes compartían el mismo permiso).
      router.get('/api/restaurant/stations', guard('restaurant', 'view'), (req) => controller.indexStations(req))
      router.get('/api/restaurant/stations/:id', guard('restaurant', 'view'), (req) => controller.showStation(req))
      router.post('/api/restaurant/stations', guard('restaurant-catalog', 'create'), (req) => controller.storeStation(req))
      router.put('/api/restaurant/stations/:id', guard('restaurant-catalog', 'edit'), (req) => controller.updateStation(req))
      router.delete('/api/restaurant/stations/:id', guard('restaurant-catalog', 'delete'), (req) => controller.destroyStation(req))

      // Carta: categorías (RES-1). Mismo criterio: lectura operativa, mutación es config.
      router.get('/api/restaurant/categories', guard('restaurant', 'view'), (req) => controller.indexCategories(req))
      router.get('/api/restaurant/categories/:id', guard('restaurant', 'view'), (req) => controller.showCategory(req))
      router.post('/api/restaurant/categories', guard('restaurant-catalog', 'create'), (req) => controller.storeCategory(req))
      router.put('/api/restaurant/categories/:id', guard('restaurant-catalog', 'edit'), (req) => controller.updateCategory(req))
      router.delete('/api/restaurant/categories/:id', guard('restaurant-catalog', 'delete'), (req) => controller.destroyCategory(req))

      // Carta: ítems (RES-1). Mismo criterio: lectura operativa (armar el pedido), mutación es
      // config (precio/disponibilidad) — `availability` (agotar/reactivar) también es config: hoy
      // solo vive en la pantalla Carta (admin), ningún rol operativo tiene ese botón.
      router.get('/api/restaurant/menu-items', guard('restaurant', 'view'), (req) => controller.indexItems(req))
      router.get('/api/restaurant/menu-items/:id', guard('restaurant', 'view'), (req) => controller.showItem(req))
      router.post('/api/restaurant/menu-items', guard('restaurant-catalog', 'create'), (req) => controller.storeItem(req))
      router.put('/api/restaurant/menu-items/:id', guard('restaurant-catalog', 'edit'), (req) => controller.updateItem(req))
      router.put('/api/restaurant/menu-items/:id/availability', guard('restaurant-catalog', 'edit'), (req) => controller.setItemAvailability(req))
      router.delete('/api/restaurant/menu-items/:id', guard('restaurant-catalog', 'delete'), (req) => controller.destroyItem(req))

      // Mesas / salón (RES-2)
      router.get('/api/restaurant/tables', guard('restaurant', 'view'), (req) => controller.indexTables(req))
      router.get('/api/restaurant/tables/:id', guard('restaurant', 'view'), (req) => controller.showTable(req))
      router.post('/api/restaurant/tables', guard('restaurant', 'create'), (req) => controller.storeTable(req))
      router.put('/api/restaurant/tables/:id', guard('restaurant', 'edit'), (req) => controller.updateTable(req))
      router.delete('/api/restaurant/tables/:id', guard('restaurant', 'delete'), (req) => controller.destroyTable(req))

      // Comandas (RES-3)
      router.get('/api/restaurant/orders', guard('restaurant', 'view'), (req) => controller.indexOrders(req))
      router.get('/api/restaurant/orders/:id', guard('restaurant', 'view'), (req) => controller.showOrder(req))
      router.post('/api/restaurant/orders', guard('restaurant', 'create'), (req) => controller.openOrder(req))
      router.post('/api/restaurant/orders/:id/send', guard('restaurant', 'edit'), (req) => controller.sendOrder(req))
      router.post('/api/restaurant/orders/:id/cancel', guard('restaurant', 'delete'), (req) => controller.cancelOrder(req))
      router.post('/api/restaurant/orders/:id/items', guard('restaurant', 'create'), (req) => controller.addLine(req))
      router.put('/api/restaurant/orders/:id/items/:lineId', guard('restaurant', 'edit'), (req) => controller.updateLine(req))
      router.delete('/api/restaurant/orders/:id/items/:lineId', guard('restaurant', 'delete'), (req) => controller.removeLine(req))

      // Cuenta + cobro (RES-5)
      router.post('/api/restaurant/orders/:id/bill', guard('restaurant', 'edit'), (req) => controller.billOrder(req))
      router.post('/api/restaurant/orders/:id/charge-to-room', guard('restaurant', 'edit'), (req) => controller.chargeToRoom(req))
      router.post('/api/restaurant/orders/:id/pay', guard('restaurant', 'edit'), (req) => controller.payOrder(req))
      // Refund: permiso billing:create (alinea con POST /api/payments/:id/refund). El POS no expone
      // un permiso propio de reembolso; billing:create es el gate financiero del dinero.
      router.post('/api/restaurant/orders/:id/refund', guard('billing', 'create'), (req) => controller.refundOrder(req))

      // KDS / cocina (RES-4)
      router.get('/api/restaurant/kds', guard('restaurant', 'view'), (req) => controller.kdsQueue(req))
      router.put('/api/restaurant/kds/lines/:id', guard('restaurant', 'edit'), (req) => controller.setLineStatus(req))

      // Modificadores/variantes (F1). Mismo criterio que categorías/ítems: lectura operativa
      // ('restaurant', el mesero necesita ver las opciones para armar la comanda), mutación es
      // config de la carta ('restaurant-catalog').
      router.get('/api/restaurant/menu-items/:menuItemId/modifier-groups', guard('restaurant', 'view'), (req) => controller.indexModifierGroups(req))
      router.post('/api/restaurant/menu-items/:menuItemId/modifier-groups', guard('restaurant-catalog', 'create'), (req) => controller.storeModifierGroup(req))
      router.put('/api/restaurant/modifier-groups/:id', guard('restaurant-catalog', 'edit'), (req) => controller.updateModifierGroup(req))
      router.delete('/api/restaurant/modifier-groups/:id', guard('restaurant-catalog', 'delete'), (req) => controller.destroyModifierGroup(req))
      router.post('/api/restaurant/modifier-groups/:groupId/modifiers', guard('restaurant-catalog', 'create'), (req) => controller.storeModifier(req))
      router.put('/api/restaurant/modifiers/:id', guard('restaurant-catalog', 'edit'), (req) => controller.updateModifier(req))
      router.delete('/api/restaurant/modifiers/:id', guard('restaurant-catalog', 'delete'), (req) => controller.destroyModifier(req))

      // Combos/paquetes (F2). Mismo criterio que categorías/ítems: lectura operativa ('restaurant',
      // el mesero necesita ver el catálogo de combos para armar la comanda), mutación es config de la
      // carta ('restaurant-catalog').
      router.get('/api/restaurant/combos', guard('restaurant', 'view'), (req) => controller.indexCombos(req))
      router.get('/api/restaurant/combos/:id', guard('restaurant', 'view'), (req) => controller.showCombo(req))
      router.post('/api/restaurant/combos', guard('restaurant-catalog', 'create'), (req) => controller.storeCombo(req))
      router.put('/api/restaurant/combos/:id', guard('restaurant-catalog', 'edit'), (req) => controller.updateCombo(req))
      router.delete('/api/restaurant/combos/:id', guard('restaurant-catalog', 'delete'), (req) => controller.destroyCombo(req))

      // Food cost (F3): costo de receta y margen por ítem/combo + reporte del hotel. Permiso
      // 'restaurant-catalog:view' — MÁS estricto que 'restaurant:view' (que ya ve el precio de venta):
      // el costo/margen es rentabilidad del negocio, ningún rol operativo (mesero/cocina) lo tiene
      // (specs/menu-food-cost/spec.md, corrección post-QA).
      router.get('/api/restaurant/menu-items/:id/food-cost', guard('restaurant-catalog', 'view'), (req) => controller.itemFoodCost(req))
      router.get('/api/restaurant/combos/:id/food-cost', guard('restaurant-catalog', 'view'), (req) => controller.comboFoodCost(req))
      router.get('/api/restaurant/food-cost/report', guard('restaurant-catalog', 'view'), (req) => controller.foodCostReport(req))

      // Carta pública de solo lectura (F7) — huésped escaneando un QR de mesa, SIN sesión. Ruta SIN
      // auth.authenticate() ni guard(...) (mismo criterio que /api/public/hotel/:slug de bookingengine).
      // Rate-limit PROPIO por hotel+IP — clave y límite NUNCA compartidos con /api/auth/login (ver
      // specs/menu-public/spec.md, "corrección post-QA": el login resetea el contador en éxito, esta
      // ruta no tiene noción de éxito y un límite tan bajo cortaría tráfico legítimo de un WiFi compartido).
      router.get('/api/public/menu/:hotelId', async (req: any) => {
        const key = `public-menu:${req.params.hotelId}:${getClientIp(req)}`
        const { allowed, retryAfter } = await rateLimit(key, { maxAttempts: 120, windowMs: 5 * 60_000 })
        if (!allowed) {
          return { status: 429, body: { error: `Demasiadas solicitudes. Intentá en ${retryAfter} segundos`, retryAfter } }
        }
        return controller.publicMenu(req)
      })

      log.info('Módulo restaurant listo')
      return service
    },
  })
}
