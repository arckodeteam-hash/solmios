// platform-emails/index.ts — PUERTA PÚBLICA
// Solo esto es visible para otros módulos y conectores.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Plantillas editables de los 6 correos del ciclo de vida de la suscripción SaaS
// (welcome, trial_ending, trial_expired, payment_succeeded, payment_failed,
// subscription_canceled). Son de PLATAFORMA, no de hotel — solo `super_admin` las administra.
// `sendEvent()` lo consumen subscriptions (webhook Stripe + signup) y el cron de trial vía
// `resolveModule('platform-emails')` — no hay connector porque no hay lógica de dominio cruzada,
// solo un puerto de envío (mismo criterio que webhooks.dispatch()).

import { createModule, OrmRepository } from 'arckode-framework'
import { registerPlatformEmailsModels } from './model'
import { PlatformEmailsService } from './service'
import { PlatformEmailsController } from './controller'
import type { PlatformEmailTemplateDTO } from './types'
import { requireUserType } from '../../infrastructure/auth/require-user-type'

export { PlatformEmailsService }
export type { PlatformEmailTemplateDTO, UpdatePlatformEmailTemplateDTO, PlatformEmailSender, PlatformEmailEvent, CurrentUser } from './types'
export type { PlatformEmailsSockets } from './sockets'
export { UpdatePlatformEmailTemplateSchema, SendTestEmailSchema } from './validators/schema'

export function PlatformEmailsModule() {
  return createModule({
    name: 'platform-emails',
    version: '1.0.0',
    description: 'Plantillas editables de los correos de PLATAFORMA (ciclo de vida de la suscripción SaaS)',

    contract: {
      name: 'platform-emails',
      version: '1.0.0',
      description: 'CRUD de plantillas + sendEvent() para el ciclo de vida de la suscripción SaaS.',
      actions: ['list', 'get', 'update', 'sendEvent'],
      events: [],
      tables: ['platform_email_templates'],
      dependencies: [],
      rules: ['Solo super_admin (userType admin). 1 fila por evento, sin insert duplicado.'],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('platform-emails: auth dependency required')
      registerPlatformEmailsModels(orm)

      const repo = new OrmRepository<PlatformEmailTemplateDTO>(orm, 'PlatformEmailTemplate')
      // `Configuration` (modelo compartido): nombre de la plataforma y contacto de soporte que
      // el super-admin carga en Configuración → Plataforma, para `{platform_name}` y compañía.
      const configRepo = new OrmRepository<Record<string, unknown>>(orm, 'Configuration')
      const log = logger.child('platform-emails')
      const service = new PlatformEmailsService(repo, configRepo)
      const controller = new PlatformEmailsController(service, log)

      // Plantillas de PLATAFORMA, no de hotel: solo el dueño de la plataforma (super_admin +
      // userType admin) las administra. Mismo patrón que admin/index.ts.
      const sa = [auth.authenticate('super_admin'), requireUserType('admin')]

      router.get('/api/admin/platform-emails', sa, () => controller.index())
      router.get('/api/admin/platform-emails/:event', sa, (req: any) => controller.show(req))
      router.put('/api/admin/platform-emails/:event', sa, (req: any) => controller.update(req))
      router.post('/api/admin/platform-emails/:event/test', sa, (req: any) => controller.sendTest(req))

      log.info('Módulo platform-emails listo (4 endpoints)')
      return service
    },
  })
}
