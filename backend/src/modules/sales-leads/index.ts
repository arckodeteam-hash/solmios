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
import { createModule, OrmRepository } from 'arckode-framework'
import { registerSalesLeadsModels } from './model'
import { SalesLeadsService } from './service'
import { SalesLeadsController } from './controller'
import type { SalesLeadDTO } from './types'
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

export function SalesLeadsModule() {
  return createModule({
    name: 'sales-leads',
    version: '1.0.0',
    description: 'Leads de ventas (formulario público "Hablar con Ventas" de la landing)',

    contract: {
      name: 'sales-leads',
      version: '1.0.0',
      description: 'Formulario público de contacto de ventas + gestión admin del flujo new→contacted→won/lost',
      actions: ['list', 'getById', 'create', 'updateStatus', 'delete'],
      events: ['onSalesLeadCreated', 'onSalesLeadUpdated'],
      tables: ['sales_leads'],
      dependencies: [],
      rules: [
        'Scope plataforma: sin hotelId — no es contenido de un hotel',
        'Gestión (list/update/delete) solo super_admin (userType admin)',
        'Creación pública sin auth, rate-limited por IP',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('sales-leads: auth dependency required')
      registerSalesLeadsModels(orm)

      const repo = new OrmRepository<SalesLeadDTO>(orm, 'SalesLeads')
      const log = logger.child('sales-leads')
      const service = new SalesLeadsService(repo, log)
      const controller = new SalesLeadsController(service, log)

      // Guard de plataforma (mismo patrón que deletion-requests): solo el dueño del SaaS gestiona.
      const sa = [auth.authenticate('super_admin'), requireUserType('admin'), createModuleGuard(orm)('sales-leads')]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/sales-leads', sa, () => controller.index())
      router.get('/api/sales-leads/:id', sa, (req) => controller.show(req))
      router.put('/api/sales-leads/:id', sa, (req) => controller.update(req))
      router.delete('/api/sales-leads/:id', sa, (req) => controller.destroy(req))

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
