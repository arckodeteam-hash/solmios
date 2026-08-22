import { createModule, OrmRepository } from 'arckode-framework'
import { PricingService } from './service'
import { PricingCalendarService } from './service-calendar'
import { PricingController } from './controller'
import { PricingQueries } from './usecases/pricing-queries'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { PricingService }

export function PricingModule() {
  return createModule({
    name: 'pricing',
    version: '1.0.0',
    description: 'Pricing: seasons, rates, blocks, restrictions, channel metrics',
    contract: {
      name: 'pricing', version: '1.0.0',
      description: 'Inventory and pricing management',
      actions: ['listSeasons', 'updateSeasons', 'listRates', 'updateRates', 'copyRatesNextYear', 'listBlocks', 'createBlocks', 'deleteBlock', 'listRateRestrictions', 'updateRateRestrictions', 'listDateRestrictions', 'updateDateRestrictions', 'listSeasonAssignments', 'assignSeason', 'getChannelMetrics'],
      events: [],
      tables: ['seasons', 'room_rates', 'room_blocks', 'rate_restrictions', 'date_restrictions', 'season_assignments'],
      dependencies: [],
      rules: [],
    },
    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('pricing: auth dependency required')
      const log = logger.child('pricing')
      const seasonsRepo = new OrmRepository<any>(orm, 'Seasons')
      const ratesRepo = new OrmRepository<any>(orm, 'RoomRates')
      const blocksRepo = new OrmRepository<any>(orm, 'RoomBlocks')
      const restrictionsRepo = new OrmRepository<any>(orm, 'RateRestrictions')
      const dateRestrictionsRepo = new OrmRepository<any>(orm, 'DateRestrictions')
      const seasonAssignmentsRepo = new OrmRepository<any>(orm, 'SeasonAssignments')
      const queries = new PricingQueries(orm)
      const usersRepo = new OrmRepository<any>(orm, 'Users')
      const service = new PricingService(seasonsRepo, ratesRepo, blocksRepo, restrictionsRepo, log, queries, usersRepo)
      const calendar = new PricingCalendarService(dateRestrictionsRepo, seasonAssignmentsRepo, log)
      const controller = new PricingController(service, log, calendar)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const guard = createPermissionGuard(auth, roleRepo)
      // Feature-gating por plan: temporadas + matriz de tarifas = sub-clave 'settings.rates'
      // (/panel/config/tarifas "Temporadas y Tarifas"). El RESTO del módulo (blocks,
      // restrictions, assignments) lo consume el planning y NO se gatea por acá.
      const ratesGuard = (a: 'view' | 'edit') => [...guard('settings', a), createModuleGuard(orm)('settings.rates')]

      router.get('/api/seasons', ratesGuard('view'), (req: any) => controller.listSeasons(req))
      router.put('/api/seasons', ratesGuard('edit'), (req: any) => controller.updateSeasons(req))
      router.post('/api/seasons/activate', ratesGuard('edit'), (req: any) => controller.activateSeason(req))
      router.get('/api/rates', ratesGuard('view'), (req: any) => controller.listRates(req))
      router.put('/api/rates', ratesGuard('edit'), (req: any) => controller.updateRates(req))
      router.post('/api/rates/copy-next-year', ratesGuard('edit'), (req: any) => controller.copyRatesNextYear(req))
      router.get('/api/pricing-mode', guard('settings', 'view'), (req: any) => controller.getPricingMode(req))
      router.put('/api/pricing-mode', guard('settings', 'edit'), (req: any) => controller.setPricingMode(req))
      router.get('/api/blocks', guard('settings', 'view'), (req: any) => controller.listBlocks(req))
      router.post('/api/blocks', guard('settings', 'create'), (req: any) => controller.createBlocks(req))
      router.delete('/api/blocks/:id', guard('settings', 'delete'), (req: any) => controller.deleteBlock(req))
      router.get('/api/rate-restrictions', guard('settings', 'view'), (req: any) => controller.listRateRestrictions(req))
      router.put('/api/rate-restrictions', guard('settings', 'edit'), (req: any) => controller.updateRateRestrictions(req))
      // Días Mínimos por fecha (fila del planning). Lectura con reservations:view — el calendario la
      // pinta para recepción; la edición sigue siendo settings:edit (config de tarifas).
      router.get('/api/date-restrictions', guard('reservations', 'view'), (req: any) => controller.listDateRestrictions(req))
      router.put('/api/date-restrictions', guard('settings', 'edit'), (req: any) => controller.updateDateRestrictions(req))
      // Temporada por fecha (diálogo "Asignación de temporadas" del planning). Lectura con
      // reservations:view (el calendario la pinta); asignación con settings:edit (config de tarifas).
      router.get('/api/season-assignments', guard('reservations', 'view'), (req: any) => controller.listSeasonAssignments(req))
      router.post('/api/season-assignments', guard('settings', 'edit'), (req: any) => controller.assignSeason(req))
      router.get('/api/channel-metrics', guard('settings', 'view'), (req: any) => controller.getChannelMetrics(req))

      log.info('Módulo pricing listo (15 endpoints)')
      return service
    },
  })
}
