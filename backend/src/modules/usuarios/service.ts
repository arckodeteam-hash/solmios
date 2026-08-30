// usuarios/service.ts — Auth + gestión de usuarios
import type { RepositoryAdapter, Logger, CacheAdapter, Auth } from 'arckode-framework'
import { NotFoundError, AuthError } from 'arckode-framework'
import { normalizePhone, looksLikePhone, toStoredPhone } from './usecases/normalize-phone'
import { verifyOwnerCredentials } from './usecases/verify-owner'
import { getProfile, updateProfile, type ProfilePatch } from './usecases/profile'
import { verifyEmailToken, resendVerificationEmail, type VerifyOutcome } from './usecases/email-verification'
import {
  auditSafely, roleChangeEntry, userDeleteEntry, type AuditPort, type Actor,
} from './usecases/audit'
import {
  hashPassword, verifyPassword, forgotPassword, resetPassword, changePassword,
} from './usecases/password'
import { assertOwnership, pickDefined } from './usecases/ownership'
import { jtiOf, refreshSession } from './usecases/token-session'
import { assertHotelCanOperate, type AccessCheck } from './usecases/subscription-gate'
import { switchHotel } from './usecases/switch-hotel'
import { resolveUserPermissions } from './usecases/resolve-permissions'
import { listUserHotels } from './usecases/list-hotels'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required')

export class UsuariosService {
  private auditPort: AuditPort | null = null

  constructor(
    private readonly repo: RepositoryAdapter<any>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly auth: Auth,
    private readonly hotelRepo?: RepositoryAdapter<any>,
    private readonly configRepo?: RepositoryAdapter<any>,
    // Tabla `roles` del hotel: para resolver los permisos granulares del rol (custom o de
    // sistema) y devolverlos en el login y en `/auth/me`. La UI web los usa para gatear.
    private readonly roleRepo?: RepositoryAdapter<any>,
  ) {}

  /** Corte de servicio por suscripción. Lo inyecta el connector `usuarios-subscriptions`. */
  private checkSubscription?: (hotelId: string) => Promise<AccessCheck>
  setSubscriptionCheck(fn: (hotelId: string) => Promise<AccessCheck>): void { this.checkSubscription = fn }

  /** Conecta el audit log. Lo inyecta el connector `usuarios-auditlog`. */
  setAuditDeps(port: AuditPort): void {
    this.auditPort = port
  }

  getHotels(userId: string, role: string): Promise<any[]> {
    return listUserHotels(this.repo, this.hotelRepo, userId, role)
  }

  /** Cambio de hotel activo (super_admin entre hoteles, hotel_admin al suyo). */
  switchHotel(userId: string, targetHotelId: string, currentRole: string) {
    return switchHotel({ repo: this.repo, hotelRepo: this.hotelRepo, auth: this.auth }, userId, targetHotelId, currentRole)
  }

  /** #28 — identidad sin sesión, para retomar el pago del alta. Ver `usecases/verify-owner.ts`. */
  verifyOwnerCredentials(emailOrPhone: string, password: string): Promise<{ hotelId?: string } | null> {
    return verifyOwnerCredentials(this.repo as any, emailOrPhone, password)
  }

  async login(emailOrPhone: string, password: string): Promise<{ token: string; refreshToken: string; user: any }> {
    const trimmed = emailOrPhone.trim()
    let user: any = null
    if (looksLikePhone(trimmed)) {
      const cleanInput = normalizePhone(trimmed)
      if (!cleanInput) throw new AuthError('Credenciales inválidas')
      // Phones are stored normalized (digits-only) via toStoredPhone in create/update
      user = await this.repo.findOne({ phone: cleanInput })
    } else {
      user = await this.repo.findOne({ email: trimmed.toLowerCase() })
    }
    if (!user || user.active === 0) throw new AuthError('Credenciales inválidas')
    const valid = await verifyPassword(password, user.password)
    if (!valid) throw new AuthError('Credenciales inválidas')
    await assertHotelCanOperate(user, this.checkSubscription)
    // migración lazy de legacy plaintext → bcrypt
    if (!String(user.password).startsWith('$2') && !String(user.password).startsWith('$argon2') && !String(user.password).includes(':')) {
      await this.repo.update(user.id, { password: await hashPassword(password) })
    }
    const tokenPayload = { id: user.id, role: user.role, hotelId: user.hotelId, userType: user.userType || 'merchant' }
    const token = (this.auth as any).createToken(tokenPayload)
    const refreshToken = (this.auth as any).createRefreshToken(tokenPayload)
    // Guarda el jti del refresh vigente: habilita revocarlo en logout. Single-session: un login nuevo invalida el anterior.
    await this.repo.update(user.id, { token: jtiOf(refreshToken) ?? null })
    let hotelName = ''
    if (user.hotelId && this.hotelRepo) {
      try {
        const hotel = await this.hotelRepo.findById(user.hotelId)
        if (hotel && this.auth) this.auth.assertOwnership((hotel as any).id, user.hotelId, user.role, 'super_admin')
        hotelName = (hotel as any)?.name || ''
      } catch { /* graceful */ }
    }
    // Permisos del rol para que la UI web gatee menús/botones ya desde el login (sin esperar
    // el /auth/me). Los roles custom no matchean ningún nombre hardcodeado en el frontend.
    const permissions = await resolveUserPermissions(this.roleRepo, user.role, user.hotelId)
    // `phone` para la app móvil: lo lee del login y lo guarda (igual que `/api/auth/me`).
    return { token, refreshToken, user: { id: user.id, name: user.name, email: user.email, phone: user.phone ?? '', role: user.role, hotelId: user.hotelId, hotelName, permissions } }
  }

