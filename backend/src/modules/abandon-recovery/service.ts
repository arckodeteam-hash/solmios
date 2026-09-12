// abandon-recovery/service.ts — Lógica de sweep de reservas abandonadas (F3, task 3.14).
//
// El módulo NO tiene tabla propia: opera sobre `reservations` (campo `abandonEmailSent`).
// No inyecta el ORM directo: recibe un `OrmRepository` tipado para mantener el contrato
// testable sin exponer la superficie completa del ORM a los servicios (anti-patrón framework).
//
// Flujo del sweep:
//   1. Lista reservas con `status='pending'` AND `abandonEmailSent=false` creadas entre
//      (now - maxAge) y (now - minAge). Es decir: llevan entre 1h y 4h pendientes.
//   2. Para cada una:
//      a. Resuelve el email del guest (vía Guests repo). Si no hay email → skip + log.
//      b. Construye el link público: `{publicBaseUrl}/book/:slug?reservation=:id&token=:accessToken`.
//         Si la reserva no tiene `accessToken` (creada desde panel, no pública) → skip + log.
//      c. Encola el email "Completá tu reserva" vía EmailService.enqueue.
//      d. Si el encolado dio `sent:true` → marca `abandonEmailSent=true` (idempotencia).
//      e. Si el encolado falló → NO marca el flag → el próximo tick reintenta.
//
// Resiliencia: try/catch por reserva (un error no rompe el batch). El cron outer también
// tiene try/catch (en el factory de shared/usecases/) → no tira el setInterval.
//
// Anti-patrón ORM: el campo `abandonEmailSent` está declarado en `ReservasModel` (model.ts).
// Si NO lo declarábamos, el ORM lo descartaba silenciosamente al hacer `update()` y el flag
// quedaba en false para siempre → el cron re-enviaría el email cada 30 min para siempre.
//
// Multi-tenancy: la query filtra por hotelId recorriendo TODOS los hoteles (no hay req.user
// en un cron). El repositorio de Reservations ya aísla por hotel cuando se lo pasa el caller.

import type { RepositoryAdapter, Logger } from 'arckode-framework'
import type { AbandonSweepResult, AbandonEmailSender, AbandonSweepConfig, GatewayConfiguredCheck } from './types'
import { DEFAULT_ABANDON_MIN_AGE_MS, DEFAULT_ABANDON_MAX_AGE_MS } from './types'
import { buildRecoveryLink, renderAbandonEmailHtml, emailSubject } from './usecases/template'
import { isExpired, ttlFor, checkGateway, isInAbandonWindow } from './usecases/eligibility'
import { sendAbandonEmail } from './usecases/send-email'
import type { BookingConfigLookup } from './usecases/eligibility'

export interface AbandonRecoveryDeps {
  /** Repo de Reservations (campo abandonEmailSent fue agregado por la migración). */
  reservations: RepositoryAdapter<any>
  /** Repo de Guests para resolver el email del huésped por reservation.guestId. */
  guests: RepositoryAdapter<any>
  /** Repo de Hotels para resolver el slug del hotel (link de recuperación lo necesita). */
  hotels: RepositoryAdapter<any>
  /** EmailService (o un test double). null al arranque — se inyecta post-init vía setEmail()
   *  desde email-bootstrap (mismo patrón que wallet-pass.setEmailDeps). */
  email: AbandonEmailSender | null
  /** Repo de BookingConfig (subset) para leer `pendingTtlMinutes` del hotel (#266).
   *  Opcional: sin él se asume el TTL por defecto (60 min). */
  bookingConfig?: BookingConfigLookup | null
  /** #266: ¿el hotel tiene pasarela de pago configurada? Opcional (null/undefined = no se
   *  chequea). Se inyecta post-init vía setGatewayCheck() desde composition-root. Si devuelve
   *  false el correo no se encola: el link llevaría a un checkout que no existe. */
  isGatewayConfigured?: GatewayConfiguredCheck | null
}

export class AbandonRecoveryService {
  constructor(
    private readonly deps: AbandonRecoveryDeps,
    private readonly logger: Logger,
    private readonly config: AbandonSweepConfig = {
      minAgeMs: DEFAULT_ABANDON_MIN_AGE_MS,
      maxAgeMs: DEFAULT_ABANDON_MAX_AGE_MS,
      publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    },
  ) {}

  /**
   * Inyección post-init del EmailService (post-system.start). El EmailService se construye
   * en `bootstrapEmail()` DESPUÉS de registrar los módulos, así que no puede pasarse al
   * factory. Este método lo cablea cuando ya está disponible — mismo patrón que
   * `wallet-pass.setEmailDeps`. Si no se llama, el cron loguea errores (no rompe arranque).
   */
  setEmail(email: AbandonEmailSender): void {
    (this.deps as { email: AbandonEmailSender | null }).email = email
    this.logger.info('abandon-recovery: EmailService cableado')
  }

  /**
   * Inyección post-init del check de pasarela (#266). Mismo patrón que `setEmail`: el
   * módulo de pagos se resuelve en composition-root después de registrar este módulo, así
   * que no puede pasarse al factory. Si no se llama, el sweep no filtra por pasarela.
   */
  setGatewayCheck(fn: GatewayConfiguredCheck): void {
    (this.deps as { isGatewayConfigured?: GatewayConfiguredCheck | null }).isGatewayConfigured = fn
    this.logger.info('abandon-recovery: check de pasarela cableado')
  }

