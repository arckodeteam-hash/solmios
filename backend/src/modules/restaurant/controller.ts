// restaurant/controller.ts — Adaptador HTTP. Traduce request → service → response.
// SIN lógica de negocio, SIN ORM directo. Toda mutación pasa por validateSchema().
import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { RestaurantService } from './service'
import type { CurrentUser } from './types'
import type { AddOrderPaymentInput } from './usecases/split-payments'
import {
  CreateStationSchema, UpdateStationSchema,
  CreateCategorySchema, UpdateCategorySchema,
  CreateItemSchema, UpdateItemSchema, AvailabilitySchema,
  CreateTableSchema, UpdateTableSchema,
  OpenOrderSchema, AddLineSchema, UpdateLineSchema,
  BillSchema, ChargeToRoomSchema, PaySchema, AddOrderPaymentSchema,
  KdsLineStatusSchema,
  KdsLineIngredientsSchema,
  VoidLineSchema, CancelOrderSchema, RefundOrderSchema, VoidReasonsSchema,
  DiscountSchema, DiscountPolicySchema,
  CreateModifierGroupSchema, UpdateModifierGroupSchema,
  CreateModifierSchema, UpdateModifierSchema,
  CreateComboSchema, UpdateComboSchema,
} from './validators/schema'

export class RestaurantController {
  constructor(
    private readonly service: RestaurantService,
    private readonly logger: Logger,
  ) {}

  // ─── Estaciones (RES-0) ───
  async indexStations(req: HttpRequest) {
    this.logger.info('GET /restaurant/stations')
    const result = await this.service.listStations(req.user as any)
    return { status: 200, body: result }
  }

  async showStation(req: HttpRequest) {
    this.logger.info('GET /restaurant/stations/:id', { id: req.params.id })
    const item = await this.service.getStation(req.params.id, req.user as any)
    return { status: 200, body: item }
  }

  async storeStation(req: HttpRequest) {
    this.logger.info('POST /restaurant/stations')
    const data = validateSchema(CreateStationSchema, req.body)
    const item = await this.service.createStation(data as any, req.user as any)
    return { status: 201, body: item }
  }

