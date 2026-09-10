// anuncios/usecases/visibility-window.ts — Vigencia de un anuncio (ANN-3): desde/hasta.
//
// Funciones puras, sin service ni repositorio: el service las llama en create/update (validar
// la ventana) y en list (aplicarla). La regla de negocio es una sola y vive acá:
//
//   visible ⇔ (sin startsAt o startsAt <= now) y (sin endsAt o endsAt > now)
//
// Un anuncio sin fechas es visible siempre — los que ya existían no cambian de comportamiento.
//
// Por qué la ventana se aplica EN MEMORIA y no en SQL: `buildWhere` de arckode-framework sólo
// genera `campo = ?` por cada filtro (ver
// backend/node_modules/arckode-framework/kernel/db/orm-utils.ts:123-144), no hay `<=`, `>` ni
// `IS NULL`, y el módulo no recibe el DbAdapter crudo para escribir la consulta a mano. Así que
// list() trae las filas por igualdad como siempre, las pasa por `applyWindow` con el reloj del
// request y recién después pagina (`paginateInMemory`): el mismo patrón que
// subscriptions/usecases/status-of.ts usa para los descuentos con `endsAt` vencido.
import { ValidationError, AuthError } from 'arckode-framework'

/** Lo mínimo que la ventana necesita de una fila. */
export interface WindowFields {
  startsAt?: string | null
  endsAt?: string | null
}

export interface NormalizedWindow {
  startsAt: string | null
  endsAt: string | null
}

export type AnunciosScope = 'active' | 'all'

/**
 * Un valor de entrada → ISO normalizado o null. `undefined` significa "no vino en el body";
 * `null` y '' significan "borrar" (un `<input type="datetime-local">` vacío manda '').
 */
function normalizeDate(field: keyof NormalizedWindow, value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} debe ser una fecha ISO 8601 válida`, {
      [field]: ['fecha ISO 8601 inválida'],
    })
  }
  return new Date(value).toISOString()
}

/**
 * Valida y normaliza el par startsAt/endsAt de un create o un update.
 *
 * - create: `current` es undefined; lo que no viene queda null.
 * - update: `current` es la fila actual; un campo ausente (undefined) la conserva, `null`/''
 *   lo borra. Así un PATCH que sólo trae `endsAt` se valida contra el `startsAt` que ya está.
 *
 * Fecha no parseable o `endsAt <= startsAt` → ValidationError (400).
 */
export function normalizeWindow(
  input: { startsAt?: unknown; endsAt?: unknown },
  current?: WindowFields,
): NormalizedWindow {
  const startsIn = normalizeDate('startsAt', input.startsAt)
  const endsIn = normalizeDate('endsAt', input.endsAt)

  const startsAt = startsIn === undefined ? (current?.startsAt ?? null) : startsIn
  const endsAt = endsIn === undefined ? (current?.endsAt ?? null) : endsIn

  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new ValidationError('endsAt debe ser posterior a startsAt', {
      endsAt: ['debe ser posterior a startsAt'],
    })
  }

  return { startsAt, endsAt }
}

/** ¿Este anuncio está dentro de su ventana en `now`? Sin fechas → siempre. */
export function isVisibleAt(row: WindowFields, now: Date): boolean {
  const t = now.getTime()
  if (row.startsAt && Date.parse(row.startsAt) > t) return false
  if (row.endsAt && Date.parse(row.endsAt) <= t) return false
  return true
}

/** Programado: todavía no llegó su startsAt (para el panel: "Programación"). */
export function isScheduled(row: WindowFields, now: Date): boolean {
  return Boolean(row.startsAt) && Date.parse(row.startsAt as string) > now.getTime()
}

/** Las filas vigentes en `now`. Conserva el orden de entrada. */
export function applyWindow<T extends WindowFields>(rows: T[], now: Date): T[] {
  return rows.filter((row) => isVisibleAt(row, now))
}

/**
 * Qué alcance de listado corresponde. 'all' (sin ventana: programados y vencidos incluidos)
 * es sólo para super_admin — un hotel que lo pida recibe AuthError, no un 'active' silencioso,
 * para que el intento se note. Cualquier otro valor, o ninguno, es 'active'.
 */
export function resolveScope(requested: unknown, role: string): AnunciosScope {
  if (requested === 'all') {
    if (role !== 'super_admin') throw new AuthError('scope=all es solo para super_admin')
    return 'all'
  }
  return 'active'
}

export interface InMemoryPage<T> {
  data: T[]
  total: number
  page: number
  limit: number
  pages: number
}

/**
 * Paginación sobre filas ya filtradas. Como la ventana se resuelve en memoria, el total y las
 * páginas tienen que salir de las filas vigentes, no del COUNT de la tabla.
 */
export function paginateInMemory<T>(rows: T[], page: number, limit: number): InMemoryPage<T> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : rows.length || 1
  const total = rows.length
  // `pages` con la misma semántica que el paginate del ORM: 0 cuando no hay filas.
  const pages = Math.ceil(total / safeLimit)
  const safePage = Number.isFinite(page) && page > 0 ? Math.min(Math.floor(page), Math.max(1, pages)) : 1
  const start = (safePage - 1) * safeLimit
  return {
    data: rows.slice(start, start + safeLimit),
    total,
    page: safePage,
    limit: safeLimit,
    pages,
  }
}
