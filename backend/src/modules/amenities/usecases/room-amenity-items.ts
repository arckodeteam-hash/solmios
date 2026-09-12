// amenities/usecases/room-amenity-items.ts — amenidades personalizadas por habitación (#290).
//
// Lógica pura (sin repo): normaliza el `items` que manda el formulario de habitación y planifica
// el upsert contra las filas RoomAmenities existentes. Una amenidad personalizada es una fila con
// amenityKey `custom:<slug(nombre)>`, name y price >= 0; isActive es su estado/disponibilidad.
// Las keys fijas del catálogo siguen siendo features gratuitas (name '', price 0).

export const CUSTOM_PREFIX = 'custom:'
const CUSTOM_KEY_RE = /^custom:[a-z0-9_]{1,40}$/
const MAX_NAME = 80
const MAX_SLUG = 40

export function isCustomAmenityKey(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith(CUSTOM_PREFIX)
}

/** 'Cama extra' → 'cama_extra'. Minúsculas, sin acentos, [a-z0-9]+ unidos por `_`, máx 40 chars. */
export function slugifyAmenityName(name: string): string {
  return String(name ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos (é→e, ñ→n)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/_+$/g, '')
}

export function customKeyFor(name: string): string {
  return CUSTOM_PREFIX + slugifyAmenityName(name)
}

export interface RoomAmenityItemInput {
  key?: string
  name: string
  price?: number
  isActive?: boolean
}

export interface NormalizedItem {
  key: string
  name: string
  price: number
  isActive: boolean
}

type NormalizeResult = { items: NormalizedItem[] } | { error: string }

/** Precio 0 es válido (gratis). Negativo, NaN, Infinity o no numérico → error. */
function normalizePrice(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 0
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function normalizeRoomAmenityItems(raw: unknown): NormalizeResult {
  if (!Array.isArray(raw)) return { error: 'items debe ser un array' }
  const items: NormalizedItem[] = []
  const seen = new Set<string>()
  for (const it of raw as any[]) {
    if (!it || typeof it !== 'object') return { error: 'cada item debe ser un objeto' }
    const name = typeof it.name === 'string' ? it.name.trim() : ''
    if (!name) return { error: 'name es requerido' }
    if (name.length > MAX_NAME) return { error: `name debe tener como máximo ${MAX_NAME} caracteres` }
    const price = normalizePrice(it.price)
    if (price === null) return { error: 'price debe ser un número >= 0' }
    if (it.isActive !== undefined && typeof it.isActive !== 'boolean') return { error: 'isActive debe ser boolean' }
    const isActive = it.isActive === undefined ? true : it.isActive
    let key: string
    if (it.key !== undefined && it.key !== null && it.key !== '') {
      if (typeof it.key !== 'string' || !CUSTOM_KEY_RE.test(it.key)) return { error: `key inválida: debe ser custom:<slug> ([a-z0-9_], máx ${MAX_SLUG})` }
      key = it.key
    } else {
      key = customKeyFor(name)
      if (!CUSTOM_KEY_RE.test(key)) return { error: `name no genera una key válida: "${name}"` }
    }
    if (seen.has(key)) return { error: `key duplicada: ${key}` }
    seen.add(key)
    items.push({ key, name, price, isActive })
  }
  return { items }
}

const isOn = (v: unknown): boolean => v === true || v === 1 || v === '1'

export interface RoomAmenityUpsertPlan {
  deactivate: string[]
  reactivate: string[]
  create: Array<{ amenityKey: string; name: string; price: number; isActive: boolean }>
  update: Array<{ id: string; patch: { name: string; price: number; isActive: boolean } }>
  /** Keys con isActive true (fijas + custom): lo que va al socket → CSV Rooms.amenities. */
  activeKeys: string[]
}

/**
 * Semántica:
 * - fijas existentes que no vienen en `fixedKeys` → deactivate (como antes); las que vienen → reactivate/create.
 * - custom que viene en `items` → update si existe la key (name/price/isActive tal cual: una custom
 *   inactiva se CONSERVA para poder reactivarla) o create.
 * - custom existente que NO viene en `items` → deactivate (el hotel la quitó del form).
 * - `items` undefined (cliente viejo que manda sólo `amenities`) → las custom quedan como están.
 */
export function planRoomAmenityUpsert(existing: any[], fixedKeys: string[], items?: NormalizedItem[]): RoomAmenityUpsertPlan {
  const plan: RoomAmenityUpsertPlan = { deactivate: [], reactivate: [], create: [], update: [], activeKeys: [] }
  const fixed = Array.from(new Set(fixedKeys.filter((k) => typeof k === 'string' && k && !isCustomAmenityKey(k))))
  const byKey = new Map<string, any>()
  for (const ex of existing) if (ex?.amenityKey && !byKey.has(ex.amenityKey)) byKey.set(ex.amenityKey, ex)
  const itemKeys = new Set((items ?? []).map((i) => i.key))

  for (const ex of existing) {
    if (isCustomAmenityKey(ex.amenityKey)) {
      if (!items) { if (isOn(ex.isActive)) plan.activeKeys.push(ex.amenityKey); continue }
      if (!itemKeys.has(ex.amenityKey)) plan.deactivate.push(ex.id)
    } else if (!fixed.includes(ex.amenityKey)) {
      plan.deactivate.push(ex.id)
    }
  }
  for (const key of fixed) {
    const found = byKey.get(key)
    if (found) plan.reactivate.push(found.id)
    else plan.create.push({ amenityKey: key, name: '', price: 0, isActive: true })
    plan.activeKeys.push(key)
  }
  for (const it of items ?? []) {
    const found = byKey.get(it.key)
    const patch = { name: it.name, price: it.price, isActive: it.isActive }
    if (found) plan.update.push({ id: found.id, patch })
    else plan.create.push({ amenityKey: it.key, ...patch })
    if (it.isActive) plan.activeKeys.push(it.key)
  }
  return plan
}
