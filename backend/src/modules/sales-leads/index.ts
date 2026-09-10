// sales-leads/index.ts — PUERTA PÚBLICA del módulo sales_leads.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Leads del formulario de ventas ("Hablar con Ventas" / "Contactar ventas" de la landing):
// el formulario público crea el lead (sin auth, rate-limited) y el super_admin lo gestiona
// desde Panel › Leads de Ventas. Scope PLATAFORMA, mismo patrón que deletion-requests.
//
// Wiring: registra el modelo `SalesLeads`, construye repo + service + controller:
//   GET    /api/sales-leads             admin (super_admin + requireUserType admin)
//   GET    /api/sales-leads/:id         admin
//   PUT    /api/sales-leads/:id         admin (solo status/notes)
//   DELETE /api/sales-leads/:id         admin
//   POST   /api/public/sales-leads      pública (sin auth, rate-limited 5/min/IP)
//   GET    /api/admin/sales-pipeline     admin — pipeline calculado (REQ-PIPE-01/02)
//   GET    /api/admin/sales-pipeline/assignees admin — admins asignables {id,name,email} (SEC-3)
//   PUT    /api/admin/sales-pipeline/:key admin — upsert de sales_prospects (REQ-PIPE-03)
import { createModule, OrmRepository } from 'arckode-framework'
import { registerSalesLeadsModels } from './model'
import { SalesLeadsService } from './service'
import { SalesLeadsController } from './controller'
import type { SalesLeadDTO, SalesProspectDTO } from './types'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { SalesLeadsService }
export type {
  SalesLeadDTO, CreateSalesLeadDTO, UpdateSalesLeadDTO,
  SalesLeadAck, SalesLeadListResult, SalesLeadStatus,
} from './types'
export { SALES_LEAD_STATUSES, STATUS_LABELS } from './types'
export { SalesLeadsValidator, CreateSalesLeadSchema, UpdateSalesLeadSchema } from './validators/schema'
export { registerSalesLeadsModels } from './model'
// Pipeline de ventas (REQ-PIPE-01..03)
export type {
  SalesProspectDTO, UpdateSalesProspectDTO, SalesPipelineRow, SalesPipelineResult,
  PipelineStage, PipelineHeat, PipelineSignals, SalesLostReason,
} from './types'
export { SALES_LOST_REASONS } from './types'
export { UpdateProspectSchema } from './validators/schema'
export { SalesProspectsModel } from './model'
export { buildPipeline } from './usecases/pipeline'
export { listAssignees } from './usecases/assignees'
export type { Assignee, AssigneesResult } from './usecases/assignees'
// Aviso inmediato al alta (REQ-PIPE-04, #145) — lo dispara subscriptions.onHotelSignedUp vía
// connectors/subscriptions-sales-alert.ts; no tiene ruta HTTP.
export { buildSignupAlertEmail, signupWhatsappText, SALES_PIPELINE_PATH } from './usecases/emails'
export { notifySignup, SIGNUP_ALERT_RELATED_TYPE } from './usecases/signup-alert'

