// admin/usecases/audit.ts — Puerto de auditoría de la plataforma (SC-05).
//
// Lo que se borra acá no es de un hotel: es de la plataforma entera. Borrar un plan de
// suscripción o una amenity del catálogo impacta a TODOS los tenants, y solo lo puede hacer un
// super_admin. Por eso las entries van sin `hotelId` (no pertenecen a ninguno) y con el `userId`
// del super_admin que las ejecutó.

import type { AuditEntry, AuditPort } from '../../../shared/usecases/audit'

export type { AuditEntry, AuditPort }
export { auditSafely } from '../../../shared/usecases/audit'

export type Actor = { id?: string; role?: string } | undefined

export function planDeleteEntry(plan: { id: string; name?: string; price?: number }, actor: Actor): AuditEntry {
  return {
    userId: actor?.id,
    action: 'plan.delete',
    entity: 'plan',
    entityId: plan.id,
    detail: `Plan de suscripción "${plan.name ?? plan.id}" eliminado${plan.price != null ? ` · ${plan.price}` : ''}`,
  }
}

export function amenityCatalogDeleteEntry(amenity: { id: string; name?: string }, actor: Actor): AuditEntry {
  return {
    userId: actor?.id,
    action: 'amenity_catalog.delete',
    entity: 'amenity_catalog',
    entityId: amenity.id,
    detail: `Amenity del catálogo "${amenity.name ?? amenity.id}" eliminada`,
  }
}

/**
 * REQ-PIPE-05 (#146): el super-admin le dio más días de prueba a un hotel. Va CON `hotelId`
 * (a diferencia de los borrados de plataforma): la extensión es de ESE hotel y tiene que
 * aparecer en su historial, además del `userId` del admin que la concedió.
 */
export function trialExtendEntry(
  input: { hotelId: string; days: number; previousTrialEndsAt: string | null; trialEndsAt: string },
  actor: Actor,
): AuditEntry {
  return {
    hotelId: input.hotelId,
    userId: actor?.id,
    action: 'subscription.extend_trial',
    entity: 'subscription',
    entityId: input.hotelId,
    detail: `Trial extendido ${input.days} día${input.days === 1 ? '' : 's'}: ${input.previousTrialEndsAt ?? 'sin fecha'} → ${input.trialEndsAt}`,
  }
}
