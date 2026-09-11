// restaurant/index.ts — PUERTA PÚBLICA del módulo POS de restaurante.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
import { createModule, OrmRepository } from 'arckode-framework'
import { registerRestaurantModels } from './model'
import { RestaurantService } from './service'
import { RestaurantController } from './controller'
import type { StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO, ModifierGroupDTO, ModifierDTO, ComboDTO, ComboItemDTO, OrderPaymentDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard, createModuleChecker } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'
import { sseTicketAuth } from '../../infrastructure/auth/sse-ticket-auth'
import { loadPermissions } from '../../infrastructure/auth/load-permissions'
import { requirePermission, requireAnyPermission } from '../../infrastructure/auth/require-permission'
import { HotelAuth } from '../../infrastructure/auth/hotel-auth'
import { TICKET_SCOPE, TICKET_TTL_SECONDS } from './usecases/events'

export { RestaurantService }
export type {
  StationDTO, CategoryDTO, MenuItemDTO, TableDTO, OrderDTO, OrderItemDTO,
  OrderType, OrderStatus, LineStatus, TableStatus, Settlement,
  ModifierGroupDTO, ModifierDTO, ModifierSelectionType, OrderItemModifierSnapshot,
} from './types'
export type { RestaurantSockets } from './sockets'
export { RestaurantValidator, CreateStationSchema, UpdateStationSchema } from './validators/schema'
export { VoidLineSchema, CancelOrderSchema, VoidReasonsSchema } from './validators/schema'
export { DEFAULT_VOID_REASONS, VOID_REASONS_KEY } from './usecases/void-reasons'
// #215 (append-only): descuentos y cortesías.
export { DiscountSchema, DiscountPolicySchema, DISCOUNT_TYPES } from './validators/schema'
export { DEFAULT_DISCOUNT_REASONS, DISCOUNT_REASONS_KEY, DEFAULT_MAX_DISCOUNT_PERCENT, RESTAURANT_CONFIG_KEY } from './usecases/discounts'
export type { DiscountType } from './types'
export { registerRestaurantModels } from './model'
export type { SettlementPorts, ChargeToFolioInput, RecordPaymentInput, ChargeCardPaymentInput } from './usecases/settlement'
export type { ComboDTO, ComboItemDTO } from './types'
export type { ReservationPort, ReservationSummary } from './usecases/reservation-port'
export type { InHouseReservation, InHouseSearchResult } from './usecases/reservation-port'
export type { ModuleStatePort } from './usecases/public-menu'
export type { RestaurantEvent, RestaurantEventType } from './usecases/events'
// #213 (append-only): cierre del día.
export type { ReportPorts, ReportPayment, ReportFolioCharge, RestaurantDailyReport, DailyReportQuery, SalesMethod, VoidRow } from './usecases/reports'
// #215 (append-only): descuentos y cortesías en el cierre del día.
export type { DiscountRow } from './usecases/reports'
// #214 (append-only): dividir cuenta / pagos parciales.
export type { OrderPaymentDTO, OrderPaymentMethod, OrderPaymentStatus, OrderBalance } from './types'
export type { AddOrderPaymentInput, AddOrderPaymentResult, OrderPaymentsList, SplitPreview } from './usecases/split-payments'
export { AddOrderPaymentSchema, RefundOrderSchema, ORDER_PAYMENT_METHODS } from './validators/schema'

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
      events: ['onOrderSent', 'onLineStatusChanged', 'onOrderCharged', 'onOrderPaid', 'onOrderRefunded',
        // #211 (append-only): cierre de comanda y cambio de estado de mesa, para el canal en vivo.
        'onOrderClosed', 'onTableChanged'],
      tables: [
        'restaurant_stations', 'menu_categories', 'menu_items',
        'restaurant_tables', 'restaurant_orders', 'restaurant_order_items',
        'restaurant_order_payments',   // #214 (append-only)
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
      // #211: número de habitación para el ticket del KDS (tabla rooms, lectura — mismo criterio que Hotels/Users).
      const roomsRepo = new OrmRepository<any>(orm, 'Rooms')
      // #209: nombre del huésped para "Hab. 204 · Pérez" en la comanda de room service (tabla guests, lectura acotada al hotel).
      const guestsRepo = new OrmRepository<any>(orm, 'Guests')
      // #214: partes del cobro (dividir cuenta / pagos parciales).
      const orderPaymentsRepo = new OrmRepository<OrderPaymentDTO>(orm, 'RestaurantOrderPayments')
      const log = logger.child('restaurant')
      const service = new RestaurantService(
        stations, categories, items, tables, userRepo, log, auth,
        ordersRepo, linesRepo, configRepo, hotelsRepo, modifierGroupsRepo, modifiersRepo,
        combosRepo, comboItemsRepo,
        // #206: numerador de comandas con UPDATE condicional (orm.updateMany). El orm entra al
        // service SOLO como `CounterCas`; el resto sigue por OrmRepository. Ver usecases/order-number.ts.
        orm,
        // #208: transactor para la cascada atómica de deleteItem (patrón landing/index.ts).
        { transaction: <T>(fn: (tx: any) => Promise<T>) => orm.transaction(fn) },
        roomsRepo,
        guestsRepo,
        orderPaymentsRepo,
      )
      const controller = new RestaurantController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('restaurant')]
      // F7/#208: la carta pública (sin sesión, sin `moduleGuard`) pregunta el MISMO entitlement por
      // puerto — `createModuleChecker` es la versión "pregunta" del guard (canales/index.ts hace
      // igual para el alta automática). Antes public-menu.ts importaba admin/usecases/modules directo.
      service.setModuleStatePort({ isEnabled: createModuleChecker(orm, log) })

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
      // #205: quitar una línea ANTES de enviar a cocina es parte de tomar el pedido → el MISMO
      // permiso que agregarla, `restaurant:create` (el mozo lo tiene; cocina NO: con `edit` en la
      // ruta, cocina borraba líneas de una comanda open por API). Después de enviada (`sent` o
      // posterior) el usecase exige además `restaurant:delete` sobre `req.user.permissions` (403):
      // el guard estático no puede mirar el estado de la comanda.
      router.delete('/api/restaurant/orders/:id/items/:lineId', guard('restaurant', 'create'), (req) => controller.removeLine(req))
      // #207: anular con motivo una línea ya enviada a cocina. Mismo permiso que quitar (restaurant:delete):
      // es la misma decisión ("este plato no se cobra"), solo que con rastro.
      router.post('/api/restaurant/orders/:id/items/:lineId/void', guard('restaurant', 'delete'), (req) => controller.voidLine(req))
      // Motivos predefinidos de anulación: lectura operativa (el modal del KDS los muestra), edición es
      // config de la carta.
      router.get('/api/restaurant/void-reasons', guard('restaurant', 'view'), (req) => controller.voidReasons(req))
      router.put('/api/restaurant/void-reasons', guard('restaurant-catalog', 'edit'), (req) => controller.setVoidReasons(req))

      // #215: descuentos y cortesías con motivo. Permiso PROPIO `restaurant:discount` (hotel_admin y
      // receptionist por defecto; el mozo no): cobrar lo que marca el ticket (`pay`) no es decidir cobrar
      // menos. El tope por rol y el 409 sobre comandas liquidadas los aplica el usecase. La política
      // (tope + motivos) se lee con el mismo permiso que descontar y se edita como config de la carta.
      router.post('/api/restaurant/orders/:id/discount', guard('restaurant', 'discount'), (req) => controller.applyOrderDiscount(req))
      router.delete('/api/restaurant/orders/:id/discount', guard('restaurant', 'discount'), (req) => controller.removeOrderDiscount(req))
      router.post('/api/restaurant/orders/:id/items/:lineId/discount', guard('restaurant', 'discount'), (req) => controller.applyLineDiscount(req))
      router.delete('/api/restaurant/orders/:id/items/:lineId/discount', guard('restaurant', 'discount'), (req) => controller.removeLineDiscount(req))
      router.get('/api/restaurant/discount-policy', guard('restaurant', 'discount'), (req) => controller.discountPolicy(req))
      router.put('/api/restaurant/discount-policy', guard('restaurant-catalog', 'edit'), (req) => controller.setDiscountPolicy(req))

      // #209: buscador "quién está alojado" (habitación/apellido) para abrir un room service o cargar a la
      // habitación. Va por este módulo y no por /api/reservas porque el mozo NO tiene `reservations:view`.
      // Lo usan DOS pantallas con permisos distintos: el mozo al abrir el pedido (`restaurant:create`) y
      // Cobrar al cargar la cuenta (`restaurant:pay`, un cajero puede tener solo ese). Cualquiera de los
      // dos alcanza; `restaurant:view` NO (cocina lo tiene y no elige reservas). El guard es el mismo que
      // `guard()` con `requireAnyPermission` en lugar de `requirePermission`.
      // La búsqueda real la hace `reservas` por puerto (connectors/restaurante-reservas.ts).
      const inHouseGuard = [auth.authenticate(), loadPermissions(roleRepo), requireAnyPermission(['restaurant', 'pay'], ['restaurant', 'create']), moduleGuard('restaurant')]
      router.get('/api/restaurant/in-house', inHouseGuard, (req) => controller.searchInHouse(req))

      // Cuenta + cobro (RES-5). #205: `restaurant:pay`, NO `edit` — cocina tiene `edit` para el KDS y
      // con ese permiso cobraba por URL. Mover plata (cobrar, cargar a habitación, propina) es un
      // permiso propio: hotel_admin, receptionist y waiter lo tienen; kitchen no.
      router.post('/api/restaurant/orders/:id/bill', guard('restaurant', 'pay'), (req) => controller.billOrder(req))
      router.post('/api/restaurant/orders/:id/charge-to-room', guard('restaurant', 'pay'), (req) => controller.chargeToRoom(req))
      router.post('/api/restaurant/orders/:id/pay', guard('restaurant', 'pay'), (req) => controller.payOrder(req))
      // Refund: permiso billing:create (alinea con POST /api/payments/:id/refund). El POS no expone
      // un permiso propio de reembolso; billing:create es el gate financiero del dinero.
      router.post('/api/restaurant/orders/:id/refund', guard('billing', 'create'), (req) => controller.refundOrder(req))
      // #214: dividir cuenta / pagos parciales. Ver y agregar partes es cobrar (`restaurant:pay`, cocina
      // no); devolver UNA parte es el mismo gate financiero que el refund entero (`billing:create`).
      router.get('/api/restaurant/orders/:id/payments', guard('restaurant', 'pay'), (req) => controller.indexOrderPayments(req))
      router.get('/api/restaurant/orders/:id/split', guard('restaurant', 'pay'), (req) => controller.splitPreview(req))
      router.post('/api/restaurant/orders/:id/payments', guard('restaurant', 'pay'), (req) => controller.addOrderPayment(req))
      router.post('/api/restaurant/orders/:id/payments/:partId/refund', guard('billing', 'create'), (req) => controller.refundOrderPayment(req))

      // KDS / cocina (RES-4)
      router.get('/api/restaurant/kds', guard('restaurant', 'view'), (req) => controller.kdsQueue(req))
      router.put('/api/restaurant/kds/lines/:id', guard('restaurant', 'edit'), (req) => controller.setLineStatus(req))

      // Canal en vivo (#211): SSE por hotel para KDS y Salón. `EventSource` no manda headers, así que
      // el stream se abre con un ticket de 60 s (`/events/ticket`, pedido con el JWT normal) que viaja
      // por query. El ticket NO es un access token (type 'ticket' + scope + jti de un solo uso):
      // `sseTicketAuth` reemplaza a `auth.authenticate()` en esta ruta — un JWT de sesión acá da 401 y
      // el ticket como Bearer en cualquier otra ruta también. El resto del guard es el mismo de la
      // cola (`restaurant:view` + módulo habilitado). Ver usecases/events.ts y sse-ticket-auth.ts.
      if (!(auth instanceof HotelAuth)) throw new Error('restaurant: el canal en vivo requiere HotelAuth (tickets de un solo uso)')
      const ticketGuard = [
        sseTicketAuth(auth, { scope: TICKET_SCOPE, ttlMs: TICKET_TTL_SECONDS * 1000 }),
        loadPermissions(roleRepo),
        requirePermission('restaurant', 'view'),
        moduleGuard('restaurant'),
      ]
      router.get('/api/restaurant/events/ticket', guard('restaurant', 'view'), (req) => controller.eventsTicket(req))
      router.get('/api/restaurant/events', ticketGuard, (req) => controller.events(req))

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

      // Cierre del día (#213): ventas por método, propinas, anuladas, top ítems. Permiso `reports:view`
      // (el del resto de los reportes del hotel: hotel_admin y receptionist lo tienen, mozo/cocina no —
      // es el consolidado de plata del negocio, no una pantalla operativa) + módulo restaurant activo.
      router.get('/api/restaurant/reports/daily', guard('reports', 'view'), (req) => controller.dailyReport(req))

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

    // #211: al apagar, cerrar los streams SSE — si no, `http.stop()` espera el drain (30 s) con cada
    // tablet de cocina colgada. El navegador reconecta solo cuando el server vuelve.
    async onStop(service: RestaurantService) { service.closeEventStreams() },
  })
}
