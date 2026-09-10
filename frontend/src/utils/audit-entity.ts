// utils/audit-entity.ts — Normalización y agrupamiento PURA de entidades de audit log
// (sin Vue, testeable sola).
//
// #139: el filtro de auditoría comparaba contra la entidad cruda (`log.category`), así
// 'Reservations' (226 entradas) y 'reservation' (24) caían en grupos distintos y 5 de 7
// opciones del desplegable devolvían la tabla vacía. Acá vive la única definición de qué
// entidad forma cada grupo; la página (super-admin/audit.vue) solo consume estas funciones.

/** Quita acentos y pasa a minúsculas — mismo criterio que norm() en components/ui/SearchSelect.vue. */
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Singular heurístico en inglés (el idioma de las entidades del DTO): 'guests' → 'guest',
 * 'policies' → 'policy'. No es un plural genérico: 'cash_shift' o 'address' no cambian. */
function singular(s: string): string {
  if (s.length > 3 && s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (s.length > 2 && s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us')) return s.slice(0, -1)
  return s
}

/** Entidad de audit log normalizada: minúsculas, sin acentos y en singular.
 * 'Reservations' → 'reservation', 'guests' → 'guest', 'cash_shift' queda 'cash_shift'. */
export function normalizeEntity(raw: string | null | undefined): string {
  const s = norm(String(raw ?? '')).trim()
  return s ? singular(s) : ''
}

/** Entidad normalizada → grupo del filtro. El GRUPO (no la entidad) es el valor del
 * <option>: facturación son tres entidades pero una sola opción ('billing'). */
export const ENTITY_GROUPS: Record<string, string> = {
  reservation: 'reservation',
  invoice: 'billing',
  payment: 'billing',
  expense: 'billing',
  auth: 'auth',
  configuration: 'configuration',
  user: 'user',
  hotel: 'hotel',
}

/** Grupo de una entidad (cruda o ya normalizada): entityGroup('invoice') === 'billing'.
 * Una entidad desconocida es su propio grupo — mejor una opción extra que un filtro vacío. */
export function entityGroup(entity: string | null | undefined): string {
  const key = normalizeEntity(entity)
  return ENTITY_GROUPS[key] ?? key
}

export interface AuditFilterOption {
  /** Valor del <option> del filtro: el grupo, no la entidad. */
  value: string
  /** Cuántos logs cargados caen en el grupo. */
  count: number
}

/** Opciones del select derivadas SOLO de los grupos presentes en los logs (mismo patrón que
 * statusOptions en super-admin/subscriptions.vue): si no hay logs de auth, 'auth' no aparece
 * y ninguna opción del desplegable devuelve la tabla vacía. Orden alfabético por grupo. */
export function auditFilterOptions(logs: readonly { entity?: string | null }[]): AuditFilterOption[] {
  const acc = new Map<string, number>()
  for (const log of logs) {
    const group = entityGroup(log?.entity)
    if (!group) continue // log sin entidad (el "Sistema" de la tabla) no genera opción
    acc.set(group, (acc.get(group) ?? 0) + 1)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }))
}
