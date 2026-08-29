// wallet-pass/service.ts — Facade del módulo (F3, spec wallet-pass).
//
// Responsabilidades:
//  - `generatePass(reservationId)`: orquesta TTLock + Apple pass + Google pass + persist
//    + email. DELEGA a usecases/generate-pass.ts (extraído para evitar God Object >200 líneas,
//    convención del proyecto — mismo molde que external-reviews/service.ts).
//  - `getByReservation(hotelId, reservationId, user)`: lectura admin con ownership IDOR.
//
// NO sabe de HTTP. NO importa de otros módulos. Recibe dependencias por constructor
// (Dependency Inversion): `RepositoryAdapter<WalletPassDTO>`, no el ORM directo.
//
// Anti-patrón ORM (mem 1805): TODO campo persistido por el service/DTO/validator está
// declarado en `model.ts` (case-sensitive).
import type { RepositoryAdapter, Logger, Auth } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type { StorageService } from 'arckode-framework/modules/storage'
import type { EmailService } from '../../services/email-service'
import type { WalletPassDTO, WalletPassQuery, WalletPassPaginated, CurrentUser } from './types'
import type { WalletPassSockets } from './sockets'
import { generatePass as generatePassUsecase, type TtlockPort, type GeneratePassDeps } from './usecases/generate-pass'
import { sendPassEmailNow as sendPassEmailNowUsecase } from './usecases/send-pass-now'

export interface WalletPassServiceDeps {
  auth: Auth
  /** Repo `Configuration` (creds Apple/Google). */
  configRepo: RepositoryAdapter<Record<string, unknown>>
  /** Repo `LockCodes` (read-only, para reuso). */
  lockCodeRepo: RepositoryAdapter<{ reservationId?: string; hotelId?: string; code?: string; status?: string }>
  /** Repo `Reservations`. */
  reservationRepo: RepositoryAdapter<any>
  /** Repo `Hotels`. */
  hotelRepo: RepositoryAdapter<any>
  /** Repo `Guests`. */
  guestRepo: RepositoryAdapter<any>
  /** Repo `Rooms`. */
  roomRepo: RepositoryAdapter<any>
  /** Puerto TTLock (resolveModule). Opcional: si no está, no se generan passes (solo lockCode reusado). */
  ttlock?: TtlockPort | null
  /** StorageService para .pkpass firmado. */
  storage?: StorageService
  /** EmailService para encolar el correo. */
  emailService?: EmailService | null
}

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export class WalletPassService {
  private sockets: WalletPassSockets = {}
  private deps: WalletPassServiceDeps

  constructor(
    private readonly repo: RepositoryAdapter<WalletPassDTO>,
    private readonly logger: Logger,
    deps: WalletPassServiceDeps,
  ) {
    this.deps = deps
  }

  /** Conecta sockets (lo inyecta el connector que orqueste eventos, si lo hubiera). */
  setSockets(_s: Partial<WalletPassSockets>): void {
    // Por ahora no hay sockets definidos (ver sockets.ts). Skeleton para onRoomReassigned futuro.
  }

  /** Inyecta el EmailService post-init (lo cablea `email-bootstrap.ts`). Idempotente. */
  setEmailDeps(emailService: EmailService): void {
    this.deps = { ...this.deps, emailService }
  }

  /** Inyecta el puerto TTLock post-init (lo cablea `composition-root.ts` cuando ttlock ya está
   *  registrado en el container). Idempotente. Sin esto, el usecase solo reusa lockCodes
   *  existentes — no puede generar nuevos (reservas sin código previo). */
  setTtlockPort(ttlock: TtlockPort | null): void {
    this.deps = { ...this.deps, ttlock }
  }

  /**
   * Punto de entrada del trigger (onBookingPaid). DELEGA al usecase.
   * Best-effort total: NUNCA lanza. Si algo falla, loguea y devuelve null.
   */
  async generatePass(reservationId: string, sendEmail = true): Promise<{ pass: WalletPassDTO; alreadyExisted: boolean; emailQueued: boolean } | null> {
    return generatePassUsecase(this.passDeps(), reservationId, sendEmail)
  }

  /**
   * Manda el correo "pase + código" de un pase ya generado. Lo llama
   * `prearrival-pass-cron.ts` 24 h antes de la llegada, cuando la habitación ya está firme.
   * Best-effort: false si no se pudo (el cron reintenta en el tick siguiente).
   */
  async sendPassEmailNow(reservationId: string): Promise<boolean> {
    return sendPassEmailNowUsecase(this.passDeps(), reservationId)
  }

  /** Deps compartidas por los usecases del módulo. */
  private passDeps(): GeneratePassDeps {
    return {
      walletPassRepo: this.repo,
      configRepo: this.deps.configRepo,
      lockCodeRepo: this.deps.lockCodeRepo,
      reservationRepo: this.deps.reservationRepo,
      hotelRepo: this.deps.hotelRepo,
      guestRepo: this.deps.guestRepo,
      roomRepo: this.deps.roomRepo,
      ttlock: this.deps.ttlock,
      storage: this.deps.storage,
      emailService: this.deps.emailService,
      logger: this.logger,
    }
  }

  /** Lectura admin: pass por reservationId, validando ownership del hotel. */
  async getByReservation(reservationId: string, user: CurrentUser): Promise<WalletPassDTO> {
    const pass = await this.repo.findOne({ reservationId })
    if (!pass) throw new NotFoundError('Wallet pass no encontrado para esa reserva')
    this.deps.auth.assertOwnership(pass.hotelId, user.hotelId ?? '', user.role, 'super_admin')
    return pass
  }

  /** Listado admin paginado por hotelId del JWT. */
  async list(query: WalletPassQuery, user: CurrentUser): Promise<WalletPassPaginated> {
    const hotelId = user.role === 'super_admin' ? (query.hotelId ?? user.hotelId ?? '') : (user.hotelId ?? '')
    if (!hotelId) throw new ValidationError('Sin hotel asignado')
    const filters: Record<string, unknown> = { hotelId }
    if (query.reservationId) filters.reservationId = query.reservationId

    const page = Math.max(query.page ?? DEFAULT_PAGE, 1)
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const offset = (page - 1) * limit
    const result = await this.repo.paginate(filters, { offset, limit })
    return {
      data: result.data,
      total: result.total,
      page, limit,
      pages: Math.max(Math.ceil(result.total / limit), 0),
    }
  }
}