  /**
   * Recorre las reservas abandonadas y encola el email de recuperación. Idempotente por
   * el flag `abandonEmailSent` (se marca solo si el encolado tuvo éxito).
   */
  async runSweep(now: Date = new Date()): Promise<AbandonSweepResult> {
    const result: AbandonSweepResult = { scanned: 0, emailed: 0, skipped: 0, errors: [] }
    const nowMs = now.getTime()
    const minCreatedAt = new Date(nowMs - this.config.maxAgeMs).toISOString()
    const maxCreatedAt = new Date(nowMs - this.config.minAgeMs).toISOString()

    // Query cruza: status pending + flag en false + ventana de createdAt.
    // El ORM no soporta operadores < > directamente en findMany; lo resolvemos trayendo
    // las pendientes con flag=false y filtrando por createdAt en JS (mismo patrón que
    // reports/usecases/no-show-cron.ts: trae el subconjunto indexado, filtra fino acá).
    const ttlCache = new Map<string, number>()
    const candidates = await this.deps.reservations.findMany({
      status: 'pending',
      abandonEmailSent: false,
    }) as Array<{ id: string; status?: string; guestId?: string; hotelId?: string; accessToken?: string | null; createdAt?: string; paymentDeadlineAt?: string | null }>

    for (const r of candidates) {
      // Filtro por ventana temporal en JS (más vieja de 4h, o más nueva de 1h → no cuenta).
      if (!r.createdAt) { result.skipped++; continue }
      if (!isInAbandonWindow(r.createdAt, nowMs, this.config)) continue
      result.scanned++

      // #266: si la reserva ya venció (o dejó de estar pending), el cron de vencimiento la
      // cancela → el link "completá tu reserva" sería un link muerto. Skip sin marcar flag.
      const ttlMinutes = await ttlFor(r.hotelId, this.deps.bookingConfig, ttlCache, this.logger)
      if (isExpired(r, nowMs)) {
        result.skipped++
        this.logger.info('abandon-recovery: reserva ya venció el plazo de pago (#266) — skip', { id: r.id, ttlMinutes, paymentDeadlineAt: r.paymentDeadlineAt ?? null })
        continue
      }

      // #266: sin pasarela de pago no hay checkout al que volver → el correo no tiene sentido.
      const gw = await checkGateway(r.hotelId, this.deps.isGatewayConfigured)
      if (gw.outcome !== 'ok') {
        if (gw.outcome === 'error') result.errors.push({ reservationId: r.id, reason: gw.reason })
        else this.logger.info('abandon-recovery: hotel sin pasarela — skip', { id: r.id, hotelId: r.hotelId })
        result.skipped++
        continue
      }

      // Sin accessToken = reserva creada desde el panel, no tiene cómo recuperar el state
      // público (no hay link de retorno al widget). Skip sin marcar flag (no es "abandono público").
      if (!r.accessToken) {
        result.skipped++
        this.logger.info('abandon-recovery: reserva sin accessToken (creada desde panel) — skip', { id: r.id })
        continue
      }

      // Resolver el guest para tener el email. Si no existe o no tiene email → skip.
      let guestEmail: string | undefined
      try {
        if (r.guestId) {
          const g = await this.deps.guests.findById(r.guestId) as { email?: string } | null
          guestEmail = g?.email || undefined
        }
      } catch (e: unknown) {
        result.errors.push({ reservationId: r.id, reason: `guest lookup: ${(e as Error)?.message ?? String(e)}` })
        result.skipped++
        continue
      }
      if (!guestEmail) {
        result.skipped++
        this.logger.info('abandon-recovery: reserva sin email de guest — skip', { id: r.id })
        continue
      }

      // Resolver el slug del hotel para el link de retorno al widget.
      let hotelSlug = ''
      try {
        if (r.hotelId) {
          const h = await this.deps.hotels.findById(r.hotelId) as { slug?: string } | null
          hotelSlug = h?.slug || ''
        }
      } catch (e: unknown) {
        // Sin slug no podemos armar el link, pero igual podemos mandar un email con link
        // al dominio base (menos óptimo pero recupera el funnel). Logueamos y seguimos.
        this.logger.warn('abandon-recovery: lookup de hotel falló — mandando email sin slug', { id: r.id, error: (e as Error)?.message })
      }

      const link = buildRecoveryLink(this.config.publicBaseUrl, hotelSlug, r.id, r.accessToken)
      const html = renderAbandonEmailHtml({ link, reservationId: r.id, pendingTtlMinutes: ttlMinutes })

      // EmailService.enqueue exige hotelId (multi-tenancy): sin él no hay cómo encolar.
      if (!r.hotelId) {
        result.errors.push({ reservationId: r.id, reason: 'reserva sin hotelId' })
        continue
      }

      try {
        const r2 = await sendAbandonEmail(this.deps.email, { to: guestEmail, subject: emailSubject(), html, hotelId: r.hotelId, relatedId: r.id })
        if (r2?.sent) {
          await this.deps.reservations.update(r.id, { abandonEmailSent: true })
          result.emailed++
        } else {
          result.errors.push({ reservationId: r.id, reason: 'email enqueue returned sent=false' })
        }
      } catch (e: unknown) {
        // NO marcamos el flag → el próximo tick reintenta. Idempotencia defensiva.
        result.errors.push({ reservationId: r.id, reason: `enqueue: ${(e as Error)?.message ?? String(e)}` })
      }
    }

    this.logger.info('abandon-recovery: sweep completado', { ...result })
    return result
  }
}
