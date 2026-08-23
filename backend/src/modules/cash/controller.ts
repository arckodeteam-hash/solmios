// cash/controller.ts — Adaptador HTTP del módulo Caja.
// Traduce request → service → response. SIN lógica de negocio, SIN ORM directo.
// Toda mutación POST/PUT pasa por validateSchema().

import type { HttpRequest, Logger } from 'arckode-framework'
import { validateSchema } from '../../shared/validators/validate-body'
import type { CashService } from './service'
import type { CashRegister } from './types'
import { CreateMovementSchema, UpdateMovementSchema, OpenShiftSchema, CloseShiftSchema } from './validators/schema'

// `register` SIEMPRE lo fija la ruta (index.ts), nunca el cliente — así una comanda con permiso
// `restaurant` no puede pasar register=reception por query/body para leer/tocar el cajón de recepción.
export class CashController {
  constructor(
    private readonly service: CashService,
    private readonly logger: Logger,
  ) {}

  // ─── Movimientos ───
  async index(req: HttpRequest, register?: CashRegister) {
    const result = await this.service.list(req.query as any, req.user as any, register)
    return { status: 200, body: result }
  }
  async show(req: HttpRequest, register?: CashRegister) {
    const item = await this.service.getById(req.params.id, req.user as any, register)
    return { status: 200, body: item }
  }
  async store(req: HttpRequest, register?: CashRegister) {
    const data = validateSchema(CreateMovementSchema, req.body)
    const item = await this.service.create(data as any, req.user as any, register)
    return { status: 201, body: item }
  }
  async update(req: HttpRequest, register?: CashRegister) {
    const data = validateSchema(UpdateMovementSchema, req.body)
    const item = await this.service.update(req.params.id, data as any, req.user as any, register)
    return { status: 200, body: item }
  }
  async destroy(req: HttpRequest, register?: CashRegister) {
    await this.service.delete(req.params.id, req.user as any, register)
    return { status: 204, body: null }
  }

  // ─── Turnos ───
  async listShifts(req: HttpRequest, register?: CashRegister) {
    const q = req.query as any
    // Histórico paginado/filtrado (QA-UI caja-2026-08-22 H1): from/to sobre fecha de apertura.
    const query = {
      from: q.from ? String(q.from) : undefined,
      to: q.to ? String(q.to) : undefined,
      page: q.page !== undefined && q.page !== '' ? Number(q.page) : undefined,
      limit: q.limit !== undefined && q.limit !== '' ? Number(q.limit) : undefined,
    }
    const result = await this.service.listShiftHistory(query, q.hotelId, req.user as any, register)
    return { status: 200, body: result }
  }
  async currentShift(req: HttpRequest, register?: CashRegister) {
    const shift = await this.service.getCurrentShift(req.user as any, register)
    return { status: 200, body: shift }
  }
  async openShift(req: HttpRequest, register?: CashRegister) {
    const data = validateSchema(OpenShiftSchema, req.body)
    const shift = await this.service.openShift(data as any, req.user as any, register)
    return { status: 201, body: shift }
  }
  async closeShift(req: HttpRequest, register?: CashRegister) {
    const data = validateSchema(CloseShiftSchema, req.body)
    const shift = await this.service.closeShift(req.params.id, data as any, req.user as any, register)
    return { status: 200, body: shift }
  }
  async reconcile(req: HttpRequest, register?: CashRegister) {
    const result = await this.service.reconcile(req.params.id, req.user as any, register)
    return { status: 200, body: result }
  }

  // ─── Stats ───
  async stats(req: HttpRequest, register?: CashRegister) {
    const result = await this.service.stats((req.query as any).hotelId, req.user as any, register)
    return { status: 200, body: result }
  }
}
