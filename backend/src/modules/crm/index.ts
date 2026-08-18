// crm/index.ts — PUERTA PÚBLICA
import { createModule, OrmRepository } from 'arckode-framework'
import { registerCrmModels } from './model'
import { CrmService } from './service'
import { CrmController } from './controller'
import type { LoyaltyTransactionDTO, CouponDTO, GuestSegmentDTO } from './types'
import { createPermissionGuard } from '../../infrastructure/auth/create-permission-guard'
import { createModuleGuard } from '../../infrastructure/auth/require-module'

export { CrmService }
export type { LoyaltyTransactionDTO, CouponDTO, GuestSegmentDTO, GuestLTV, CrmDashboard, CreateCouponDTO, CreateSegmentDTO } from './types'
export type { CrmSockets } from './sockets'

export function CrmModule() {
  return createModule({
    name: 'crm', version: '1.0.0',
    description: 'CRM y Fidelización — puntos, cupones, segmentación, LTV',

    contract: {
      name: 'crm', version: '1.0.0', description: 'Loyalty + CRM engine',
      actions: ['awardPoints','redeemPoints','getPointsHistory','getPointsBalance','createCoupon','listCoupons','validateCoupon','deleteCoupon','createSegment','listSegments','getGuestsInSegment','calculateLTV','getDashboard'],
      events: ['onPointsAwarded','onTierUpgrade','onCouponUsed'],
      tables: ['loyalty_transactions','coupons','guest_segments'],
      dependencies: ['huespedes','reservas'],
      rules: ['No importar de otros módulos'],
    },

    create({ logger, orm, cache, router, auth }) {
      if (!auth) throw new Error('crm: auth dependency required')
      registerCrmModels(orm)

      const loyaltyRepo = new OrmRepository<LoyaltyTransactionDTO>(orm, 'LoyaltyTransaction')
      const couponRepo = new OrmRepository<CouponDTO>(orm, 'Coupon')
      const segmentRepo = new OrmRepository<GuestSegmentDTO>(orm, 'GuestSegment')
      const guestRepo = new OrmRepository<any>(orm, 'Guests')
      const reservaRepo = new OrmRepository<any>(orm, 'Reservations')
      const configRepo = new OrmRepository<any>(orm, 'Configuration')

      const log = logger.child('crm')
      const service = new CrmService(loyaltyRepo, couponRepo, segmentRepo, guestRepo, reservaRepo, log, cache, auth)
      service.setConfigRepo(configRepo)
      const controller = new CrmController(service, log)

      const roleRepo = new OrmRepository<any>(orm, 'Roles')
      const permGuard = createPermissionGuard(auth, roleRepo)
      const moduleGuard = createModuleGuard(orm)
      const guard = (m: string, a: string) => [...permGuard(m, a), moduleGuard('crm')]

      router.post('/api/crm/points/award', guard('guests', 'edit'), (req) => controller.awardPoints(req))
      router.post('/api/crm/points/redeem', guard('guests', 'edit'), (req) => controller.redeemPoints(req))
      router.get('/api/crm/points/history/:guestId', guard('guests', 'view'), (req) => controller.getPointsHistory(req))
      router.get('/api/crm/points/balance/:guestId', guard('guests', 'view'), (req) => controller.getPointsBalance(req))

      // DEPRECADO (spec crm-coupons): cupones del CRM → promo-codes. 410 explícito.
      router.post('/api/crm/coupons', guard('guests', 'create'), () => controller.couponGone())
      router.get('/api/crm/coupons', guard('guests', 'view'), () => controller.couponGone())
      router.post('/api/crm/coupons/validate', guard('guests', 'view'), () => controller.couponGone())
      router.delete('/api/crm/coupons/:id', guard('guests', 'edit'), () => controller.couponGone())

      router.post('/api/crm/segments', guard('guests', 'create'), (req) => controller.createSegment(req))
      router.get('/api/crm/segments', guard('guests', 'view'), (req) => controller.listSegments(req))
      router.get('/api/crm/segments/:id/guests', guard('guests', 'view'), (req) => controller.getGuestsInSegment(req))

      router.post('/api/crm/tiers/recompute', guard('guests', 'edit'), (req) => controller.recomputeTiers(req))
      router.get('/api/crm/segments/:id/export', guard('guests', 'view'), (req) => controller.exportSegment(req))

      router.get('/api/crm/ltv', guard('guests', 'view'), (req) => controller.getLTV(req))
      router.get('/api/crm/dashboard', guard('guests', 'view'), (req) => controller.getDashboard(req))

      log.info('Módulo CRM listo — 3 tablas, 14 endpoints')
      return service
    },
  })
}
