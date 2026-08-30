// public-plans.ts — Qué planes ve, y en qué orden, alguien que todavía no es cliente.
//
// Son los dos únicos criterios de esta pantalla: qué se muestra hacia afuera (sin `limits`
// ni `modules`, que son detalle interno de cómo se aplica el plan) y en qué orden. El orden
// (#30) lo decide acá — del más barato al más caro, `shared/utils/plans-order.ts` — y el
// frontend lo respeta tal cual — no re-ordena.
import type { RepositoryAdapter } from 'arckode-framework'
import { PLANS_PRICE_ORDER } from '../../../shared/utils/plans-order'

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
 * Planes activos para la landing y el registro, ya ordenados y recortados a lo público.
 *
 * #30: la base sale de la QUERY (`orderBy` price ASC, slug ASC — `PLANS_PRICE_ORDER`), no de
 * un `sort` en JS. Antes mandaba `sortOrder`, que se carga a mano desde /admin y en producción
 * dejó la landing como Host $29 → Starter $49 → Enterprise $199 → Professional $123 →
 * Essential $99 → Ultra $0; con precio como clave natural la progresión de los planes con
 * precio es siempre de menor a mayor. `sortOrder` ya no ordena nada.
 *
 * Reversión de pedido del cliente sobre #30: un plan a cotización (`price <= 0`, se pinta como
 * texto — "A cotización"/"Consultar" — nunca como número) con precio ASC salía PRIMERO porque
 * $0 es el mínimo. El cliente lo quiere al final: comparar precios recién tiene sentido entre
 * los planes que sí muestran un número, y los "a cotización" son la salida de escape para el
 * que no encaja en la grilla, no la puerta de entrada. Se arma en dos grupos manteniendo el
 * price ASC / slug ASC de la query dentro de cada uno: primero los planes con precio, al final
 * los que van a cotización.
 */
export async function listPublicPlans(plansRepo: RepositoryAdapter<any>): Promise<PublicPlan[]> {
  const plans = await plansRepo.findMany({ isActive: 1 }, { orderBy: PLANS_PRICE_ORDER })
  const mapped = plans.map((p: Record<string, any>) => ({
    id: p.id, name: p.name, slug: p.slug, price: p.price,
    currency: p.currency, description: p.description, features: p.features ?? [],
    limits: publicLimits(p.limits),
  }))
  const priced = mapped.filter((p) => p.price > 0)
  const quoted = mapped.filter((p) => p.price <= 0)
  return [...priced, ...quoted]
}
