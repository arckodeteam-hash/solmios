// src/infrastructure/auth/hotel-auth.ts
// Auth multi-tenant: extiende Auth del framework para que el JWT lleve `hotelId`.
// El framework (arckode-framework/kernel/auth.ts) descarta `hotelId` en createToken/verifyToken
// (firma solo { id, role, type }). Esta subclase lo preserva sin tocar node_modules,
// arreglando la raíz: req.user.hotelId deja de ser undefined.
//
// authenticate() NO se sobrescribe: es heredado y llama a this.verifyToken() → polimorfismo.

import { Auth, AuthError } from 'arckode-framework'
import type { JwtAdapter, Logger } from 'arckode-framework'

export interface HotelTokenPayload {
  id: string
  role: string
  /** hotelId del hotel cuyo scope rige el token (undefined para super_admin sin hotel asignado). */
  hotelId?: string
  /** Tipo de usuario: 'admin' (plataforma) | 'merchant' (hotel) */
  userType?: string
  /**
   * Id del super admin que está impersonando a este usuario. Presente SOLO en los
   * tokens de impersonación (usuarios/usecases/impersonate.ts); en un token normal
   * es undefined. Sirve para que la UI muestre la franja de aviso y para auditar
   * quién actuó "en nombre de" quién.
   */
  impersonatedBy?: string
}

export class HotelAuth extends Auth {
  // El padre guarda jwt/secret/etc como parameter properties `private` (inaccesibles desde aquí).
  // Duplicamos refs propias para poder firmar/verificar en los métodos sobrescritos.
  private readonly jwtAdapter: JwtAdapter
  private readonly accessSecret: string
  private readonly authLogger: Logger
  private readonly accessExpiresIn: string
  private readonly hotelRefreshExpiresIn: string
  // Renombrado para no chocar con el `refreshSecret` private del padre (TS prohíbe redeclararlo).
  private readonly hotelRefreshSecret: string

  constructor(
    jwt: JwtAdapter,
    secret: string,
    logger: Logger,
    expiresIn: string = '24h',
    refreshExpiresIn: string = '30d',
  ) {
    super(jwt, secret, logger, expiresIn, refreshExpiresIn)
    this.jwtAdapter = jwt
    this.accessSecret = secret
    this.authLogger = logger
    this.accessExpiresIn = expiresIn
    this.hotelRefreshExpiresIn = refreshExpiresIn
    // Debe replicar EXACTAMENTE el refreshSecret del padre (auth.ts:20) para que los
    // refresh tokens legacy firmados por `Auth` sigan verificándose aquí tras el deploy.
    this.hotelRefreshSecret = secret + '__refresh__'
  }

  createToken(payload: HotelTokenPayload, expiresIn?: string): string {
    const ttl = expiresIn ?? this.accessExpiresIn
    const token = this.jwtAdapter.sign(
      // `impersonatedBy` viaja firmado dentro del access token: es el único lugar donde
      // el dato sobrevive a un F5 sin guardar estado en el servidor.
      { id: payload.id, role: payload.role, hotelId: payload.hotelId, userType: payload.userType || 'merchant', impersonatedBy: payload.impersonatedBy, type: 'access' },
      this.accessSecret,
      ttl,
    )
    this.authLogger.debug('Token creado', { userId: payload.id, hotelId: payload.hotelId, userType: payload.userType, expiresIn: ttl })
    return token
  }

  createRefreshToken(payload: HotelTokenPayload): string {
    const token = this.jwtAdapter.sign(
      { id: payload.id, role: payload.role, hotelId: payload.hotelId, userType: payload.userType || 'merchant', type: 'refresh', jti: crypto.randomUUID() },
      this.hotelRefreshSecret,
      this.hotelRefreshExpiresIn,
    )
    this.authLogger.debug('Refresh token creado', { userId: payload.id })
    return token
  }

  refresh(refreshToken: string): { accessToken: string; refreshToken: string } {
    try {
      const payload = this.jwtAdapter.verify(refreshToken, this.hotelRefreshSecret)
      if (payload.type !== 'refresh') throw new AuthError('Invalid token type')
      const user: HotelTokenPayload = {
        id: payload.id as string,
        role: payload.role as string,
        hotelId: payload.hotelId as string | undefined,
      }
      return {
        accessToken: this.createToken(user),
        refreshToken: this.createRefreshToken(user),
      }
    } catch (e) {
      if (e instanceof AuthError) throw e
      throw new AuthError('Invalid or expired refresh token')
    }
  }

  verifyToken(token: string): HotelTokenPayload {
    try {
      const payload = this.jwtAdapter.verify(token, this.accessSecret)
      if (payload.type !== 'access') throw new AuthError('Invalid token type')
      return {
        id: payload.id as string,
        role: payload.role as string,
        // hotelId opcional: los tokens legacy (pre-deploy, sin hotelId) siguen verificando OK.
        hotelId: payload.hotelId as string | undefined,
        // userType opcional: tokens legacy (pre-deploy, sin userType) default a 'merchant'
        userType: (payload.userType as string) || 'merchant',
        // Sin esto el claim se perdía acá (este método arma el payload campo por campo)
        // y nunca llegaba a req.user, dejando la impersonación invisible para las rutas.
        impersonatedBy: payload.impersonatedBy as string | undefined,
      }
    } catch (e) {
      if (e instanceof AuthError) throw e
      throw new AuthError('Invalid or expired token')
    }
  }
}
