// plan-modules.ts — Builder del array plano `plans.modules` del editor de planes (/admin).
//
// Semántica (congelada en backend/src/modules/admin/usecases/modules.ts, el gate):
//  - clave PADRE listada = módulo COMPLETO (el gate expande padre→todos los submódulos, CS-1);
//  - SUB-clave listada sin su padre = SOLO esa parte (activación parcial, R3-2).
// El editor arma el array con esa forma exacta: padres para completo, sub-claves sueltas para
// parcial. NUNCA persiste padre+hijos redundantes: enumerar los hijos junto al padre congela
// la matriz y un submódulo NUEVO del catálogo dejaría de entrar solo (además de ser drift).
import type { CatalogModuleDTO } from '@/services/Platform.service'

export type PlanModules = string[]

/** ¿El plan incluye el módulo COMPLETO (clave padre en la matriz)? */
export function isFullModule(matrix: PlanModules, m: CatalogModuleDTO): boolean {
  return matrix.includes(m.key)
}

/**
 * Sub-claves sueltas de un módulo (en la matriz SIN el padre). En modo completo devuelve
 * vacío: los hijos van por el padre, no están "listados".
 */
export function looseChildren(matrix: PlanModules, m: CatalogModuleDTO): Set<string> {
  if (isFullModule(matrix, m)) return new Set()
  const set = new Set(matrix)
  return new Set(m.children.filter((c) => set.has(c.key)).map((c) => c.key))
}

/**
 * Toggle del padre:
 *  - NO completo → módulo COMPLETO: saca los hijos sueltos y deja SOLO la clave padre;
 *  - completo → destilda el padre dejando TODOS los hijos sueltos: el estado efectivo no
 *    cambia (seguían incluidos por el padre) y habilita destildarlos de a uno = parcial.
 */
export function toggleModule(matrix: PlanModules, m: CatalogModuleDTO): PlanModules {
  if (isFullModule(matrix, m)) {
    const childKeys = m.children.map((c) => c.key)
    return [...new Set([...matrix.filter((k) => k !== m.key), ...childKeys])]
  }
  const children = new Set(m.children.map((c) => c.key))
  return [...new Set([...matrix.filter((k) => k !== m.key && !children.has(k)), m.key])]
}

/**
 * Toggle de un submódulo: SOLO en modo parcial (padre no completo). Con el padre tildado los
 * hijos van por el padre — destildar uno suelto requiere destildar el padre primero (no-op).
 */
export function toggleChild(matrix: PlanModules, m: CatalogModuleDTO, childKey: string): PlanModules {
  if (isFullModule(matrix, m)) return matrix
  const set = new Set(matrix)
  if (set.has(childKey)) set.delete(childKey)
  else set.add(childKey)
  return [...set]
}

/** "Todo" = todos los módulos completos (solo claves padre — los hijos entran por expansión). */
export function selectAllModules(catalog: CatalogModuleDTO[]): PlanModules {
  return catalog.map((m) => m.key)
}

/** "Ninguno" = matriz vacía. OJO retrocompat: un plan SIN matriz incluye TODO (se avisa en UI). */
export function selectNoModules(): PlanModules {
  return []
}

/** Total de claves del catálogo (padres + submódulos) — denominador del "N de M". */
export function totalCatalogKeys(catalog: CatalogModuleDTO[]): number {
  return catalog.reduce((n, m) => n + 1 + m.children.length, 0)
}

/**
 * Claves EFECTIVAS incluidas (numerador del "N de M"): misma expansión que el gate —
 * un padre cuenta él + todos sus submódulos; sin padre, cuentan solo los hijos listados.
 */
export function effectiveCount(matrix: PlanModules, catalog: CatalogModuleDTO[]): number {
  const set = new Set(matrix)
  let n = 0
  for (const m of catalog) {
    if (set.has(m.key)) n += 1 + m.children.length
    else n += m.children.filter((c) => set.has(c.key)).length
  }
  return n
}
