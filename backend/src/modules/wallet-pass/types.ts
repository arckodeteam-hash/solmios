// wallet-pass/types.ts — DTOs y tipos del módulo (F3, spec wallet-pass).
// DB en inglés. Este archivo describe la API (NO el schema físico — eso vive en model.ts).
//
// Anti-patrón ORM (mem 1805): TODO campo declarado acá debe estar también en `model.ts`.
// Si agregás un campo acá y no allá, se descarta silenciosamente al persistir.

/** DTO principal — un wallet pass ya persistido. */
export interface WalletPassDTO {
  id: string
  hotelId: string
  reservationId: string
  /** URL firmada al .pkpass (Apple). Null si no hay cert configurado/válido. */
  appleUrl?: string | null
  /** URL "Add to Google Wallet". Null si no hay service account configurada. */
  googleUrl?: string | null
  /** Código TTLock embebido en el pass. */
  lockCode: string
  /** Timestamp ISO de generación. */
  generatedAt: string
  /** Seteado si se regenera por reasignación de habitación (spec.md:130). */
  /** Cuándo se le mandó al huésped la habitación + el código (cron de pre-llegada). */
  emailSentAt?: string | null
  obsoleteAt?: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Resultado de `generatePass(reservationId)` (usecase). `persisted` es la fila nueva o
 * la existente si ya había (idempotente por reservationId — spec.md:135 UNIQUE).
 * `emailQueued` indicador para telemetría (si se encoló el email post-generación).
 */
export interface GeneratePassResult {
  pass: WalletPassDTO
  /** true si el pass ya existía y se devolvió sin regenerar. */
  alreadyExisted: boolean
  /** true si se encoló el email "Tu pase + código de acceso". False si faltó guest/email. */
  emailQueued: boolean
}

/** Payload interno para crear un pass (lo arma el usecase, no la API). */
export interface CreateWalletPassDTO {
  hotelId: string
  reservationId: string
  appleUrl: string | null
  googleUrl: string | null
  lockCode: string
  generatedAt: string
}

/** Filtros de listado (admin). */
export interface WalletPassQuery {
  hotelId?: string
  reservationId?: string
  page?: number
  limit?: number
}

/** Respuesta paginada admin. */
export interface WalletPassPaginated {
  data: WalletPassDTO[]
  total: number
  page: number
  limit: number
  pages: number
}

/** Usuario actual (del JWT o `system` para triggers internos). */
export interface CurrentUser {
  id: string
  role: string
  hotelId?: string
}

/**
 * Resultado de generar un pass de Apple. Best-effort: si algo falla (cert faltante,
 * librería no instalada, firma inválida), devuelve `url=null` + `reason` para log.
 * El caller NO rompe — sigue con Google y persiste lo que haya.
 */
export interface ApplePassResult {
  url: string | null
  /** 'ok' | 'no_cert' | 'library_missing' | 'sign_failed' — para telemetría/log. */
  reason: string
}

/**
 * Resultado de generar un pass de Google. Best-effort: si algo falla (SA faltante,
 * error JWT), devuelve `url=null` + `reason`.
 */
export interface GooglePassResult {
  url: string | null
  /** 'ok' | 'no_service_account' | 'jwt_failed' — para telemetría/log. */
  reason: string
}