  async me(id: string): Promise<any> {
    return getProfile(this.repo, this.hotelRepo, id, this.configRepo, this.roleRepo)
  }

  // ─── Verificación de email (#421) ────────────────────────────────────────
  /** Envío del correo de verificación + base pública del link. Lo inyecta el composition-root. */
  private emailSender?: { enqueue: (i: { to: string; subject: string; html: string; hotelId: string; relatedType?: string }) => Promise<string> }
  private appUrl = ''
  setEmailVerificationDeps(sender: NonNullable<typeof this.emailSender>, appUrl: string): void {
    this.emailSender = sender
    this.appUrl = appUrl
  }

  /** Marca el email como verificado si el token es válido. Devuelve el motivo (para el mensaje). */
  async verifyEmail(token: string): Promise<VerifyOutcome> {
    return verifyEmailToken(this.repo, token)
  }

  /** Regenera el token y reenvía el correo al usuario del token. */
  resendVerification(userId: string): Promise<{ sent: boolean }> {
    return resendVerificationEmail(this.repo, this.emailSender, this.appUrl, userId)
  }

  async updateProfile(userId: string, data: ProfilePatch): Promise<any> {
    return updateProfile(this.repo, this.hotelRepo, userId, data, this.configRepo)
  }

  async list(hotelId?: string): Promise<any[]> {
    // sin hotelId (super_admin) → todos los usuarios; con hotelId → solo ese hotel.
    const users = await this.repo.findMany(hotelId ? { hotelId } : {})
    return users.map(({ password, token, resetToken, resetExpires, ...rest }) => rest)
  }

  async create(data: any): Promise<any> {
    if (!data.password) throw new Error('Password is required')
    const password = await hashPassword(data.password)
    const phone = toStoredPhone(data.phone)
    const created = await this.repo.create({ ...data, ...phone, id: crypto.randomUUID(), password, active: 1 })
    const { password: _, token: __, resetToken: ___, resetExpires: ____, ...rest } = created
    return rest
  }

  async update(id: string, data: any, actor?: Actor): Promise<any> {
    // El destructuring materializa TODAS las claves, así que un PUT parcial (ej. solo {role})
    // llegaba al ORM con name/password en undefined y los escribía como NULL → NOT NULL violado.
    // Se descartan las ausentes: un campo que no vino no es un campo que se quiere borrar.
    const allowed = pickDefined(data, ['name', 'email', 'password', 'phone', 'avatar', 'role'])
    if (allowed.password) allowed.password = await hashPassword(allowed.password)
    Object.assign(allowed, toStoredPhone(allowed.phone))
    // El estado anterior se lee ANTES del update por dos razones: valida que el usuario sea del
    // hotel de quien lo edita (IDOR), y sin el rol viejo la auditoría diría "cambió el rol" sin
    // decir desde cuál.
    const before = await this.repo.findById(id)
    if (before && actor?.id) {
      await assertOwnership(this.repo, this.auth, before.hotelId ?? '', actor.id, actor.role)
    }
    const updated = await this.repo.update(id, allowed)
    if (before && allowed.role && allowed.role !== before.role) {
      await auditSafely(this.auditPort, this.logger, roleChangeEntry(before, allowed.role, actor))
    }
    const { password: _, token: __, resetToken: ___, resetExpires: ____, ...rest } = updated
    return rest
  }

  async delete(id: string, actor?: Actor): Promise<boolean> {
    const before = await this.repo.findById(id)
    if (before && actor?.id) {
      await assertOwnership(this.repo, this.auth, before.hotelId ?? '', actor.id, actor.role)
    }
    const deleted = await this.repo.delete(id)
    if (deleted && before) {
      await auditSafely(this.auditPort, this.logger, userDeleteEntry(before, actor))
    }
    return deleted
  }

  async logout(id: string): Promise<void> {
    await this.repo.update(id, { token: null })
  }

  async refreshToken(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    return refreshSession(this.repo, this.auth as any, refreshToken, () => {
      throw new AuthError('Sesión expirada, iniciá sesión de nuevo')
    }, (user) => assertHotelCanOperate(user, this.checkSubscription))
  }

  async forgotPassword(email: string): Promise<void> {
    return forgotPassword(this.repo, email)
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    return resetPassword(this.repo, token, newPassword)
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    return changePassword(this.repo, id, currentPassword, newPassword)
  }
}
