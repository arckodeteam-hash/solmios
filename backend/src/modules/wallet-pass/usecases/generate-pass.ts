// wallet-pass/usecases/generate-pass.ts — Orquestador principal (F3 3.7).
//
// `generatePass(reservationId)`:
//   1. Lee la reserva + hotel + guest desde `Reservations`/`Hotels`/`Guests`.
//   2. Resuelve el lockCode: si ya existe en `LockCodes` para esa reserva, lo reusa
//      (spec.md "Reuso del código TTLock" — NO genera 2). Si no, dispara
//      `ttlock.generateCode(hotelId, reservationId)` vía resolveModule.
//   3. Genera Apple pass (best-effort) y Google pass (best-effort).
//   4. Persiste la fila en `wallet_passes` — UNIQUE(reservationId) garantiza idempotencia
//      (spec.md:135). Si ya existe, devuelve el existente sin regenerar (escenario: webhook
//      Stripe reintenta y dispara onBookingPaid 2 veces).
//   5. Encola el email "Tu pase + código de acceso" via EmailService.
//
// Anti-patrón ORM (mem 1805): TODO campo persistido está declarado en `model.ts`.
// NO se toca `wallet_passes.obsoleteAt` acá (pass vigente). El campo existe en el modelo
// para el día que se cablee onRoomReassigned (spec.md:84-92).
//
// Best-effort total: este usecase NO lanza. Cualquier fallo parcial (Apple, Google,
// lockCode, email) se loguea y se persiste lo que haya. Si el lockCode no se puede obtener
// (reserva sin roomId / TTLock no configurado), NO se persiste la fila — no tiene sentido
// un pass sin código de acceso (spec.md "lockCode REQUIRED").
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { StorageService } from 'arckode-framework/modules/storage'
import type { EmailService } from '../../../services/email-service'
import type {
  WalletPassDTO, CreateWalletPassDTO, GeneratePassResult, ApplePassResult, GooglePassResult,
} from '../types'
import { generateApplePass } from './apple-pass'
import { generateGooglePass } from './google-pass'
import { sendWalletPassEmail } from './pass-email'
import { isDuplicateError } from './duplicate-detector'
import { effectiveCheckInTime, effectiveCheckOutTime } from '../../../shared/utils/hotel-schedule'

/** Puerto para generar lockCodes de TTLock (lo implementa el módulo ttlock vía resolveModule). */
export interface TtlockPort {
  generateCode(hotelId: string, reservationId: string): Promise<{ code?: string | null } | null>
}

/** Puerto para resolver la reserva + hotel + guest. Lo inyecta el service desde sus repos. */
export interface ReservationInfo {
  reservationId: string
  hotelId: string
  hotelName: string
  guestName: string
  guestEmail: string
  checkIn: string
  checkOut: string
  /** Horario EFECTIVO ('HH:MM'): desde/hasta cuándo abre el código en la cerradura. */
  checkInTime: string
  checkOutTime: string
  roomNumber?: string
}

/** Deps inyectadas por el service. */
export interface GeneratePassDeps {
  /** Repo `WalletPasses` — escritura + lectura idempotente. */
  walletPassRepo: RepositoryAdapter<WalletPassDTO>
  /** Repo `Configuration` — creds Apple/Google del hotel. */
  configRepo: RepositoryAdapter<Record<string, unknown>>
  /** Repo `LockCodes` — para leer el lockCode existente (read-only, sin generar otro). */
  lockCodeRepo: RepositoryAdapter<{ reservationId?: string; hotelId?: string; code?: string; status?: string }>
  /** Repo `Reservations` — lectura de la reserva (datos del email + lockCode source). */
  reservationRepo: RepositoryAdapter<any>
  /** Repo `Hotels` — lectura del nombre del hotel para el email + pass. */
  hotelRepo: RepositoryAdapter<any>
  /** Repo `Guests` — lectura del huésped (email + nombre para el email). */
  guestRepo: RepositoryAdapter<any>
  /** Repo `Rooms` — número de habitación para el email + pass. */
  roomRepo: RepositoryAdapter<any>
  /** Puerto TTLock — inyectado vía resolveModule('ttlock'). Si no está disponible (módulo
   *  desactivado), no se puede generar un lockCode nuevo — el pass no se persiste. */
  ttlock?: TtlockPort | null
  /** StorageService para subir el .pkpass firmado. Si falta, el pass Apple queda en stub. */
  storage?: StorageService
  /** EmailService para encolar el correo "Tu pase + código". Si falta, no se manda. */
  emailService?: EmailService | null
  logger: Logger
}

