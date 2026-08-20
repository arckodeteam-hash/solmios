// services/email-service.ts — Email transaccional multi-tenant con cola persistente.
//
// Responsabilidad: encolar, procesar (con reintentos + backoff) y enviar emails.
// Proveedores: SMTP (Configuration key 'email_config') con fallback a Resend
// (Configuration key 'resend_api_key'). Multi-tenant por hotelId.
//
// Es un servicio TRANSVERSAL (no módulo): no tiene endpoints CRUD propios,
// es consumido por otros módulos (reservas, y futuras auto-messages).
// Análogo a StripeService. Las dependencias se inyectan en composition-root.
//
// REGLA: sin credenciales hardcodeadas. Todo SMTP/Resend se lee de Configuration.

import nodemailer from 'nodemailer'
import type { RepositoryAdapter, Logger } from 'arckode-framework'
import { NotificationRenderer, renderTemplate } from './notification-renderer'
import type { EmailSender, NotificationInput } from './email-sender'

// Re-exports backward-compat: renderTemplate y NotificationInput migraron a módulos propios (SRP).
export { renderTemplate } from './notification-renderer'
export type { NotificationInput } from './email-sender'

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type EmailStatus = 'pending' | 'processing' | 'sent' | 'failed'

export interface EmailQueueDTO {
  id: string
  hotelId: string
  /** Destinatario (columna 'recipient' en DB; 'to' es palabra reservada de SQL). */
  recipient: string
  subject: string
  html: string
  status: EmailStatus
  attempts: number
  maxAttempts: number
  lastError?: string | null
  nextRetryAt?: string | null
  provider?: 'smtp' | 'resend' | null
  relatedType?: string | null
  relatedId?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface EnqueueInput {
  to: string
  subject: string
  html: string
  hotelId: string
  /** Variables de plantilla a interpolar (placeholders {guest_name}, etc.). */
  variables?: Record<string, string | number>
  /** Origen del email para trazabilidad (ej: 'reservation'). */
  relatedType?: string
  relatedId?: string
}

interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
  secure: boolean
}

/**
 * Normaliza un objeto de config SMTP en cualquiera de sus dos shapes (SMTP-UI 2026-08-19):
 * canónico `{host,port,user,pass,from,secure}` o legacy de la UI `{server,port,user,password,
 * fromEmail,fromName}`. Null si falta algo esencial. Exportada para testear directo.
 */
export function normalizeSmtpConfig(cfg: Record<string, unknown> | null): SmtpConfig | null {
  if (!cfg) return null
  const host = cfg.host ?? cfg.server
  const user = cfg.user
  const pass = cfg.pass ?? cfg.password
  if (!host || !user || !pass) return null
  const port = Number(cfg.port) || 587
  const fromEmail = cfg.from ?? cfg.fromEmail
  const from = fromEmail
    ? (cfg.fromName ? `${String(cfg.fromName)} <${String(fromEmail)}>` : String(fromEmail))
    : 'noreply@solmios.com'
  return {
    host: String(host),
    port,
    user: String(user),
    pass: String(pass),
    from,
    secure: cfg.secure === true || port === 465,
  }
}

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Backoff exponencial tras cada fallo: 1min, 5min, 15min (3 reintentos). */
const BACKOFF_MS = [60_000, 300_000, 900_000]
const MAX_ATTEMPTS = 3
/** Límite defensivo de tamaño del HTML (500 KB). */
const MAX_HTML_BYTES = 500_000
/** Filas en 'processing' más viejas que esto se consideran stale (crash del worker). */
const STALE_MS = 5 * 60_000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─── Errores ────────────────────────────────────────────────────────────────

export class EmailNotConfiguredError extends Error {
  constructor(message = 'No email provider configured (email_config or resend_api_key)') {
    super(message)
    this.name = 'EmailNotConfiguredError'
  }
}

// Render de plantillas (renderTemplate / escapeHtml / resolveTemplate) → notification-renderer.ts.

// ─── EmailService ───────────────────────────────────────────────────────────

export class EmailService implements EmailSender {
  /** Guard de reentrada: un solo processQueue por proceso a la vez. */
  private processing = false
  /** Cache de transporters SMTP por host:port:user (evita reconstruir por email). */
  private transporters = new Map<string, nodemailer.Transporter<unknown>>()

  constructor(
    private readonly configRepo: RepositoryAdapter<Record<string, unknown>>,
    private readonly queueRepo: RepositoryAdapter<EmailQueueDTO>,
    private readonly logger: Logger,
    /** Render de plantillas (override hotel > default código > 'es). Default: renderer sin override (solo defaults de código). */
    private readonly renderer: NotificationRenderer = new NotificationRenderer(null, logger),
  ) {}

