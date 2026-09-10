// connectors/monitoring-auditlog.ts — Registra en el audit log quién creó o descargó un backup.
// Un backup es un volcado COMPLETO de los datos de todos los hoteles: sin rastro no hay backup.
// `monitoring` declara el puerto (shared/usecases/audit) y este connector inyecta la implementación:
// los módulos nunca se importan entre sí (regla del framework). El connector solo DELEGA.

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

export function monitoringAuditlogConnector(ctx: ConnectorContext): void {
  const monitoring = ctx.resolveModule<{ setAuditDeps: (p: any) => void }>('monitoring')
  const auditlog = ctx.resolveModule<AuditlogModule>('auditlog')

  monitoring.setAuditDeps({
    record: async (entry: AuditEntry): Promise<void> => {
      await auditlog.create({
        hotelId: entry.hotelId,
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity ?? 'backup',
        entityId: entry.entityId,
        detail: entry.detail,
      })
    },
  })
}
