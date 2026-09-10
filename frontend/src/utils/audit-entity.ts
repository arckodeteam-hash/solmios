// utils/audit-entity.ts — Normalización y agrupamiento PURO de entidades de audit log
// (sin Vue, testeable solo).
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
export function normalizeEntity(raw: unknown): string {
  const s = norm(String(raw ?? '')).trim()
  return s ? singular(s) : ''
}

/** Grupo sin entidad: lo que la tabla muestra como categoría "Sistema". */
export const SYSTEM_GROUP = 'system'

/** Grupos del filtro. La clave es el valor del <option>; `entities` va en singular porque se
 * compara contra la entidad YA normalizada. El GRUPO (no la entidad) es lo que se filtra:
 * facturación son cuatro entidades pero una sola opción ('billing'). */
export const AUDIT_ENTITY_GROUPS: Record<string, { label: string; entities: string[] }> = {
  reservation: { label: 'Reservas', entities: ['reservation'] },
  billing: { label: 'Facturación', entities: ['invoice', 'payment', 'payment_request', 'expense'] },
  auth: { label: 'Login / Logout', entities: ['auth', 'login', 'logout', 'session'] },
  configuration: { label: 'Configuración', entities: ['configuration', 'setting', 'room_rate', 'rate_restriction', 'season'] },
  user: { label: 'Usuarios', entities: ['user', 'role'] },
  hotel: { label: 'Hoteles', entities: ['hotel'] },
}

/** Entidad normalizada → grupo, invertido de AUDIT_ENTITY_GROUPS una sola vez. */
const GROUP_OF: Record<string, string> = Object.fromEntries(
  Object.entries(AUDIT_ENTITY_GROUPS).flatMap(([group, g]) => g.entities.map((e) => [e, group])),
)

/** Grupo de una entidad (cruda o ya normalizada): entityGroup('invoice') === 'billing'.
 * Una entidad desconocida es su propio grupo — mejor una opción extra que un filtro vacío.
 * Sin entidad → SYSTEM_GROUP, igual que la categoría "Sistema" de la tabla. */
export function entityGroup(entity: unknown): string {
  const key = normalizeEntity(entity)
  if (!key) return SYSTEM_GROUP
  return GROUP_OF[key] ?? key
}

/** Texto del <option>: label del grupo conocido, o la entidad humanizada
 * ('payment_request' → 'Payment request') para las que no tienen grupo. */
export function entityLabel(group: string): string {
  if (group === SYSTEM_GROUP) return 'Sistema'
  const known = AUDIT_ENTITY_GROUPS[group]
  if (known) return known.label
  const words = group.replace(/[_.\-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : group
}

export interface AuditFilterOption {
  /** Valor del <option> del filtro: el grupo, no la entidad. */
  value: string
  label: string
  /** Cuántos logs cargados caen en el grupo. */
  count: number
}

/** Opciones del select derivadas SOLO de los grupos presentes en los logs (mismo patrón que
 * statusOptions en super-admin/subscriptions.vue): si no hay logs de auth, 'auth' no aparece
 * y ninguna opción del desplegable devuelve la tabla vacía. Más frecuentes primero. */
export function auditFilterOptions(logs: ReadonlyArray<{ entity?: unknown }>): AuditFilterOption[] {
  const acc = new Map<string, number>()
  for (const log of logs) {
    const group = entityGroup(log?.entity)
    acc.set(group, (acc.get(group) ?? 0) + 1)
  }
  return [...acc.entries()]
    .map(([value, count]) => ({ value, label: entityLabel(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
