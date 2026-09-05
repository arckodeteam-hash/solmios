// digitalizacion/index.ts — PUERTA PÚBLICA del módulo digitalizacion.
// ⚠ REGLA: Append-only. No sacar ni modificar exports existentes.
//
// Expediente de digitalización: SOLMI OS detecta hoteles SIN presencia digital y los acompaña por
// cinco pasos (página web por plantilla, configuración completa —que se cobra—, Google Maps,
// Google Hotel y motor de reservas). Scope PLATAFORMA: lo opera el super_admin desde el panel,
// mismo patrón que sales-leads / site-pages.
//
// Wiring: registra el modelo `DigitalizationCases`, construye repo + repo de hoteles (para
// detectar candidatos) + service + controller. Todas las rutas son admin — no hay ruta pública,
// es una herramienta interna de ventas:
//   GET    /api/digitalizacion              listado de expedientes
//   GET    /api/digitalizacion/candidatos   hoteles sin web y sin expediente vivo
//   GET    /api/digitalizacion/plantillas   catálogo de plantillas de la página
//   GET    /api/digitalizacion/:id          detalle
//   POST   /api/digitalizacion              abrir expediente
//   PUT    /api/digitalizacion/:id          editar expediente
//   POST   /api/digitalizacion/:id/paso     avanzar un paso
//   DELETE /api/digitalizacion/:id          eliminar expediente
import { createModule, OrmRepository } from 'arckode-framework'
import { registerDigitalizacionModels } from './model'
import { DigitalizacionService } from './service'
import { DigitalizacionController } from './controller'
import type { DigitalizacionHotelRow } from './service'
import type { DigitalizationCaseDTO } from './types'
import { requireUserType } from '../../infrastructure/auth/require-user-type'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { DigitalizacionService }
export type { DigitalizacionHotelRow, DigitalizacionSockets } from './service'
export type {
  DigitalizationCaseDTO, CreateDigitalizationCaseDTO, UpdateDigitalizationCaseDTO,
  AdvanceStepDTO, DigitalizationCandidateDTO, DigitalizationListResult,
  DigitalizationCaseStatus, DigitalizationStep, StepStatus, SiteTemplate,
} from './types'
export {
  DIGITALIZATION_STEPS, STEP_STATUSES, CASE_STATUSES,
  SITE_TEMPLATES, SITE_TEMPLATE_KEYS, STEP_LABELS, CASE_STATUS_LABELS,
} from './types'
export {
  DigitalizacionValidator, CreateDigitalizationCaseSchema,
  UpdateDigitalizationCaseSchema, AdvanceStepSchema,
} from './validators/schema'
export { registerDigitalizacionModels } from './model'

export function DigitalizacionModule() {
  return createModule({
    name: 'digitalizacion',
    version: '1.0.0',
    description: 'Expediente de digitalización de hoteles sin presencia digital (web, configuración, Google Maps, Google Hotel, motor de reservas)',

    contract: {
      name: 'digitalizacion',
      version: '1.0.0',
      description: 'Detección de hoteles sin web + acompañamiento por los cinco pasos de digitalización',
      actions: ['listCandidates', 'list', 'getById', 'create', 'advanceStep', 'update', 'delete'],
      events: ['onCaseCreated', 'onCaseUpdated'],
      tables: ['digitalization_cases'],
      dependencies: [],
      rules: [
        'Scope plataforma: lo gestiona el super_admin (userType admin), no el hotel',
        'Solo hoteles SIN website: uno que ya tiene web no es candidato ni abre expediente',
        'Un solo expediente vivo (abierto|completado) por hotel; uno cancelado no bloquea',
        'Google Maps listo es prerrequisito de Google Hotel',
        'La configuración completa se cobra: no se cierra sin configPaid',
      ],
    },

    create({ logger, orm, router, auth }) {
      if (!auth) throw new Error('digitalizacion: auth dependency required')
      registerDigitalizacionModels(orm)

      const repo = new OrmRepository<DigitalizationCaseDTO>(orm, 'DigitalizationCases')
      // Repo del modelo global `Hotels` (shared/models.ts), no de otro módulo: se usa SOLO para
      // leer nombre/website al detectar candidatos — mismo patrón que bookingengine/hotel-media.
      const hotelsRepo = new OrmRepository<DigitalizacionHotelRow>(orm, 'Hotels')
      const log = logger.child('digitalizacion')
      const service = new DigitalizacionService(repo, hotelsRepo, log)
      const controller = new DigitalizacionController(service, log)

      // Guard de plataforma (mismo patrón que sales-leads): solo el dueño del SaaS opera el programa.
      const sa = [auth.authenticate('super_admin'), requireUserType('admin'), createModuleGuard(orm)('digitalizacion')]

      // ─── Rutas admin ──────────────────────────────────────────────────────
      // ⚠ /candidatos y /plantillas van ANTES de /:id: si no, el parámetro las captura.
      router.get('/api/digitalizacion', sa, () => controller.index())
      router.get('/api/digitalizacion/candidatos', sa, () => controller.candidates())
      router.get('/api/digitalizacion/plantillas', sa, () => controller.templates())
      router.get('/api/digitalizacion/:id', sa, (req) => controller.show(req))
      router.post('/api/digitalizacion', sa, (req) => controller.store(req))
      router.put('/api/digitalizacion/:id', sa, (req) => controller.update(req))
      router.post('/api/digitalizacion/:id/paso', sa, (req) => controller.advance(req))
      router.delete('/api/digitalizacion/:id', sa, (req) => controller.destroy(req))

      log.info('Módulo digitalizacion listo')
      return service
    },
  })
}
