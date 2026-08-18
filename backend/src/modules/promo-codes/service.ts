// promo-codes/service.ts — Facade del módulo promo_codes (F2 booking-widget).
// Orquesta; la lógica que crece vive en usecases/. Depende de RepositoryAdapter, NO
// del ORM directo. NO importa de otros módulos (cross-module va por conectores).
//
// El service expone dos familias de métodos:
//  (a) Admin CRUD — para el controller admin (auth + permiso promo:*)
//  (b) validate    — para el controller público (sin auth, rate-limited)
import type { RepositoryAdapter, Auth, Logger } from 'arckode-framework'
import type {
  PromoCodeDTO, CreatePromoCodeDTO, UpdatePromoCodeDTO,
  PromoValidationResult, CurrentUser,
} from './types'
import type { PromoCodesSockets } from './sockets'
import * as promoCrud from './usecases/promo-crud'
import * as promoValidate from './usecases/promo-validate'

export class PromoCodesService {
  private sockets: PromoCodesSockets = {}
  constructor(
    private readonly promoCodes: RepositoryAdapter<PromoCodeDTO>,
    private readonly userRepo: RepositoryAdapter<any>,
    private readonly auth: Auth,
    private readonly logger: Logger,
  ) {}

  /** Conecta hooks opcionales. Mismo patrón que folios.setSockets. */
  setSockets(s: Partial<PromoCodesSockets>): void {
    this.sockets = { ...this.sockets, ...s } as PromoCodesSockets
  }

  private crudDeps(): promoCrud.PromoCrudDeps {
    return { promoCodes: this.promoCodes, userRepo: this.userRepo, auth: this.auth }
  }

  async list(user: CurrentUser): Promise<{ data: PromoCodeDTO[]; total: number }> {
    this.logger.info('Listando promo codes', { hotelId: user.hotelId })
    return promoCrud.list(this.crudDeps(), user)
  }

  async create(dto: CreatePromoCodeDTO, user: CurrentUser): Promise<PromoCodeDTO> {
    this.logger.info('Creando promo code', { hotelId: user.hotelId, code: dto.code, kind: dto.kind })
    const promo = await promoCrud.create(this.crudDeps(), dto, user)
    await this.sockets.onPromoCodeCreated?.(promo)
    return promo
  }

  /**
   * Creación por PARTE DEL SISTEMA (sin user del token): el canje de puntos del CRM genera
   * un promo single-use de monto fijo. La lógica de vigencia/single-use vive acá — en el
   * módulo dueño de los promos — y el connector `crm-promocodes` solo delega plano
   * (regla: connectors wirean, no piensan).
   */
  async createForLoyalty(hotelId: string, code: string, value: number, validDays: number): Promise<PromoCodeDTO> {
    this.logger.info('Promo de canje de puntos', { hotelId, code, value })
    const dto: CreatePromoCodeDTO = {
      code,
      kind: 'fixed',
      value,
      minAmount: 0,
      maxUses: 1, // un canje, un descuento
      validFrom: new Date().toISOString(),
      validTo: new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
    }
    // Actor sistema del propio hotel: el CRM ya validó ownership de ese hotelId.
    const promo = await promoCrud.create(this.crudDeps(), dto, { id: 'system-crm', hotelId, role: 'hotel_admin' } as CurrentUser)
    await this.sockets.onPromoCodeCreated?.(promo)
    return promo
  }

  async update(id: string, dto: UpdatePromoCodeDTO, user: CurrentUser): Promise<PromoCodeDTO> {
    this.logger.info('Actualizando promo code', { id, hotelId: user.hotelId })
    const promo = await promoCrud.update(this.crudDeps(), id, dto, user)
    await this.sockets.onPromoCodeUpdated?.(promo)
    return promo
  }

  async remove(id: string, user: CurrentUser): Promise<{ id: string; deleted: true }> {
    this.logger.info('Borrando promo code', { id, hotelId: user.hotelId })
    const existing = await this.promoCodes.findOne({ id })
    const result = await promoCrud.remove(this.crudDeps(), id, user)
    if (existing) await this.sockets.onPromoCodeDeleted?.(result.id, existing.hotelId)
    return result
  }

  /** Validación pública (sin auth). El controller resuelve hotelId por slug antes. */
  async validate(
    hotelId: string,
    code: string,
    subtotal: number,
  ): Promise<PromoValidationResult> {
    return promoValidate.validate({ promoCodes: this.promoCodes }, hotelId, code, subtotal)
  }

  /**
   * FIX 2026-07-31 — Incremento system-to-system para el connector `reservas-promocodes`
   * (reservas creadas por el staff en el panel, no por el widget público). Mismo criterio
   * que `createPublicBookingDirect`: solo se llama DESPUÉS de crear la reserva exitosamente.
   * Sin `user`/ownership — el hotelId ya viene validado por el módulo `reservas` (que forzó
   * `dto.hotelId === currentUser.hotelId` antes de siquiera llamar acá). No-op silencioso si
   * el código no existe (raro: se borró entre validar y crear).
   */
  async incrementUsesByCode(hotelId: string, code: string): Promise<void> {
    const normalized = String(code ?? '').trim().toUpperCase()
    const found = await this.promoCodes.findOne({ hotelId, code: normalized })
    if (!found) return
    await this.promoCodes.update(found.id, { uses: (found.uses ?? 0) + 1 })
  }
}
