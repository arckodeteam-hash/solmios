// notification-route.ts — Único lugar donde una notificación decide a dónde lleva (#135). La
// campana (NotificationBell) y la página /panel/notificaciones comparten esta función: antes cada
// una tenía su propio if/else por type y ninguna conocía metadata.link, que es lo que el backend
// manda para los tickets de soporte ('/panel/support?ticket=<id>').
// El link sólo se acepta si es una ruta interna ('/...' pero no '//...'): viene de datos guardados
// y nunca debe mandar al usuario a un origen externo.
import type { AppNotification } from '@/services/Notifications.service'

const ROUTE_BY_TYPE: Record<string, string> = {
  support: '/panel/support',
  payment: '/panel/finanzas/facturacion',
  housekeeping: '/panel/operaciones/limpieza',
  maintenance: '/panel/operaciones/mantenimiento',
  review: '/panel/resenas',
}

function isInternalLink(link: unknown): link is string {
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//')
}

export function resolveNotificationRoute(n: Pick<AppNotification, 'type' | 'metadata'>): string | null {
  const meta = (n.metadata || {}) as { link?: unknown; reservationId?: unknown }
  if (isInternalLink(meta.link)) return meta.link
  if (meta.reservationId) return '/panel/reservas'
  return ROUTE_BY_TYPE[n.type] ?? null
}
