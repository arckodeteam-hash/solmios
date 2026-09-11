// connectors/restaurante-auditlog.ts — #207: registra en el audit log lo que se anula en el restaurante.
// `restaurant` declara el puerto (shared/usecases/audit) y este connector inyecta la implementación:
// los módulos nunca se importan entre sí (regla del framework). El connector solo DELEGA.
// Mismo patrón que reservas-auditlog. Acciones: restaurant.line.voided · restaurant.order.cancelled ·
// restaurant.order.refunded · restaurant.order.reservation_changed (#209: la cuenta se cargó a OTRA reserva
// que la que traía la comanda) · restaurant.discount.applied / restaurant.discount.removed (#215: descuento
// o cortesía de línea/comanda, con alcance, tipo, valor, monto y motivo) — el `detail` (JSON) trae comanda,
// monto y motivo; hotelId/userId van aparte. `entity` = restaurant_order | restaurant_order_item.

import type { ConnectorContext } from 'arckode-framework'
import type { AuditEntry } from '../shared/usecases/audit'

interface AuditlogModule {
  create: (dto: {
    hotelId?: string
    userId?: string
    action: string
    entity?: string
    entityId?: string
    detail?: string
  }) => Promise<unknown>
}

export function restauranteAuditlogConnector(ctx: ConnectorContext): void {
  const restaurant = ctx.resolveModule<{ setAuditDeps: (p: any) => void }>('restaurant')
  const auditlog = ctx.resolveModule<AuditlogModule>('auditlog')

  restaurant.setAuditDeps({
    record: async (entry: AuditEntry): Promise<void> => {
      await auditlog.create({
        hotelId: entry.hotelId,
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity ?? 'restaurant_order',
        entityId: entry.entityId,
        detail: entry.detail,
      })
    },
  })
}
