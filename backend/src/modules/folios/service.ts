import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { accumulateSockets } from '../../shared/utils/accumulate-sockets'
import { foliosOfReservation, reservationIdOfFolio } from './usecases/reservation-money'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { FolioDTO, FolioChargeDTO, OpenFolioDTO, PostChargeDTO, ApplyPaymentDTO, FolioQuery, FolioListResult, CurrentUser } from './types'
import type { FoliosSockets } from './sockets'
import { enrichFolio } from './usecases/enrich-folio'
import { loadOwnedFolio as loadOwnedFolioUsecase } from './usecases/load-owned-folio'
import { enrichFoliosBatch } from './usecases/enrich-folios-batch'
import { folioSummary } from './usecases/folio-summary'
import { closeAndInvoice as closeAndInvoiceUsecase, type CloseAndInvoiceResult } from './usecases/close-and-invoice'
import { postNightAuditRoomCharges as postNightAuditUsecase } from './usecases/night-audit'
import { foliosListCacheKey, invalidateFoliosCaches } from './usecases/cache'
import { postCharge as postChargeUsecase, applyPayment as applyPaymentUsecase } from './usecases/folio-entries'
import { postPrepaidCredit as postPrepaidCreditUsecase, type PrepaidCreditInput } from './usecases/prepaid-credit'
import { openFolio } from './usecases/open-folio'
import type { FolioPaymentPort } from './usecases/payment-port'
import { closeAndCreateInvoice as closeAndCreateInvoiceUsecase, type FolioInvoicingPort, type CloseAndCreateInvoiceResult } from './usecases/close-and-create-invoice'

export interface LookupDeps { guest: RepositoryAdapter<any>; reservation: RepositoryAdapter<any>; room: RepositoryAdapter<any>; user: RepositoryAdapter<any> }

export type { FolioInvoicingPort, IssuedInvoice, CloseAndCreateInvoiceResult } from './usecases/close-and-create-invoice'

const now = () => new Date().toISOString()

export class FoliosService {
  private sockets: FoliosSockets = {}
  private invoicingPort: FolioInvoicingPort | null = null
  private paymentPort: FolioPaymentPort | null = null
  constructor(
    private readonly folioRepo: RepositoryAdapter<FolioDTO>,
    private readonly chargeRepo: RepositoryAdapter<FolioChargeDTO>,
    private readonly configRepo: RepositoryAdapter<any>,
    private readonly deps: LookupDeps,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
  ) {}

  // ACUMULA (no pisa): implementación única en shared/utils/accumulate-sockets.ts.
  setSockets(s: Partial<FoliosSockets>): void { accumulateSockets(this.sockets as any, s as any) }

  /** Conecta la creación de facturas. Lo inyecta el connector `folios-facturas`. */
  setInvoicingDeps(port: FolioInvoicingPort): void {
    this.invoicingPort = port
  }

  /** Conecta el asiento del dinero en `payments`. Lo inyecta el connector `folios-payments`. */
  setPaymentDeps(port: FolioPaymentPort): void {
    this.paymentPort = port
  }

  private async hotelOf(user: CurrentUser): Promise<string> {
    const u = await this.deps.user.findById(user.id)
    return u?.hotelId ?? ''
  }

  // Puerto de lectura para `connectors/reservas-money` — la lógica vive en el usecase.
  foliosOfReservation(hotelId: string, reservationId: string): Promise<FolioDTO[]> { return foliosOfReservation(this.folioRepo, hotelId, reservationId) }
  reservationIdOfFolio(hotelId: string, folioId: string): Promise<string | null> { return reservationIdOfFolio(this.folioRepo, hotelId, folioId) }

  async list(query?: FolioQuery, user?: CurrentUser): Promise<FolioListResult> {
    this.logger.info('Listando folios', { query })
    const filters: Record<string, unknown> = {}
    if (user && user.role !== 'super_admin') {
      const me = await this.deps.user.findById(user.id)
      filters.hotelId = me?.hotelId ?? '__none__'
    } else if (query?.hotelId) {
      filters.hotelId = query.hotelId
    }
    if (query?.status) filters.status = query.status
    if (query?.reservationId) filters.reservationId = query.reservationId
    const cacheKey = await foliosListCacheKey(this.cache, user?.hotelId, query)
    const cached = await this.cache.get(cacheKey)
    if (cached) return cached as FolioListResult
    const folios = await this.folioRepo.findMany(filters)
    // N+1 eliminado (#274/#276): enriquecido en lote. Antes: 3 queries por folio (charges+guest+room).
    const data = await enrichFoliosBatch(
      { chargeRepo: this.chargeRepo, guestRepo: this.deps.guest, roomRepo: this.deps.room },
      folios,
    )
    const result = { data, total: data.length }
    await this.cache.set(cacheKey, result, 300)
    return result
  }

  /** Carga un folio y exige ownership del hotel antes de devolverlo. Patrón común a getById/close/setInvoice. */
  private loadOwnedFolio(id: string, user: CurrentUser): Promise<FolioDTO> {
    return loadOwnedFolioUsecase(this.folioRepo, this.deps.user, this.auth, id, user)
  }

