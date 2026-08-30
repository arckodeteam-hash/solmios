// deletion-requests/index.ts — PUERTA PÚBLICA del módulo deletion_requests.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Solicitudes de eliminación de datos personales (Ley 172-13): el formulario público
// de /p/eliminacion-datos crea la solicitud (sin auth, rate-limited) y el super_admin
// la gestiona desde Panel › Eliminación de datos. Scope PLATAFORMA, mismo patrón que
// site-pages: sin hotelId, edición solo super_admin (userType admin).
//
// Wiring: registra el modelo `DeletionRequests`, construye repo + service + controller:
//   GET    /api/deletion-requests             admin (super_admin + requireUserType admin)
//   GET    /api/deletion-requests/:id         admin
//   PUT    /api/deletion-requests/:id         admin (solo status/notes)
//   DELETE /api/deletion-requests/:id         admin
//   POST   /api/public/deletion-requests      pública (sin auth, rate-limited 5/min/IP)
import { createModule, OrmRepository } from 'arckode-framework'
import { registerDeletionRequestsModels } from './model'
import { DeletionRequestsService } from './service'
import { DeletionRequestsController } from './controller'
import type { DeletionRequestDTO } from './types'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'
import { rateLimit, getClientIp } from '../../shared/middlewares/rate-limit'

export { DeletionRequestsService }
export type {
  DeletionRequestDTO, CreateDeletionRequestDTO, UpdateDeletionRequestDTO,
  DeletionRequestAck, DeletionRequestListResult, DeletionRequestStatus,
} from './types'
export { DELETION_REQUEST_STATUSES, STATUS_LABELS } from './types'
export { DeletionRequestsValidator, CreateDeletionRequestSchema, UpdateDeletionRequestSchema } from './validators/schema'
export { registerDeletionRequestsModels } from './model'

export function DeletionRequestsModule() {
  return createModule({
    name: 'deletion-requests',
    version: '1.0.0',
    description: 'Solicitudes de eliminación de datos personales (formulario público /p/eliminacion-datos)',

    contract: {
      name: 'deletion-requests',
      version: '1.0.0',
      description: 'Formulario público de eliminación de datos (Ley 172-13) + gestión admin del flujo received→verifying→completed/rejected',
      actions: ['list', 'getById', 'create', 'updateStatus', 'delete'],
      events: ['onDeletionRequestCreated', 'onDeletionRequestUpdated'],
      tables: ['deletion_requests'],
      dependencies: [],
      rules: [
        'Scope plataforma: sin hotelId — no es contenido de un hotel',
        'Gestión (list/update/delete) solo super_admin (userType admin)',
        'Creación pública sin auth, rate-limited por IP',
        'El público solo recibe {requestNumber} — nunca status/notes de otras solicitudes',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('deletion-requests: auth dependency required')
      registerDeletionRequestsModels(orm)

      const repo = new OrmRepository<DeletionRequestDTO>(orm, 'DeletionRequests')
      const log = logger.child('deletion-requests')
      const service = new DeletionRequestsService(repo, log)
      const controller = new DeletionRequestsController(service, log)

      // Guard de plataforma (mismo patrón que site-pages): solo el dueño del SaaS gestiona.
      const sa = [auth.authenticate('super_admin'), requireUserType('admin'), createModuleGuard(orm)('deletion-requests')]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      router.get('/api/deletion-requests', sa, () => controller.index())
      router.get('/api/deletion-requests/:id', sa, (req) => controller.show(req))
      router.put('/api/deletion-requests/:id', sa, (req) => controller.update(req))
      router.delete('/api/deletion-requests/:id', sa, (req) => controller.destroy(req))

      // ─── Ruta pública ─────────────────────────────────────────────────────
      // Rate limit más estricto que site-pages (5/min vs 30/min): es un formulario que
      // escribe, no un GET de contenido — frena spam/abuso sin bloquear un envío legítimo.
      router.post('/api/public/deletion-requests', async (req: any) => {
        const { allowed, retryAfter } = await rateLimit(`public-deletion-requests:${getClientIp(req)}`, {
          maxAttempts: 5,
          windowMs: 60_000,
        })
        if (!allowed) return { status: 429, body: { error: 'Too many requests', retryAfter } }
        return controller.publicStore(req)
      })

      log.info('Módulo deletion-requests listo')
      return service
    },
  })
}
