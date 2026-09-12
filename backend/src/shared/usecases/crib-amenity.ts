// shared/usecases/crib-amenity.ts — ¿esta amenidad personalizada de habitación ES la cuna? (#292)
//
// La cuna de una habitación es una fila `RoomAmenities` personalizada (`custom:<slug>`). El slug
// lo deriva el backend del NOMBRE que tipeó el hotel (`amenities/usecases/room-amenity-items.ts`),
// así que "Cuna" → `custom:cuna`, pero "Cuna para bebé" → `custom:cuna_para_bebe`, "Crib" →
// `custom:crib` y "Berço" → `custom:berco`. Comparar contra el literal `custom:cuna` dejaba a
// esos hoteles sin "¿Necesita cuna?" en el motor y sin `needsCrib` en la reserva, sin ningún
// error a la vista. Acá vive la ÚNICA regla de reconocimiento; nadie compara el literal a mano.
//
// Regla: es cuna toda key `custom:*` cuyo slug, o cuyo NOMBRE normalizado (sin acentos, en
// minúsculas), contenga `cuna`, `crib` o `berco` como palabra entera. "Cunas" o "Cribs" no
// cuentan (palabra distinta); "Cama cuna" sí. Espejo exacto en `frontend/src/utils/crib-amenity.ts`.
//
// `shared/` no es un módulo: importarlo desde un módulo NO viola la regla anti cross-módulo.

/** Key CANÓNICA con la que el motor PIDE la cuna (`needsCrib` → esta key entre las amenidades
 *  pedidas). Al resolver contra la unidad asignada se acepta cualquier fila que `isCribAmenityKey`
 *  reconozca (`custom:crib`, `custom:cuna_para_bebe`…), y la línea persistida conserva la key
 *  REAL de esa fila. Es también la sugerencia que ofrece el formulario de habitación del panel. */
export const CRIB_AMENITY_KEY = 'custom:cuna'

const CUSTOM_PREFIX = 'custom:'
/** Palabras que identifican una cuna (es / en / pt). Se comparan sobre texto normalizado. */
const CRIB_WORDS: ReadonlySet<string> = new Set(['cuna', 'crib', 'berco'])

/** Minúsculas, sin acentos (ç → c, é → e), partido en palabras alfanuméricas. */
function words(text: string): string[] {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * ¿La amenidad `key` (con su `name`, si se conoce) es una cuna? Sólo keys `custom:*`; una key
 * fija del catálogo (wifi, tv) nunca lo es. Con `name` ausente decide por el slug de la key
 * (es el caso de las keys que manda el widget en el body, que no traen nombre).
 */
export function isCribAmenityKey(key: unknown, name?: unknown): boolean {
  if (typeof key !== 'string' || !key.startsWith(CUSTOM_PREFIX)) return false
  const slugWords = words(key.slice(CUSTOM_PREFIX.length))
  if (slugWords.some((w) => CRIB_WORDS.has(w))) return true
  if (typeof name !== 'string' || !name.trim()) return false
  return words(name).some((w) => CRIB_WORDS.has(w))
}
