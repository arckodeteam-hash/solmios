// utils/crib-amenity.ts — ¿esta amenidad personalizada de habitación ES la cuna? (#292)
//
// Espejo EXACTO de `backend/src/shared/usecases/crib-amenity.ts`: la cuna es una fila
// `RoomAmenities` personalizada cuyo slug lo deriva el backend del NOMBRE que tipeó el hotel —
// "Cuna" → `custom:cuna`, pero "Cuna para bebé" → `custom:cuna_para_bebe`, "Crib" → `custom:crib`,
// "Berço" → `custom:berco`. Comparar contra el literal dejaba a esos hoteles sin "¿Necesita cuna?".
// Regla: key `custom:*` cuyo slug, o cuyo nombre normalizado (sin acentos, minúsculas), contenga
// `cuna`, `crib` o `berco` como palabra entera. Nadie compara `'custom:cuna'` a mano.

/** Key CANÓNICA de la cuna: la sugerencia "+ Cuna" del formulario de habitación y la que el
 *  backend usa para PEDIRLA; al resolver acepta cualquier fila que `isCribAmenityKey` reconozca. */
export const CRIB_AMENITY_KEY = 'custom:cuna'

const CUSTOM_PREFIX = 'custom:'
const CRIB_WORDS: ReadonlySet<string> = new Set(['cuna', 'crib', 'berco'])

function words(text: string): string[] {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Sólo keys `custom:*`; con `name` ausente decide por el slug de la key. */
export function isCribAmenityKey(key: unknown, name?: unknown): boolean {
  if (typeof key !== 'string' || !key.startsWith(CUSTOM_PREFIX)) return false
  if (words(key.slice(CUSTOM_PREFIX.length)).some((w) => CRIB_WORDS.has(w))) return true
  if (typeof name !== 'string' || !name.trim()) return false
  return words(name).some((w) => CRIB_WORDS.has(w))
}