  async updateStation(req: HttpRequest) {
    this.logger.info('PUT /restaurant/stations/:id', { id: req.params.id })
    const data = validateSchema(UpdateStationSchema, req.body)
    const item = await this.service.updateStation(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }

  async destroyStation(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/stations/:id', { id: req.params.id })
    await this.service.deleteStation(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  // ─── Carta: categorías (RES-1) ───
  async indexCategories(req: HttpRequest) {
    this.logger.info('GET /restaurant/categories')
    const lang = (req.query as any)?.lang as string | undefined
    return { status: 200, body: await this.service.listCategories(req.user as any, lang) }
  }
  async showCategory(req: HttpRequest) {
    const lang = (req.query as any)?.lang as string | undefined
    const item = await this.service.getCategory(req.params.id, req.user as any, lang)
    return { status: 200, body: item }
  }
  async storeCategory(req: HttpRequest) {
    this.logger.info('POST /restaurant/categories')
    const data = validateSchema(CreateCategorySchema, req.body)
    const item = await this.service.createCategory(data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateCategory(req: HttpRequest) {
    this.logger.info('PUT /restaurant/categories/:id', { id: req.params.id })
    const data = validateSchema(UpdateCategorySchema, req.body)
    const item = await this.service.updateCategory(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async destroyCategory(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/categories/:id', { id: req.params.id })
    await this.service.deleteCategory(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  // ─── Carta: ítems (RES-1) ───
  async indexItems(req: HttpRequest) {
    this.logger.info('GET /restaurant/menu-items')
    const categoryId = (req.query as any)?.categoryId as string | undefined
    const lang = (req.query as any)?.lang as string | undefined
    return { status: 200, body: await this.service.listItems(categoryId, req.user as any, lang) }
  }
  async showItem(req: HttpRequest) {
    const lang = (req.query as any)?.lang as string | undefined
    const item = await this.service.getItem(req.params.id, req.user as any, lang)
    return { status: 200, body: item }
  }
  async storeItem(req: HttpRequest) {
    this.logger.info('POST /restaurant/menu-items')
    const data = validateSchema(CreateItemSchema, req.body)
    const item = await this.service.createItem(data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateItem(req: HttpRequest) {
    this.logger.info('PUT /restaurant/menu-items/:id', { id: req.params.id })
    const data = validateSchema(UpdateItemSchema, req.body)
    const item = await this.service.updateItem(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async setItemAvailability(req: HttpRequest) {
    this.logger.info('PUT /restaurant/menu-items/:id/availability', { id: req.params.id })
    const data = validateSchema(AvailabilitySchema, req.body) as any
    const item = await this.service.setItemAvailability(req.params.id, data.available, req.user as any)
    return { status: 200, body: item }
  }
  async destroyItem(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/menu-items/:id', { id: req.params.id })
    await this.service.deleteItem(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  // ─── Mesas (RES-2) ───
  async indexTables(req: HttpRequest) {
    this.logger.info('GET /restaurant/tables')
    return { status: 200, body: await this.service.listTables(req.user as any) }
  }
  async showTable(req: HttpRequest) {
    const item = await this.service.getTable(req.params.id, req.user as any)
    return { status: 200, body: item }
  }
  async storeTable(req: HttpRequest) {
    this.logger.info('POST /restaurant/tables')
    const data = validateSchema(CreateTableSchema, req.body)
    const item = await this.service.createTable(data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateTable(req: HttpRequest) {
    this.logger.info('PUT /restaurant/tables/:id', { id: req.params.id })
    const data = validateSchema(UpdateTableSchema, req.body)
    const item = await this.service.updateTable(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async destroyTable(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/tables/:id', { id: req.params.id })
    await this.service.deleteTable(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  // ─── Comandas (RES-3) ───
  async indexOrders(req: HttpRequest) {
    this.logger.info('GET /restaurant/orders')
    const q = req.query as any
    // `waiterId=me` → las comandas del usuario del token (pantalla "Mis mesas" del mozo).
    const waiterId = q?.waiterId === 'me' ? (req.user as any)?.id : q?.waiterId
    return { status: 200, body: await this.service.listOrders({ status: q?.status, tableId: q?.tableId, waiterId, businessDate: q?.businessDate }, req.user as any) }
  }
  async showOrder(req: HttpRequest) {
    const item = await this.service.getOrder(req.params.id, req.user as any)
    return { status: 200, body: item }
  }
  async openOrder(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders')
    const data = validateSchema(OpenOrderSchema, req.body)
    const item = await this.service.openOrder(data as any, req.user as any)
    return { status: 201, body: item }
  }
  async sendOrder(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/send', { id: req.params.id })
    const item = await this.service.sendOrder(req.params.id, req.user as any)
    return { status: 200, body: item }
  }
  async cancelOrder(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/cancel', { id: req.params.id })
    // #207: el motivo es obligatorio (400 sin él). Las líneas ya enviadas quedan `voided` con ese motivo.
    const data = validateSchema(CancelOrderSchema, req.body) as { reason: string }
    const item = await this.service.cancelOrder(req.params.id, data.reason, req.user as any)
    return { status: 200, body: item }
  }
  async addLine(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/items', { id: req.params.id })
    const data = validateSchema(AddLineSchema, req.body)
    const item = await this.service.addLine(req.params.id, data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateLine(req: HttpRequest) {
    this.logger.info('PUT /restaurant/orders/:id/items/:lineId', { id: req.params.id, lineId: req.params.lineId })
    const data = validateSchema(UpdateLineSchema, req.body)
    const item = await this.service.updateLine(req.params.id, req.params.lineId, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async removeLine(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/orders/:id/items/:lineId', { id: req.params.id, lineId: req.params.lineId })
    await this.service.removeLine(req.params.id, req.params.lineId, req.user as any)
    return { status: 204, body: null }
  }
  // #207: anular con motivo una línea ya enviada a cocina (la línea queda tachada, no se borra).
  async voidLine(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/items/:lineId/void', { id: req.params.id, lineId: req.params.lineId })
    const data = validateSchema(VoidLineSchema, req.body) as { reason: string }
    const item = await this.service.voidLine(req.params.id, req.params.lineId, data.reason, req.user as any)
    return { status: 200, body: item }
  }
  async voidReasons(req: HttpRequest) {
    this.logger.info('GET /restaurant/void-reasons')
    return { status: 200, body: await this.service.getVoidReasons(req.user as any) }
  }
  async setVoidReasons(req: HttpRequest) {
    this.logger.info('PUT /restaurant/void-reasons')
    const data = validateSchema(VoidReasonsSchema, req.body) as { reasons: unknown }
    return { status: 200, body: await this.service.setVoidReasons(data.reasons, req.user as any) }
  }

  // ─── Descuentos y cortesías (#215) ───
  async applyOrderDiscount(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/discount', { id: req.params.id })
    const data = validateSchema(DiscountSchema, req.body)
    const item = await this.service.applyOrderDiscount(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  // Sin body (no hay nada que validar): quita el descuento de la comanda.
  async removeOrderDiscount(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/orders/:id/discount', { id: req.params.id })
    const item = await this.service.removeOrderDiscount(req.params.id, req.user as any)
    return { status: 200, body: item }
  }
  async applyLineDiscount(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/items/:lineId/discount', { id: req.params.id, lineId: req.params.lineId })
    const data = validateSchema(DiscountSchema, req.body)
    const item = await this.service.applyLineDiscount(req.params.id, req.params.lineId, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async removeLineDiscount(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/orders/:id/items/:lineId/discount', { id: req.params.id, lineId: req.params.lineId })
    const item = await this.service.removeLineDiscount(req.params.id, req.params.lineId, req.user as any)
    return { status: 200, body: item }
  }
  async discountPolicy(req: HttpRequest) {
    this.logger.info('GET /restaurant/discount-policy')
    return { status: 200, body: await this.service.getDiscountPolicy(req.user as any) }
  }
  async setDiscountPolicy(req: HttpRequest) {
    this.logger.info('PUT /restaurant/discount-policy')
    const data = validateSchema(DiscountPolicySchema, req.body)
    return { status: 200, body: await this.service.setDiscountPolicy(data as any, req.user as any) }
  }

  // ─── Cuenta + cobro (RES-5) ───
  async billOrder(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/bill', { id: req.params.id })
    const data = validateSchema(BillSchema, req.body)
    const item = await this.service.billOrder(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async chargeToRoom(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/charge-to-room', { id: req.params.id })
    const data = validateSchema(ChargeToRoomSchema, req.body)
    const item = await this.service.chargeToRoom(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async payOrder(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/pay', { id: req.params.id })
    const data = validateSchema(PaySchema, req.body)
    // fix-refund-pos-card: para method==='card' el usecase deja la comanda en `processing_payment` y
    // el objeto devuelto trae `checkoutUrl` (Stripe Checkout Session) además de los campos de OrderDTO —
    // el body ya lo incluye tal cual, el frontend redirige si viene presente.
    const item = await this.service.payOrder(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  // Refund: clon de cancelOrder — motivo obligatorio (RefundOrderSchema). El usecase valida estado + paymentId.
  async refundOrder(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/refund', { id: req.params.id })
    const data = validateSchema(RefundOrderSchema, req.body ?? {})
    const item = await this.service.refundOrder(req.params.id, data as { reason?: string }, req.user as any)
    return { status: 200, body: item }
  }

  // ─── Dividir cuenta / pagos parciales (#214) ───
  async indexOrderPayments(req: HttpRequest) {
    return { status: 200, body: await this.service.listOrderPayments(req.params.id, req.user as CurrentUser) }
  }
  async splitPreview(req: HttpRequest) {
    const parts = Number((req.query as Record<string, unknown> | undefined)?.parts ?? 2)
    return { status: 200, body: await this.service.splitPreview(req.params.id, parts, req.user as CurrentUser) }
  }
  async addOrderPayment(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/payments', { id: req.params.id })
    // validateSchema devuelve Record<string, unknown>: el enum de `method` ya lo aplicó el schema.
    const data = validateSchema(AddOrderPaymentSchema, req.body) as unknown as AddOrderPaymentInput
    // Como payOrder(card): si viene `checkoutUrl`, el frontend redirige al Checkout de Stripe.
    const result = await this.service.addOrderPayment(req.params.id, data, req.user as CurrentUser)
    return { status: 201, body: result }
  }
  // Motivo obligatorio (RefundOrderSchema). El usecase valida estado de la parte y de la comanda.
  async refundOrderPayment(req: HttpRequest) {
    this.logger.info('POST /restaurant/orders/:id/payments/:partId/refund', { id: req.params.id, partId: req.params.partId })
    const data = validateSchema(RefundOrderSchema, req.body ?? {})
    const part = await this.service.refundOrderPayment(req.params.id, req.params.partId, data as { reason?: string }, req.user as CurrentUser)
    return { status: 200, body: part }
  }

  // ─── Alojados (#209): buscador para room service / cargo a habitación ───
  async searchInHouse(req: HttpRequest) {
    const { q, id } = (req.query ?? {}) as Record<string, unknown>
    return { status: 200, body: await this.service.searchInHouse({ q, id }, req.user as any) }
  }

  // ─── KDS / cocina (RES-4) ───
  async kdsQueue(req: HttpRequest) {
    this.logger.info('GET /restaurant/kds')
    const station = (req.query as any)?.station as string | undefined
    return { status: 200, body: await this.service.kdsQueue(station, req.user as any) }
  }
  async setLineStatus(req: HttpRequest) {
    this.logger.info('PUT /restaurant/kds/lines/:id', { id: req.params.id })
    const data = validateSchema(KdsLineStatusSchema, req.body) as any
    const item = await this.service.setLineStatus(req.params.id, data.status, req.user as any)
    return { status: 200, body: item }
  }
  /** Receta de un ítem de la carta (ingredientes con nombre), para que la comanda del mozo la muestre y edite. */
  async menuItemIngredients(req: HttpRequest) {
    return { status: 200, body: await this.service.menuItemIngredients(req.params.id, req.user as any) }
  }
  /** Cocina o el mozo quitan/agregan/doblan ingredientes de un plato. El body es el estado final: { removed, added, doubled }. */
  async setLineIngredients(req: HttpRequest) {
    this.logger.info('PUT /restaurant/kds/lines/:id/ingredients', { id: req.params.id })
    const data = validateSchema(KdsLineIngredientsSchema, req.body) as any
    const item = await this.service.setLineIngredients(req.params.id, data, req.user as any)
    return { status: 200, body: item }
  }

  // ─── Canal en vivo (#211) ───
  /** SSE: la respuesta es un stream (kernel/http/server.ts la escribe como text/event-stream), no un JSON. */
  async events(req: HttpRequest) {
    this.logger.info('GET /restaurant/events')
    return this.service.eventStream(req.user as any)
  }
  async eventsTicket(req: HttpRequest) {
    this.logger.info('GET /restaurant/events/ticket')
    return { status: 200, body: this.service.eventsTicket(req.user as any) }
  }

  // ─── Modificadores/variantes (F1) ───
  async indexModifierGroups(req: HttpRequest) {
    this.logger.info('GET /restaurant/menu-items/:menuItemId/modifier-groups', { menuItemId: req.params.menuItemId })
    return { status: 200, body: await this.service.listModifierGroups(req.params.menuItemId, req.user as any) }
  }
  async storeModifierGroup(req: HttpRequest) {
    this.logger.info('POST /restaurant/menu-items/:menuItemId/modifier-groups', { menuItemId: req.params.menuItemId })
    const data = validateSchema(CreateModifierGroupSchema, req.body)
    const item = await this.service.createModifierGroup(req.params.menuItemId, data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateModifierGroup(req: HttpRequest) {
    this.logger.info('PUT /restaurant/modifier-groups/:id', { id: req.params.id })
    const data = validateSchema(UpdateModifierGroupSchema, req.body)
    const item = await this.service.updateModifierGroup(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async destroyModifierGroup(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/modifier-groups/:id', { id: req.params.id })
    await this.service.deleteModifierGroup(req.params.id, req.user as any)
    return { status: 204, body: null }
  }
  async storeModifier(req: HttpRequest) {
    this.logger.info('POST /restaurant/modifier-groups/:groupId/modifiers', { groupId: req.params.groupId })
    const data = validateSchema(CreateModifierSchema, req.body)
    const item = await this.service.createModifier(req.params.groupId, data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateModifier(req: HttpRequest) {
    this.logger.info('PUT /restaurant/modifiers/:id', { id: req.params.id })
    const data = validateSchema(UpdateModifierSchema, req.body)
    const item = await this.service.updateModifier(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async destroyModifier(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/modifiers/:id', { id: req.params.id })
    await this.service.deleteModifier(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  // ─── Combos/paquetes (F2) ───
  async indexCombos(req: HttpRequest) {
    this.logger.info('GET /restaurant/combos')
    const lang = (req.query as any)?.lang as string | undefined
    return { status: 200, body: await this.service.listCombos(req.user as any, lang) }
  }
  async showCombo(req: HttpRequest) {
    this.logger.info('GET /restaurant/combos/:id', { id: req.params.id })
    const lang = (req.query as any)?.lang as string | undefined
    const item = await this.service.getCombo(req.params.id, req.user as any, lang)
    return { status: 200, body: item }
  }
  async storeCombo(req: HttpRequest) {
    this.logger.info('POST /restaurant/combos')
    const data = validateSchema(CreateComboSchema, req.body)
    const item = await this.service.createCombo(data as any, req.user as any)
    return { status: 201, body: item }
  }
  async updateCombo(req: HttpRequest) {
    this.logger.info('PUT /restaurant/combos/:id', { id: req.params.id })
    const data = validateSchema(UpdateComboSchema, req.body)
    const item = await this.service.updateCombo(req.params.id, data as any, req.user as any)
    return { status: 200, body: item }
  }
  async destroyCombo(req: HttpRequest) {
    this.logger.info('DELETE /restaurant/combos/:id', { id: req.params.id })
    await this.service.deleteCombo(req.params.id, req.user as any)
    return { status: 204, body: null }
  }

  // ─── Food cost (F3) ───
  async itemFoodCost(req: HttpRequest) {
    this.logger.info('GET /restaurant/menu-items/:id/food-cost', { id: req.params.id })
    const result = await this.service.itemFoodCost(req.params.id, req.user as any)
    return { status: 200, body: result }
  }
  async comboFoodCost(req: HttpRequest) {
    this.logger.info('GET /restaurant/combos/:id/food-cost', { id: req.params.id })
    const result = await this.service.comboFoodCost(req.params.id, req.user as any)
    return { status: 200, body: result }
  }
  // #213 — cierre del día: ?date= o ?from=&to= (YYYY-MM-DD, zona del hotel). Sin nada → hoy.
  async dailyReport(req: HttpRequest) {
    const q = (req.query as any) ?? {}
    this.logger.info('GET /restaurant/reports/daily', { date: q.date, from: q.from, to: q.to })
    const query = { date: q.date as string | undefined, from: q.from as string | undefined, to: q.to as string | undefined }
    return { status: 200, body: await this.service.dailyReport(query, req.user as any) }
  }

  // #216 — papel de 80 mm: ?doc=precuenta|ticket|kitchen[&station=<id>|__none__]. Devuelve el HTML
  // autocontenido (mismo esquema que facturas `GET /:id/print` y el recibo de nómina): el frontend lo
  // abre en una pestaña y el navegador imprime.
  async printOrder(req: HttpRequest) {
    const q = (req.query as any) ?? {}
    this.logger.info('GET /restaurant/orders/:id/print', { id: req.params.id, doc: q.doc, station: q.station, batch: q.batch })
    const html = await this.service.printOrder(req.params.id, { doc: q.doc, station: q.station, batch: q.batch }, req.user as any)
    return { status: 200, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } }
  }

  async foodCostReport(req: HttpRequest) {
    this.logger.info('GET /restaurant/food-cost/report')
    const result = await this.service.foodCostReport(req.user as any)
    return { status: 200, body: result }
  }

  // ─── Carta pública (F7) — SIN auth.authenticate(): NUNCA leer req.user acá ───
  async publicMenu(req: HttpRequest) {
    this.logger.info('GET /api/public/menu/:hotelId', { hotelId: req.params.hotelId })
    const lang = (req.query as any)?.lang as string | undefined
    const result = await this.service.publicMenu(req.params.hotelId, lang)
    return { status: 200, body: result }
  }
}