/** Resuelve los datos del hotel + reserva + guest necesarios para el pass + email. */
export async function resolveReservationInfo(
  deps: GeneratePassDeps,
  reservationId: string,
): Promise<ReservationInfo | null> {
  const r = await deps.reservationRepo.findOne({ id: reservationId }).catch(() => null)
  if (!r) return null
  const hotelId = String(r.hotelId ?? '')
  if (!hotelId) return null
  const hotel = await deps.hotelRepo.findOne({ id: hotelId }).catch(() => null)
  const guest = r.guestId ? await deps.guestRepo.findOne({ id: r.guestId }).catch(() => null) : null
  const room = r.roomId ? await deps.roomRepo.findOne({ id: r.roomId }).catch(() => null) : null
  return {
    reservationId,
    hotelId,
    hotelName: String(hotel?.name ?? 'Hotel'),
    guestName: String(guest?.name ?? guest?.firstName ?? 'Huésped'),
    guestEmail: String(guest?.email ?? ''),
    checkIn: String(r.checkIn ?? ''),
    checkOut: String(r.checkOut ?? ''),
    // MISMO cálculo con el que se abre el PIN (`shared/utils/hotel-schedule`): el correo tiene
    // que decir la hora real desde la que el código funciona, no una distinta.
    checkInTime: effectiveCheckInTime(r, hotel),
    checkOutTime: effectiveCheckOutTime(r, hotel),
    roomNumber: room?.number ? String(room.number) : undefined,
  }
}

/**
 * Resuelve el lockCode: si ya existe en `LockCodes` para la reserva (status active o
 * pending), lo reusa. Si no, dispara `ttlock.generateCode` para crearlo. Si ttlock no
 * está disponible o la generación falla, devuelve null — el caller decide qué hacer.
 */
async function resolveLockCode(
  deps: GeneratePassDeps,
  hotelId: string,
  reservationId: string,
): Promise<string | null> {
  // 1) Reuso (spec.md "Reuso del código TTLock").
  const codes = await deps.lockCodeRepo.findMany({ reservationId }).catch(() => [])
  for (const c of codes) {
    if (c.status === 'active' || c.status === 'pending') {
      // Tenancy: ignorar code de otro hotel (defensivo, debería no pasar por el index).
      if (c.hotelId && c.hotelId !== hotelId) continue
      if (c.code) return String(c.code)
    }
  }
  // 2) Generación via ttlock (spec.md:46-49). Si el módulo no está registrado, no rompe.
  if (!deps.ttlock?.generateCode) return null
  try {
    const result = await deps.ttlock.generateCode(hotelId, reservationId)
    if (result?.code) return String(result.code)
  } catch (e: unknown) {
    deps.logger.warn('wallet-pass: ttlock.generateCode falló', {
      hotelId, reservationId, error: (e as Error).message,
    })
  }
  return null
}

/**
 * Punto de entrada. Best-effort total — NUNCA lanza (el connector best-effort lo llamaría
 * con try/catch igual, pero las fallas parciales ya se manejan acá).
 */