  /**
   * Encola un email para envío asíncrono. Inserta la fila y dispara el procesamiento
   * fire-and-forget (no bloquea al caller). Devuelve el id de la fila en cola.
   */
  async enqueue(input: EnqueueInput): Promise<string> {
    if (!input.to || !EMAIL_RE.test(input.to)) {
      throw new Error(`EmailService: recipient inválido "${input.to}"`)
    }
    if (!input.hotelId) {
      throw new Error('EmailService: hotelId requerido (multi-tenancy)')
    }
    if (Buffer.byteLength(input.html, 'utf8') > MAX_HTML_BYTES) {
      throw new Error('EmailService: HTML payload excede 500KB')
    }

    const html = input.variables ? renderTemplate(input.html, input.variables) : input.html
    const created = await this.queueRepo.create({
      hotelId: input.hotelId,
      recipient: input.to,
      subject: input.subject,
      html,
      status: 'pending',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      lastError: null,
      nextRetryAt: null,
      provider: null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
    } as Omit<EmailQueueDTO, 'id'>)

    // Envío inmediato sin bloquear: el worker del interval también lo tomará.
    this.processQueue().catch((e) => this.logger.error('EmailService enqueue → processQueue', { error: (e as Error).message }))

    return String((created as EmailQueueDTO).id ?? '')
  }

  /**
   * Encola una notificación resolviendo la plantilla por (event, language) vía NotificationRenderer,
   * y delega al enqueue existente. (spec 11.1.6 + refactor SOLID: renderer separado).
   */
  async enqueueNotification(input: NotificationInput): Promise<string> {
    const { subject, html } = await this.renderer.resolveAndRender({
      hotelId: input.hotelId, event: input.event, language: input.language, variables: input.variables,
    })
    return this.enqueue({
      to: input.to, subject, html, hotelId: input.hotelId,
      relatedType: input.relatedType, relatedId: input.relatedId,
    })
  }

  /** ¿El hotel tiene SMTP o Resend configurado? Pre-validación antes de encolar (no prometer envío sin config). */
  async isConfigured(hotelId: string): Promise<boolean> {
    return !!(await this.resolveSmtpConfig(hotelId)) || !!(await this.resolveResendKey(hotelId))
  }

