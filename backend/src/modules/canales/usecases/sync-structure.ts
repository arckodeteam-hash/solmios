// canales/usecases/sync-structure.ts — Qué crear, qué actualizar y qué BORRAR en cada sync.
//
// El sync de estructura (property → room types → rate plans) borraba y recreaba TODO cada vez que
// corría sobre una property que ya existía. Los UUIDs cambiaban en cada corrida, y con ellos se caía
// lo único que los referencia del otro lado: el MAPEO del canal. Verificado contra staging el
// 2026-09-02 sobre la property de certificación: canal con 4 rate plans mapeados → un `POST
// /api/channels/sync` → los 4 rate plans con UUID nuevo y el canal con **0 mapeos**, todavía
// marcado "activo". Nadie se entera: el canal sigue verde y deja de publicar.
//
// Para la certificación es un veto: el test 1 ES un full sync, y detrás vienen los 13 que empujan
// ARI sobre ese mismo canal.
//
// Acá vive la decisión (pura, testeable); el HTTP lo hace `channex.ts`. La regla es por TÍTULO,
// que es la identidad estable de un room type / rate plan del lado del PMS:
//   - está en Channex y lo queremos  → UPDATE (mismo UUID, el mapeo sobrevive)
//   - no está                        → CREATE
//   - está y ya no lo queremos       → DELETE (un tipo borrado en el PMS no puede seguir vendiéndose)
//
// Los rate plans DERIVADOS (los que Channex crea al mapear un canal: "double BAR - OpenChannel …",
// con `relationships.parent_rate_plan`) no son nuestros: no se actualizan ni se borran nunca.
// Borrarlos era justamente parte de lo que rompía el canal.

/** Una option de rate plan (una ocupación y su precio por defecto), con el precio en CENTAVOS. */
export interface ChannexOption {
  occupancy: number
  rate: number
}

/** Un room type / rate plan tal como vuelve de la API de Channex, reducido a lo que decide el diff. */
export interface ChannexItem {
  id: string
  title: string
  /** Solo rate plans: el room type al que cuelga. */
  roomTypeId?: string
  /** Solo rate plans: copia que Channex creó para un canal. Intocable. */
  derived?: boolean
  /** Solo rate plans: ocupaciones publicadas y su precio por defecto. */
  options?: ChannexOption[]
}

export interface StructurePlan<T> {
  create: T[]
  update: Array<{ id: string; item: T }>
  remove: ChannexItem[]
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()

/**
 * Diff por título entre lo que el PMS quiere publicar y lo que hay en Channex.
 *
 * Un título repetido en Channex (basura de una corrida vieja) resuelve al primero y manda el resto
 * a `remove`: dos rate plans con el mismo nombre son ambiguos para el mapeo del canal.
 */
export function planStructure<T extends { title: string }>(
  desired: T[],
  existing: ChannexItem[],
): StructurePlan<T> {
  const plan: StructurePlan<T> = { create: [], update: [], remove: [] }
  const taken = new Set<string>()
  const byTitle = new Map<string, ChannexItem[]>()
  for (const item of existing) {
    const list = byTitle.get(norm(item.title)) ?? []
    list.push(item)
    byTitle.set(norm(item.title), list)
  }

  for (const item of desired) {
    const hit = byTitle.get(norm(item.title))?.[0]
    if (hit) {
      taken.add(hit.id)
      plan.update.push({ id: hit.id, item })
    } else {
      plan.create.push(item)
    }
  }
  for (const item of existing) {
    if (!taken.has(item.id)) plan.remove.push(item)
  }
  return plan
}

/** Room types de Channex → lo que mira el diff. */
export function parseRoomTypes(raw: any[]): ChannexItem[] {
  return (raw ?? []).map((rt: any) => ({ id: String(rt?.id ?? ''), title: String(rt?.attributes?.title ?? rt?.title ?? '') }))
    .filter((rt) => !!rt.id)
}

/**
 * Rate plans de Channex → lo que mira el diff, marcando los derivados.
 *
 * `parent_rate_plan` llega SOLO en `relationships` (en `attributes` viene `null` incluso para las
 * copias de canal — verificado contra staging), así que el flag se lee de ahí.
 */
export function parseRatePlans(raw: any[]): ChannexItem[] {
  return (raw ?? []).map((rp: any) => ({
    id: String(rp?.id ?? ''),
    title: String(rp?.attributes?.title ?? rp?.title ?? ''),
    roomTypeId: String(rp?.attributes?.room_type_id ?? rp?.relationships?.room_type?.data?.id ?? ''),
    derived: !!(rp?.relationships?.parent_rate_plan?.data?.id ?? rp?.attributes?.parent_rate_plan_id),
    // Channex devuelve el precio en unidades ("100.00"); adentro se trabaja en centavos.
    options: (rp?.attributes?.options ?? []).map((o: any) => ({
      occupancy: Number(o?.occupancy) || 0,
      rate: Math.round(Number(o?.rate ?? 0) * 100),
    })),
  })).filter((rp) => !!rp.id)
}

/**
 * ¿Hace falta reescribir las options de un rate plan que ya existe?
 *
 * Sí cuando cambió la capacidad del tipo (otras ocupaciones) o el precio base del hotel. Se
 * pregunta porque un PUT con options nuevas reemplaza las que están —y de ahí cuelgan las
 * `derived_option` de los canales mapeados—: no se toca si no cambió nada.
 */
export function optionsChanged(existing: ChannexOption[] | undefined, desired: ChannexOption[]): boolean {
  const key = (list: ChannexOption[]) => list.map((o) => `${o.occupancy}:${o.rate}`).sort().join('|')
  return key(existing ?? []) !== key(desired)
}