export async function generatePass(
  deps: GeneratePassDeps,
  reservationId: string,
  /**
   * `false` genera el pase y el código de la cerradura pero NO le avisa al huésped todavía
   * (pedido del cliente 2026-08-29): la habitación puede reasignarse hasta el día antes, así
   * que el correo con habitación + código lo manda `prearrival-pass-cron.ts` 24 h antes de la
   * llegada. Default `true` para no cambiar los llamadores manuales (reenvío desde el panel).
   */
  sendEmail = true,
): Promise<GeneratePassResult | null> {
  const log = deps.logger

  // 0) Idempotencia previa a trabajo costoso: si ya existe pass para esta reserva, devolverlo.
  // UNIQUE(reservationId) en DB es la red de seguridad; este pre-check evita re-generar Apple/Google.
  const existing = await deps.walletPassRepo.findOne({ reservationId }).catch(() => null)
  if (existing) {
    log.info('wallet-pass: pass ya existe, devolviendo idempotente', { reservationId })
    return { pass: existing, alreadyExisted: true, emailQueued: false }
  }

  // 1) Resolver info de la reserva. Sin reserva, no hay nada que hacer.
  const info = await resolveReservationInfo(deps, reservationId)
  if (!info) {
    log.warn('wallet-pass: reserva no encontrada, no se genera pass', { reservationId })
    return null
  }

  // 2) Resolver lockCode. Sin lockCode, NO se persiste (spec.md lockCode REQUIRED).
  const lockCode = await resolveLockCode(deps, info.hotelId, reservationId)
  if (!lockCode) {
    log.info('wallet-pass: sin lockCode disponible (¿ttlock desactivado o reserva sin room?), se omite pass', {
      reservationId, hotelId: info.hotelId,
    })
    return null
  }

  // 3) Generar ambos passes en paralelo. Cada uno devuelve { url, reason } best-effort.
  const [appleResult, googleResult]: [ApplePassResult, GooglePassResult] = await Promise.all([
    generateApplePass(
      { configRepo: deps.configRepo, storage: deps.storage, logger: log },
      {
        hotelId: info.hotelId, reservationId, lockCode,
        hotelName: info.hotelName, checkIn: info.checkIn, checkOut: info.checkOut,
        roomNumber: info.roomNumber,
      },
    ).catch((e: unknown): ApplePassResult => {
      log.warn('wallet-pass: apple-pass exception', { reservationId, error: (e as Error).message })
      return { url: null, reason: 'sign_failed' }
    }),
    generateGooglePass(
      { configRepo: deps.configRepo, logger: log },
      {
        hotelId: info.hotelId, reservationId, lockCode,
        hotelName: info.hotelName, checkIn: info.checkIn, checkOut: info.checkOut,
        roomNumber: info.roomNumber,
      },
    ).catch((e: unknown): GooglePassResult => {
      log.warn('wallet-pass: google-pass exception', { reservationId, error: (e as Error).message })
      return { url: null, reason: 'jwt_failed' }
    }),
  ])

  // Log de reasons para telemetría. Sin appleUrl es el caso común (hoteles sin cert Apple).
  log.info('wallet-pass: passes generados', {
    reservationId, apple: appleResult.reason, google: googleResult.reason,
    hasApple: !!appleResult.url, hasGoogle: !!googleResult.url,
  })

  // 4) Persistir. Si dos webhooks chocan (race), el UNIQUE index rechaza el segundo.
  // spec.md:55-61: los URLs pueden ser null si faltan creds — no es error, es best-effort.
  const payload: CreateWalletPassDTO = {
    hotelId: info.hotelId,
    reservationId,
    appleUrl: appleResult.url,
    googleUrl: googleResult.url,
    lockCode,
    generatedAt: new Date().toISOString(),
  }
  let pass: WalletPassDTO
  try {
    // `repo.create` espera `Omit<T, 'id'>` — el ORM autocompleta createdAt/updatedAt vía
    // `timestamps: true` del modelo. El cast `as Omit<T, 'id'>` es el patrón canónico
    // (ver external-reviews/service.ts create() y facturas/folio-entries).
    pass = await deps.walletPassRepo.create(payload as Omit<WalletPassDTO, 'id'>)
  } catch (e: unknown) {
    if (!isDuplicateError(e)) throw e
    // Race: otra txn insertó la misma (reservationId) entre el pre-check y ahora. Recoger.
    const refetch = await deps.walletPassRepo.findOne({ reservationId }).catch(() => null)
    if (!refetch) throw e
    log.info('wallet-pass: race detectada, devolviendo fila pre-existente', { reservationId })
    return { pass: refetch, alreadyExisted: true, emailQueued: false }
  }

  // 5) Encolar email. Si no hay EmailService, no hay guest email, o el envío se difirió
  // al cron de pre-llegada (`sendEmail === false`), no rompe.
  let emailQueued = false
  if (deps.emailService && sendEmail) {
    const result = await sendWalletPassEmail(
      { emailService: deps.emailService, logger: log },
      {
        to: info.guestEmail,
        hotelId: info.hotelId,
        reservationId,
        hotelName: info.hotelName,
        guestName: info.guestName,
        checkIn: info.checkIn,
        checkOut: info.checkOut,
        // Ventana REAL del PIN: la misma que se cargó en la cerradura.
        checkInTime: info.checkInTime,
        checkOutTime: info.checkOutTime,
        roomNumber: info.roomNumber,
        lockCode,
        appleUrl: pass.appleUrl,
        googleUrl: pass.googleUrl,
      },
    )
    emailQueued = result.status === 'sent'
  }

  return { pass, alreadyExisted: false, emailQueued }
}