  async getById(id: string, user: CurrentUser): Promise<FolioDTO> {
    this.logger.info('Obteniendo folio', { id })
    return this.enrich(await this.loadOwnedFolio(id, user), true)
  }

  private enrich(f: FolioDTO, includeCharges = false): Promise<FolioDTO> {
    return enrichFolio(
      { chargeRepo: this.chargeRepo, guestRepo: this.deps.guest, roomRepo: this.deps.room },
      f,
      includeCharges,
    )
  }

  async open(dto: OpenFolioDTO, user: CurrentUser): Promise<FolioDTO> {
    const hotelId = (await this.hotelOf(user)) ?? '' // V-02 IDOR: hotelId forzado del JWT, nunca del body
    const folio = await openFolio(
      { folioRepo: this.folioRepo, reservationRepo: this.deps.reservation, logger: this.logger },
      dto,
      hotelId,
    )
    await this.sockets.onFolioOpened?.(folio)
    await invalidateFoliosCaches(this.cache, folio.hotelId)
    return this.enrich(folio)
  }

  private get entriesDeps() {
    return {
      folioRepo: this.folioRepo, chargeRepo: this.chargeRepo, configRepo: this.configRepo,
      userRepo: this.deps.user, auth: this.auth, logger: this.logger, paymentPort: this.paymentPort,
    }
  }

  async postCharge(folioId: string, dto: PostChargeDTO, user: CurrentUser): Promise<FolioChargeDTO> {
    const { folio, charge } = await postChargeUsecase(this.entriesDeps, folioId, dto, user)
    await this.sockets.onFolioCharged?.(folio, charge)
    await invalidateFoliosCaches(this.cache, folio.hotelId)
    return charge
  }

  async applyPayment(folioId: string, dto: ApplyPaymentDTO, user: CurrentUser): Promise<FolioChargeDTO> {
    const { folio, charge } = await applyPaymentUsecase(this.entriesDeps, folioId, dto, user)
    await this.sockets.onFolioPaid?.(folio, charge)
    await invalidateFoliosCaches(this.cache, folio.hotelId)
    return charge
  }

  postPrepaidCredit(folioId: string, i: PrepaidCreditInput, user: CurrentUser) { return postPrepaidCreditUsecase(this.entriesDeps, folioId, i, user) }
  // ─── Cerrar folio
  async close(folioId: string, user: CurrentUser): Promise<FolioDTO> {
    const folio = await this.loadOwnedFolio(folioId, user)
    if (folio.status !== 'open') throw new ValidationError('El folio no está abierto')
    const closed = await this.folioRepo.update(folioId, { status: 'closed', closedAt: now() } as any)
    await this.sockets.onFolioClosed?.(closed)
    await invalidateFoliosCaches(this.cache, folio.hotelId)
    return this.enrich(closed as FolioDTO, true)
  }

  async summary(folioId: string, user?: CurrentUser) {
    return folioSummary({ folioRepo: this.folioRepo, chargeRepo: this.chargeRepo, userRepo: this.deps.user, auth: this.auth }, folioId, user)
  }

  async setInvoice(folioId: string, invoiceId: string, user: CurrentUser): Promise<FolioDTO> {
    await this.loadOwnedFolio(folioId, user)
    const updated = await this.folioRepo.update(folioId, { invoiceId } as any)
    return this.enrich(updated as FolioDTO, true)
  }

  /** Cierra el folio y genera la factura con los cargos como líneas de detalle. */
  async closeAndInvoice(folioId: string, user: CurrentUser): Promise<CloseAndInvoiceResult> {
    const result = await closeAndInvoiceUsecase(
      {
        folioRepo: this.folioRepo,
        chargeRepo: this.chargeRepo,
        guestRepo: this.deps.guest,
        roomRepo: this.deps.room,
        userRepo: this.deps.user,
        auth: this.auth,
      },
      folioId,
      user,
    )
    await this.sockets.onFolioClosed?.(result.folio)
    await invalidateFoliosCaches(this.cache, result.folio.hotelId)
    return result
  }

  /** Cierra el folio, emite la factura y deja el folio vinculado a ella (`invoiceId`). */
  async closeAndCreateInvoice(folioId: string, user: CurrentUser): Promise<CloseAndCreateInvoiceResult> {
    const result = await closeAndCreateInvoiceUsecase(
      {
        port: this.invoicingPort,
        logger: this.logger,
        closeAndInvoice: (id, u) => this.closeAndInvoice(id, u),
        setInvoice: (id, invId, u) => this.setInvoice(id, invId, u),
        // Compensación si la factura falla tras el cierre — ver close-and-create-invoice.ts.
        reopenFolio: (id, u) => this.loadOwnedFolio(id, u).then(() => this.folioRepo.update(id, { status: 'open', closedAt: null } as any)),
      },
      folioId,
      user,
    )
    await invalidateFoliosCaches(this.cache, result.folio.hotelId)
    return result
  }

  async postNightAuditRoomCharges(orm: any, user: any, query?: any): Promise<any> {
    return postNightAuditUsecase(orm, (q:any,u:any)=>this.list(q,u), (d:any,u:any)=>this.open(d,u), (id:string,d:any,u:any)=>this.postCharge(id,d,u), user, query)
  }
}
