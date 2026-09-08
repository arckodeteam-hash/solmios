// marketing/index.ts — PUERTA PÚBLICA
import { createModule, OrmRepository } from 'arckode-framework'
import { registerMarketingModels } from './model'
import { MarketingService } from './service'
import { MarketingController } from './controller'
import type { AutoMessageDTO, MessageLogDTO, WhatsappTemplateDTO } from './types'
import type { TriggerDeps } from './service'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'

export { MarketingService }
export type { AutoMessageDTO, MessageLogDTO, WhatsappTemplateDTO, CreateAutoMessageDTO, CreateMessageLogDTO, CreateWhatsappTemplateDTO } from './types'
export type { MarketingSockets } from './sockets'
export type { TriggerDeps } from './service'

export function MarketingModule(opts?: { triggerDeps?: TriggerDeps }) {
  return createModule({
    name: 'marketing', version: '1.0.0',
    description: 'Marketing Automatizado — auto-mensajes, logs, plantillas WhatsApp',

    contract: {
      name: 'marketing', version: '1.0.0', description: 'Auto-messages + WhatsApp templates (sync con Meta) + delivery logs',
      actions: ['listAutoMessages','createAutoMessage','updateAutoMessage','deleteAutoMessage','listMessageLogs','listTemplates','createTemplate','updateTemplate','deleteTemplate','triggerAutoMessages','submitTemplateToMeta','syncTemplateStatus','crearPlantillasBase'],
      events: ['onAutoMessageSent'],
      tables: ['auto_messages','message_logs','whatsapp_templates'],
      dependencies: [],
      rules: ['No importar de otros módulos'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('marketing: auth dependency required')
      registerMarketingModels(orm)

      const autoMsgRepo = new OrmRepository<AutoMessageDTO>(orm, 'AutoMessages')
      const logRepo = new OrmRepository<MessageLogDTO>(orm, 'MessageLogs')
      const templateRepo = new OrmRepository<WhatsappTemplateDTO>(orm, 'WhatsappTemplates')

      const log = logger.child('marketing')
      const service = new MarketingService(autoMsgRepo, logRepo, templateRepo, log, cache, opts?.triggerDeps, auth)
      const controller = new MarketingController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const guard = createPermissionGuard(auth, roleRepo)

      router.get('/api/auto-messages', guard('settings', 'view'), (req) => controller.listAutoMessages(req))
      router.post('/api/auto-messages', guard('settings', 'create'), (req) => controller.createAutoMessage(req))
      router.put('/api/auto-messages/:id', guard('settings', 'edit'), (req) => controller.updateAutoMessage(req))
      router.delete('/api/auto-messages/:id', guard('settings', 'delete'), (req) => controller.deleteAutoMessage(req))

      router.get('/api/whatsapp-templates', guard('settings', 'view'), (req) => controller.listTemplates(req))
      router.post('/api/whatsapp-templates', guard('settings', 'create'), (req) => controller.createTemplate(req))
      router.put('/api/whatsapp-templates/:id', guard('settings', 'edit'), (req) => controller.updateTemplate(req))
      router.delete('/api/whatsapp-templates/:id', guard('settings', 'delete'), (req) => controller.deleteTemplate(req))
      // Meta: enviar a aprobación y traer el estado. Ambas ESCRIBEN (la segunda actualiza la
      // copia local con lo que contesta Meta), por eso las dos piden permiso de edición.
      // Va ANTES de las rutas con :id para que 'recomendadas' no se lea como un id.
      router.post('/api/whatsapp-templates/recomendadas', guard('settings', 'create'), (req) => controller.seedTemplates(req))
      router.post('/api/whatsapp-templates/:id/submit', guard('settings', 'edit'), (req) => controller.submitTemplate(req))
      router.post('/api/whatsapp-templates/:id/sync-status', guard('settings', 'edit'), (req) => controller.syncTemplateStatus(req))

      router.get('/api/message-logs', guard('settings', 'view'), (req) => controller.listMessageLogs(req))

      log.info('Módulo marketing listo — 3 tablas, 12 endpoints + trigger')
      return service
    },
  })
}