  /**
   * Worker de la cola. Toma filas `pending` vencidas y las envía.
   * Reentrante-safe (guard `processing`). Una sola fila por proceso a la vez.
   * Limitación documentada: no soporta multi-instancia (claim atómico requiere
   * SQL crudo que esta capa no debe usar); en single-process SQLite esto es correcto.
   */
  async processQueue(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      const now = new Date().toISOString()
      const pending = (await this.queueRepo.findMany({ status: 'pending' } as Partial<EmailQueueDTO>)) as EmailQueueDTO[]
      const due = pending.filter((r) => !r.nextRetryAt || r.nextRetryAt <= now)
      for (const row of due) {
        await this.processOne(row)
      }
    } catch (e) {
      this.logger.error('EmailService processQueue', { error: (e as Error).message })
    } finally {
      this.processing = false
    }
  }

  /** Reclama filas `processing` stale (worker crasheó) al arranque del server. */
  async reclaimStale(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - STALE_MS).toISOString()
      const stuck = (await this.queueRepo.findMany({ status: 'processing' } as Partial<EmailQueueDTO>)) as EmailQueueDTO[]
      for (const row of stuck) {
        if (!row.updatedAt || row.updatedAt < cutoff) {
          await this.queueRepo.update(row.id, { status: 'pending', nextRetryAt: null } as Partial<EmailQueueDTO>)
          this.logger.warn('EmailService: stale reclaim', { id: row.id, to: row.recipient })
        }
      }
    } catch (e) {
      this.logger.error('EmailService reclaimStale', { error: (e as Error).message })
    }
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  /** Procesa una fila: reclama, envía y actualiza estado. */
  private async processOne(row: EmailQueueDTO): Promise<void> {
    // Revalidación (defensa multi-camino): sigue pending antes de tomarla.
    const fresh = await this.queueRepo.findOne({ id: row.id, status: 'pending' } as Partial<EmailQueueDTO>)
    if (!fresh) return
    await this.queueRepo.update(row.id, { status: 'processing' } as Partial<EmailQueueDTO>)

    try {
      const provider = await this.sendNow({ to: row.recipient, subject: row.subject, html: row.html, hotelId: row.hotelId })
      await this.queueRepo.update(row.id, { status: 'sent', provider, lastError: null, nextRetryAt: null } as Partial<EmailQueueDTO>)
    } catch (e) {
      await this.handleFailure(row, e as Error)
    }
  }

  /** Envía el email: SMTP desde Configuration, fallback Resend, o error si ninguno. */
  private async sendNow(input: { to: string; subject: string; html: string; hotelId: string }): Promise<'smtp' | 'resend'> {
    const smtp = await this.resolveSmtpConfig(input.hotelId)
    if (smtp) {
      const transporter = this.getTransporter(smtp)
      await transporter.sendMail({ from: smtp.from, to: input.to, subject: input.subject, html: input.html })
      return 'smtp'
    }

    const resendKey = await this.resolveResendKey(input.hotelId)
    if (resendKey) {
      const fromAddress = 'SolmiOS <noreply@solmios.com>'
      const { Resend } = await import('resend')
      const resend = new Resend(resendKey)
      const { error } = await resend.emails.send({ from: fromAddress, to: input.to, subject: input.subject, html: input.html })
      if (error) throw new Error(`Resend: ${error.message}`)
      return 'resend'
    }

    throw new EmailNotConfiguredError()
  }

  /**
   * Lee SMTP de Configuration. Null si no configurado/válido.
   *
   * SMTP-UI (auditoría 2026-08-19): tolerante a los DOS contratos que existen en la wild —
   * la página de settings del super-admin guardaba key `'smtp'` con `{server,password,
   * fromEmail,fromName}` mientras acá sólo se leía key `'email_config'` con `{host,pass,
   * from,secure}` → la config era SIEMPRE null aunque el admin la hubiera completado, y el
   * botón "Email de prueba" (un toast falso) lo tapó. Se prueban ambas keys (cada una
   * hotel → platform) y se normaliza cualquier shape al canónico. El frontend nuevo ya
   * guarda el canónico; el fallback rescata filas ya persistidas con el shape viejo.
   */
  private async resolveSmtpConfig(hotelId: string): Promise<SmtpConfig | null> {
    const readCfg = async (key: string, scope: string): Promise<Record<string, unknown> | null> => {
      try {
        const row = await this.configRepo.findOne({ hotelId: scope, key } as Record<string, unknown>)
        const raw = (row as { value?: unknown } | null)?.value
        if (typeof raw === 'string') {
          try { return JSON.parse(raw) as Record<string, unknown> } catch { return null }
        }
        return (raw as Record<string, unknown>) ?? null
      } catch {
        return null
      }
    }
    for (const key of ['email_config', 'smtp']) {
      for (const scope of [hotelId, 'platform']) {
        const normalized = normalizeSmtpConfig(await readCfg(key, scope))
        if (normalized) return normalized
      }
    }
    return null
  }

  /**
   * Envío DIRECTO (sin cola) para el botón "Email de prueba" del super-admin — reusa
   * `sendNow`, así prueba el pipeline real (SMTP o Resend) y deja escapar el error
   * verdadero en vez del toast falso que ocultaba la desconexión de config.
   */
  async sendTestEmail(to: string): Promise<'smtp' | 'resend'> {
    return this.sendNow({
      to,
      subject: 'SolmiOS — email de prueba',
      html: '<p>Si estás leyendo esto, la configuración de correo de la plataforma funciona. ✅</p>',
      hotelId: 'platform',
    })
  }

  /** Lee la API key de Resend de Configuration key 'resend_api_key'. Null si vacío. */
  private async resolveResendKey(hotelId: string): Promise<string | null> {
    try {
      let row = await this.configRepo.findOne({ hotelId, key: 'resend_api_key' } as Record<string, unknown>)
      // Fallback a config 'platform' (SaaS: API key compartida).
      if (!row) row = await this.configRepo.findOne({ hotelId: 'platform', key: 'resend_api_key' } as Record<string, unknown>)
      const raw = (row as { value?: unknown } | null)?.value
      let key: unknown = raw
      if (raw && typeof raw === 'object') key = (raw as { key?: unknown; api_key?: unknown }).key ?? (raw as { api_key?: unknown }).api_key
      if (typeof key === 'string' && key.trim()) return key.trim()
      return null
    } catch {
      return null
    }
  }

  /** Cache de transporter SMTP por credenciales (evita reconstruir por envío). */
  private getTransporter(cfg: SmtpConfig): nodemailer.Transporter<unknown> {
    const cacheKey = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.pass}`
    const cached = this.transporters.get(cacheKey)
    if (cached) return cached
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    })
    this.transporters.set(cacheKey, transporter)
    return transporter
  }

  /** Maneja un fallo de envío: reintento con backoff o fallo permanente. */
  private async handleFailure(row: EmailQueueDTO, e: Error): Promise<void> {
    const attempts = Number(row.attempts || 0) + 1
    const errMsg = e instanceof EmailNotConfiguredError ? 'no provider configured' : (e.message || String(e))

    if (attempts >= MAX_ATTEMPTS) {
      await this.queueRepo.update(row.id, { status: 'failed', attempts, lastError: errMsg, nextRetryAt: null } as Partial<EmailQueueDTO>)
      this.logger.warn('EmailService: envío fallido definitivo', { id: row.id, to: row.recipient, attempts, error: errMsg })
      return
    }

    const nextRetryAt = new Date(Date.now() + BACKOFF_MS[attempts - 1]).toISOString()
    await this.queueRepo.update(row.id, { status: 'pending', attempts, lastError: errMsg, nextRetryAt } as Partial<EmailQueueDTO>)
    this.logger.warn('EmailService: reintento programado', { id: row.id, to: row.recipient, attempts, nextRetryAt, error: errMsg })
  }
}
