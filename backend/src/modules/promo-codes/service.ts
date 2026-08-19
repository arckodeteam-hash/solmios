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
import * as promoAtomic from './usecases/promo-atomic'

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
    // Flujo de SISTEMA: el canje del CRM ya validó ownership de ese hotel (assertOwnership
    // contra el huésped del mismo hotel), así que no pasa por promoCrud.create — que exige
    // un user REAL de la DB y con 'system' fallaría con Forbidden. Persistencia directa
    // con el mismo shape que promoCrud (verificado contra su create).
    const record = {
      id: crypto.randomUUID(),
      hotelId,
      code: dto.code.toUpperCase(),
      kind: 'fixed',
      value: dto.value,
      minAmount: 0,
      maxUses: 1,
      uses: 0,
      validFrom: dto.validFrom,
      validTo: dto.validTo,
      active: true,
    } as any
    const promo = await this.promoCodes.create(record) as PromoCodeDTO
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
   * PC-1 (auditoría 2026-08-19) — El viejo `incrementUsesByCode` era un read-modify-write
   * incondicional POST-create: dos flujos concurrentes podían consumir un single-use dos veces
   * (staff + widget). Reemplazado por consumo CAS en `usecases/promo-atomic.ts`, que se llama
   * ANTES de persistir la reserva y lanza ConflictError si el código se agotó. El orm se
   * cablea desde el index del módulo (OrmRepository no expone `updateMany`, necesario para el
   * optimistic lock — ver comentario en promo-atomic.ts).
   */
  private atomicOrm: any = null
  setAtomicOrm(orm: any): void { this.atomicOrm = orm }

  /** Consume un uso ANTES de persistir la reserva que aplica el código. ConflictError si agotado. */
  async consumeUseByCode(hotelId: string, code: string): Promise<void> {
    if (!this.atomicOrm) throw new Error('promo-codes: atomic ops no cableadas (falta setAtomicOrm)')
    return promoAtomic.consumeUse(this.atomicOrm, hotelId, code)
  }

  /**
   * Devuelve un uso (PC-5): cancelación de la reserva que lo consumió, o compensación cuando
   * el create/update de la reserva falla tras el consumo. Best-effort, floor 0.
   */
  async releaseUseByCode(hotelId: string, code: string): Promise<void> {
    if (!this.atomicOrm) throw new Error('promo-codes: atomic ops no cableadas (falta setAtomicOrm)')
    return promoAtomic.releaseUse(this.atomicOrm, hotelId, code)
  }
}