export function SalesLeadsModule() {
  return createModule({
    name: 'sales-leads',
    // 1.1.0: + GET /api/admin/sales-pipeline/assignees y `assignedTo` validado contra users admin (SEC-3).
    version: '1.1.0',
    description: 'Leads de ventas (formulario público "Hablar con Ventas" de la landing)',

    contract: {
      name: 'sales-leads',
      version: '1.1.0',
      description: 'Formulario público de contacto de ventas + gestión admin del flujo new→contacted→won/lost',
      actions: ['list', 'getById', 'create', 'updateStatus', 'delete', 'getPipeline', 'updateProspect', 'notifySignup', 'listAssignees'],
      events: ['onSalesLeadCreated', 'onSalesLeadUpdated'],
      tables: ['sales_leads', 'sales_prospects'],
      dependencies: [],
      rules: [
        'Scope plataforma: sin hotelId — no es contenido de un hotel',
        'Gestión (list/update/delete) solo super_admin (userType admin)',
        'Creación pública sin auth, rate-limited por IP',
        'El pipeline se calcula al consultar (subscriptions/hotels/rooms/...): sales_prospects guarda solo lo que ventas anota',
        'notifySignup (#145): el aviso a ventas se encola en la MISMA petición del alta (email_queue relatedType=sales-pipeline:signup, relatedId=hotelId); best-effort, nunca rompe el alta',
        'assignedTo es users.id de un admin ACTIVO de la plataforma (userType=admin): texto libre o un merchant → 400. listAssignees devuelve solo id/name/email, nunca password',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('sales-leads: auth dependency required')
      registerSalesLeadsModels(orm)

      const repo = new OrmRepository<SalesLeadDTO>(orm, 'SalesLeads')
      const log = logger.child('sales-leads')
      const service = new SalesLeadsService(repo, log)
      const controller = new SalesLeadsController(service, log)

      // Pipeline: lee tablas de otros módulos por REPO (nunca importando el módulo). Los modelos
      // los registra cada dueño en su index.ts; acá solo se abre un repo sobre el nombre.
      service.setPipelineDeps({
        subscriptions: new OrmRepository<any>(orm, 'Subscriptions'),
        hotels: new OrmRepository<any>(orm, 'Hotels'),
        rooms: new OrmRepository<any>(orm, 'Rooms'),
        roomRates: new OrmRepository<any>(orm, 'RoomRates'),
        // `channel_config` se registra como 'Canales' (canales/model.ts), no 'ChannelConfig'.
        channelConfig: new OrmRepository<any>(orm, 'Canales'),
        reservations: new OrmRepository<any>(orm, 'Reservations'),
        auditlog: new OrmRepository<any>(orm, 'Auditlog'),
        // `users`: asignables (admins de plataforma) y validación de `assignedTo` (SEC-3).
        users: new OrmRepository<any>(orm, 'Users'),
        salesLeads: repo,
        salesProspects: new OrmRepository<SalesProspectDTO>(orm, 'SalesProspects'),
        // Solo para escribir el NOMBRE del plan en el aviso del alta (#145).
        plans: new OrmRepository<any>(orm, 'Plans'),
        // `configuration('plataforma')`: el nombre de la plataforma en el WhatsApp del alta (CFG-1).
        configuration: new OrmRepository<any>(orm, 'Configuration'),
      })

      // Guard de plataforma (mismo patrón que deletion-requests): solo el dueño del SaaS gestiona.
      const sa = [auth.authenticate('super_admin'), requireUserType('admin'), createModuleGuard(orm)('sales-leads')]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/sales-leads', sa, () => controller.index())
      router.get('/api/sales-leads/:id', sa, (req) => controller.show(req))
      router.put('/api/sales-leads/:id', sa, (req) => controller.update(req))
      router.delete('/api/sales-leads/:id', sa, (req) => controller.destroy(req))

      // ─── Pipeline de ventas (admin) ───────────────────────────────────────
      router.get('/api/admin/sales-pipeline', sa, () => controller.pipeline())
      // Antes de `/:key` por si el router llegara a confundir `assignees` con una key (es GET vs PUT, pero el orden no cuesta nada).
      router.get('/api/admin/sales-pipeline/assignees', sa, () => controller.assignees())
      router.put('/api/admin/sales-pipeline/:key', sa, (req) => controller.updateProspect(req))

      // ─── Ruta pública ─────────────────────────────────────────────────────
      // Rate limit más estricto que un GET de contenido: es un formulario que escribe.
      router.post('/api/public/sales-leads', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-sales-leads:${getClientIp(req)}`, {
          maxAttempts: 5,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicStore(req)
      })

      log.info('Módulo sales-leads listo')
      return service
    },
  })
}
