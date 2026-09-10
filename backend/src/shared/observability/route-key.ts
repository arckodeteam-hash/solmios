// shared/observability/route-key.ts — normaliza un path HTTP para agregar métricas por ruta.
// Sin esto, /api/reservas/<uuid>/charges generaría una clave por reserva y el mapa de métricas
// crecería sin techo. Un segmento es variable si es UUID, ULID o sólo dígitos → se reemplaza por :id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i // 26 chars Crockford base32 (sin I, L, O, U)
const DIGITS_RE = /^\d+$/

function isVariableSegment(seg: string): boolean {
  return DIGITS_RE.test(seg) || UUID_RE.test(seg) || ULID_RE.test(seg)
}

/** `/api/reservas/9f8e.../charges?x=1` → `/api/reservas/:id/charges`. Rutas fijas quedan intactas. */
export function normalizeRouteKey(path: string): string {
  const withoutQuery = path.split('?')[0]!.split('#')[0]!
  if (!withoutQuery) return '/'
  return withoutQuery
    .split('/')
    .map((seg) => (seg && isVariableSegment(seg) ? ':id' : seg))
    .join('/')
}
