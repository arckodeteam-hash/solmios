import { OrmRepository } from 'arckode-framework'
import { EmailService } from '../services/email-service'
import type { EmailQueueDTO } from '../services/email-service'
import { NotificationRenderer, type AutoMessageTemplateRow } from '../services/notification-renderer'
import type { EmailSender } from '../services/email-sender'
import type { Logger } from 'arckode-framework'

export interface EmailBootstrapResult {
  emailService: EmailService
  startWorker: () => void
}

export function bootstrapEmail(orm: any, logger: Logger, resolveModule: <T>(name: string) => T | null): EmailBootstrapResult {
  const emailConfigRepo = new OrmRepository<Record<string, unknown>>(orm, 'Configuration')
  const emailQueueRepo = new OrmRepository<EmailQueueDTO>(orm, 'EmailQueue')
  const notificationRenderer = new NotificationRenderer(new OrmRepository<AutoMessageTemplateRow>(orm, 'AutoMessages'), logger)
  const emailService = new EmailService(emailConfigRepo, emailQueueRepo, logger, notificationRenderer)

  const reservasForEmail = resolveModule<{ setEmailDeps(es: EmailSender, r: any): void }>('reservas')
  if (reservasForEmail && typeof reservasForEmail.setEmailDeps === 'function') {
    reservasForEmail.setEmailDeps(emailService, new OrmRepository<any>(orm, 'MessageLogs'))
  }

  const facturasForEmail = resolveModule<{ setEmailDeps(ep: any, hr: any): void }>('facturas')
  if (facturasForEmail && typeof facturasForEmail.setEmailDeps === 'function') {
    facturasForEmail.setEmailDeps(emailService, new OrmRepository<any>(orm, 'Hotels'))
  }

  // Payroll: envío de recibos de nómina por email (#157) + nombre del hotel para el A4.
  const payrollForEmail = resolveModule<{ setEmailDeps(ep: any, hr: any): void }>('payroll')
  if (payrollForEmail && typeof payrollForEmail.setEmailDeps === 'function') {
    payrollForEmail.setEmailDeps(emailService, new OrmRepository<any>(orm, 'Hotels'))
  }

  // Payment-requests: envía el link de pago (Stripe) por email al generar el checkout (sentVia='email').
  const payReqForEmail = resolveModule<{ setEmailDeps(es: any, hr: any): void }>('payment-requests')
  if (payReqForEmail && typeof payReqForEmail.setEmailDeps === 'function') {
    payReqForEmail.setEmailDeps(emailService, new OrmRepository<any>(orm, 'Hotels'))
  }

  // Opiniones: email de invitación a reseña post-checkout con link público /resena/:token.
  const opinionesForEmail = resolveModule<{ setEmailDeps(es: any, gr: any, hr: any, url: string): void }>('opiniones')
  if (opinionesForEmail && typeof opinionesForEmail.setEmailDeps === 'function') {
    opinionesForEmail.setEmailDeps(emailService, new OrmRepository<any>(orm, 'Guests'), new OrmRepository<any>(orm, 'Hotels'), process.env.PUBLIC_URL || '')
  }

  // Capacitación: correo de inscripción con material + link de autoconfirmación. PUBLIC_URL arma el
  // link absoluto del correo (ej: https://hotel.zx89.site); sin él, el correo va sin botón de confirmar.
  const capacitacionForEmail = resolveModule<{ setEmailDeps(es: EmailSender, ur: any, publicUrl?: string): void }>('capacitacion')
  if (capacitacionForEmail && typeof capacitacionForEmail.setEmailDeps === 'function') {
    capacitacionForEmail.setEmailDeps(emailService, new OrmRepository<any>(orm, 'Users'), process.env.PUBLIC_URL)
  }

  // Verificación de email del alta (#421): el correo con el link va al registrarse, y el reenvío
  // desde el banner del panel. PUBLIC_URL arma el link absoluto.
  const subsForEmail = resolveModule<{ setEmailDeps(es: EmailSender, url?: string): void }>('subscriptions')
  if (subsForEmail && typeof subsForEmail.setEmailDeps === 'function') {
    subsForEmail.setEmailDeps(emailService, process.env.PUBLIC_URL)
  }

  // SMTP-UI (2026-08-19): botón "Email de prueba" del super-admin — envío directo vía el
  // mismo pipeline (SMTP o Resend), devuelve el error real en vez de un toast falso.
  const adminForEmail = resolveModule<{ setEmailDeps(es: { sendTestEmail(to: string): Promise<'smtp' | 'resend'> }): void }>('admin')
  if (adminForEmail && typeof adminForEmail.setEmailDeps === 'function') {
    adminForEmail.setEmailDeps(emailService)
  }

  // Plantillas editables de los 6 correos del ciclo de vida SaaS (welcome, trial_*, payment_*,
  // subscription_canceled). platform-emails solo encola; subscriptions dispara sendEvent() desde
  // el webhook de Stripe y el alta — sin connector porque no hay lógica de dominio cruzada.
  const platformEmailsMod = resolveModule<{
    setEmailDeps(s: EmailSender): void
    sendEvent(event: string, to: string, hotelId: string, vars: Record<string, string>): Promise<{ sent: boolean }>
  }>('platform-emails')
  if (platformEmailsMod && typeof platformEmailsMod.setEmailDeps === 'function') {
    platformEmailsMod.setEmailDeps(emailService)
  }
  if (subsForEmail && platformEmailsMod && typeof (subsForEmail as any).setPlatformEmailSender === 'function') {
    (subsForEmail as any).setPlatformEmailSender((event: string, to: string, hotelId: string, vars: Record<string, string>) =>
      platformEmailsMod.sendEvent(event, to, hotelId, vars))
  }
  const usuariosForEmail = resolveModule<{ setEmailVerificationDeps(es: EmailSender, url: string): void }>('usuarios')
  if (usuariosForEmail && typeof usuariosForEmail.setEmailVerificationDeps === 'function') {
    usuariosForEmail.setEmailVerificationDeps(emailService, process.env.PUBLIC_URL || '')
  }

  const marketingSvc = resolveModule<{ setTriggerDeps(deps: any): void }>('marketing')
  if (marketingSvc && typeof marketingSvc.setTriggerDeps === 'function') {
    marketingSvc.setTriggerDeps({
      emailSender: emailService,
      guestRepo: new OrmRepository<any>(orm, 'Guests'),
      roomRepo: new OrmRepository<any>(orm, 'Rooms'),
      hotelRepo: new OrmRepository<any>(orm, 'Hotels'),
    })
  }

  // F3 3.9 (solmi-direct-booking) — Wallet pass: el módulo encola el email "Tu pase + código
  // de acceso" tras generar Apple+Google. Sin esto, el pass se persiste pero el huésped no
  // recibe el link — tiene que volver a la página de confirmación para verlo. Best-effort.
  const walletPassForEmail = resolveModule<{ setEmailDeps(es: EmailSender): void }>('wallet-pass')
  if (walletPassForEmail && typeof walletPassForEmail.setEmailDeps === 'function') {
    walletPassForEmail.setEmailDeps(emailService)
  }

  // F3 3.14 (solmi-direct-booking) — Abandon recovery: el cron encola el email "Completá tu
  // reserva" para reservas pending entre 1h y 4h tras su creación. Sin esto, el cron detecta
  // los candidatos pero no tiene cómo mandar el email (degrada a log + retry indefinido,
  // porque el flag abandonEmailSent no se marca sin encolado exitoso).
  const abandonRecoveryForEmail = resolveModule<{ setEmail(es: EmailSender): void }>('abandon-recovery')
  if (abandonRecoveryForEmail && typeof abandonRecoveryForEmail.setEmail === 'function') {
    abandonRecoveryForEmail.setEmail(emailService)
  }

  // Eliminación de datos (Ley 172-13): acuse de recibo al solicitante (si dejó correo) + aviso
  // al admin, best-effort desde el service — sin esto la solicitud igual queda guardada, solo
  // no avisa por correo (degrada a "hay que mirar Panel › Eliminación de Datos a mano").
  const deletionRequestsForEmail = resolveModule<{ setEmailDeps(es: EmailSender): void }>('deletion-requests')
  if (deletionRequestsForEmail && typeof deletionRequestsForEmail.setEmailDeps === 'function') {
    deletionRequestsForEmail.setEmailDeps(emailService)
  }

  const EMAIL_WORKER_TICK_MS = 30_000
  const startWorker = () => {
    emailService.reclaimStale().catch(() => {})
    setInterval(() => {
      emailService.processQueue().catch((e) => logger.error('email worker tick', { error: (e as Error).message }))
      emailService.reclaimStale().catch((e) => logger.error('email worker reclaim', { error: (e as Error).message }))
    }, EMAIL_WORKER_TICK_MS)
    logger.info('EmailService worker listo', { tickMs: EMAIL_WORKER_TICK_MS })
  }

  return { emailService, startWorker }
}
