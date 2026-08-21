// public-plans.ts — Qué planes ve, y en qué orden, alguien que todavía no es cliente.
//
// Son los dos únicos criterios de esta pantalla: qué se muestra hacia afuera (sin `limits`
// ni `modules`, que son detalle interno de cómo se aplica el plan) y en qué orden. El orden
// se decide acá y el frontend lo respeta tal cual — no re-ordena.
import type { RepositoryAdapter } from 'arckode-framework'

/** Topes del plan que SÍ son públicos: es lo que el visitante compara al elegir. */
export interface PublicPlanLimits {
  rooms?: number
  users?: number
  /** El servidor ya leyó el centinela: la vista no tiene que conocer el 9999 (CFG-2). */
  roomsUnlimited?: boolean
}

/**
 * Lo que se expone públicamente de un plan. Sin `modules` (ése sí es detalle interno de cómo se
 * aplica el plan), pero CON los topes.
 *
 * CFG-1: los topes NO salían del backend y el frontend los tenía hardcodeados en
 * `PlanCatalog.service.ts` — y CONTRADECÍAN la tabla: starter decía "Hasta 50 habitaciones" contra
 * `{rooms:30}`, enterprise "Hasta 200" contra `{rooms:9999}`. Es el mismo patrón que GH-31 cerró
 * para el precio: el dato del plan sale de `plans`, nunca de un literal en el template.
 */
export interface PublicPlan {
  id: string
  name: string
  slug: string
  price: number
  currency: string
  description: string
  features: unknown[]
  limits: PublicPlanLimits
}

/**
 * CFG-2: valor de `plans.limits.rooms` con el que el seed representa "sin tope"
 * (`backend/scripts/create-plans-table.ts`: enterprise y ultra van con 9999). Vive ACÁ, del lado
 * del que emite el dato — el frontend tenía su propia copia del 9999 y bastaba subir el seed a
 * 99999 para que la landing empezara a decir "Hasta 9999 habitaciones".
 */
export const UNLIMITED_LIMIT_SENTINEL = 9999

/**
 * `plans.limits` se guarda como JSON (string en la columna, objeto si el ORM ya lo parseó).
 * Se recorta a lo público: `rooms`/`users` + `roomsUnlimited`, que es la LECTURA del centinela ya
 * hecha por el servidor. Cualquier otra cosa se descarta, y un JSON roto no puede tumbar la
 * landing — devuelve `{}` y la vista muestra su copy de reserva.
 */
export function publicLimits(raw: unknown): PublicPlanLimits {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return {} }
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const src = parsed as Record<string, unknown>
  const out: PublicPlanLimits = {}
  const rooms = Number(src.rooms)
  const users = Number(src.users)
  if (Number.isFinite(rooms)) {
    out.rooms = rooms
    out.roomsUnlimited = rooms >= UNLIMITED_LIMIT_SENTINEL
  }
  if (Number.isFinite(users)) out.users = users
  return out
}

/**
 * Número usable para ordenar, venga como venga de la base.
 *
 * El modelo declara `price`/`sortOrder` como `number` y el ORM los coerce al leer
 * (`orm-utils.ts` → `Number(v)`), pero esa coerción solo cubre el camino feliz: deja pasar
 * `null`/`undefined` intactos y convierte a `NaN` cualquier texto no numérico. Un `NaN` en el
 * comparador es peor que un valor faltante — hace que el resultado del `sort` dependa del orden
 * de entrada. Acá todo lo que no sea un número finito colapsa a `fallback`.
 */
export function orderableNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Orden de los planes en la landing y en la pantalla de suscripción: `sortOrder`, y a igualdad
 * el precio de menor a mayor.
 *
 * `sortOrder` se carga a mano desde /admin, así que se repite o queda vacío con facilidad. Sin
 * desempate, esos empates dejaban el orden en manos de la base (arbitrario), y eso fue lo que se
 * vio en producción: Host $29 → Starter $49 → Enterprise $199 → Professional $123 → Essential $99
 * → Ultra $0. El precio como segunda clave hace que un `sortOrder` mal cargado degrade a una
 * progresión comprensible en vez de a ruido; el nombre como tercera cierra el orden total, para
 * que dos planes idénticos en ambas claves no se intercambien entre requests.
 *
 * `sortOrder` faltante cae a 0 (el mismo default del modelo, así convive con los ya cargados);
 * un precio faltante cae a 0 y el plan queda primero, que es donde se nota y se corrige.
 */
/** Lo mínimo que el comparador necesita de una fila de `plans`. */
export interface SortablePlan {
  sortOrder?: unknown
  price?: unknown
  name?: unknown
}

export function comparePublicPlans(a: SortablePlan | null | undefined, b: SortablePlan | null | undefined): number {
  const bySort = orderableNumber(a?.sortOrder, 0) - orderableNumber(b?.sortOrder, 0)
  if (bySort !== 0) return bySort
  const byPrice = orderableNumber(a?.price, 0) - orderableNumber(b?.price, 0)
  if (byPrice !== 0) return byPrice
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''))
}

/** Planes activos para la landing y el registro, ya ordenados y recortados a lo público. */
export async function listPublicPlans(plansRepo: RepositoryAdapter<any>): Promise<PublicPlan[]> {
  const plans = await plansRepo.findMany({ isActive: 1 })
  // Copia antes de ordenar: `sort` muta, y el array puede venir de una caché del repo.
  return [...plans]
    .sort(comparePublicPlans)
    .map((p: Record<string, any>) => ({
      id: p.id, name: p.name, slug: p.slug, price: p.price,
      currency: p.currency, description: p.description, features: p.features ?? [],
      limits: publicLimits(p.limits),
    }))
}
