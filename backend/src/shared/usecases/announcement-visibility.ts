// shared/usecases/announcement-visibility.ts — Quién ve qué anuncio, y cuándo.
//
// Reglas puras, sin base de datos ni caché: son las únicas que deciden si un mensaje del dueño de
// la plataforma llega o no llega a un hotel. Que sean funciones puras es lo que permite
// verificarlas caso por caso, sin levantar nada.
//
// Vive en `shared` y no dentro del módulo `anuncios` porque las usan DOS módulos: `anuncios` para
// decidir qué entrega, y `admin` para contar destinatarios en la tasa de apertura. Un módulo no
// importa de otro (regla del proyecto): lo común va acá.

/** A quién va dirigido el anuncio. Espeja `anuncios/types.ts`. */
export type AnnouncementAudience = 'hotel' | 'all' | 'admins'

/** Roles que reciben un anuncio dirigido a administradores. */
export const ADMIN_ROLES = new Set(['hotel_admin', 'super_admin'])

/** Lo mínimo que hace falta saber del anuncio para decidir. */
export interface VisibilityRow {
  hotelId?: string | null
  audience?: string | null
  startsAt?: string | null
  endsAt?: string | null
  active?: number | boolean | null
}

export interface Viewer {
  role: string
  hotelId?: string | null
}

/**
 * Audiencia efectiva de una fila.
 *
 * Las filas anteriores a la columna `audience` la tienen nula. Se deducen: si tienen hotel son
 * de ese hotel, y si no lo tienen eran anuncios de plataforma (que hasta ahora no veía nadie).
 * Esta deducción NO reemplaza al backfill (`scripts/backfill-announcement-audience.ts`): una fila
 * con `audience` nulo tampoco aparece en las consultas, porque el ORM filtra por igualdad.
 */
export function effectiveAudience(row: VisibilityRow): AnnouncementAudience {
  const a = row.audience
  if (a === 'all' || a === 'hotel' || a === 'admins') return a
  return row.hotelId ? 'hotel' : 'all'
}

/** Un anuncio es de plataforma cuando no está atado a ningún hotel. */
export function isPlatformWide(row: VisibilityRow): boolean {
  return !row.hotelId
}

/**
 * ¿Este usuario debe recibir este anuncio?
 *
 * Reglas, en orden:
 *  - `hotel`  → solo el hotel indicado.
 *  - `all`    → todos los hoteles; si además trae `hotelId`, solo ese.
 *  - `admins` → igual que `all`, pero únicamente para roles administradores.
 *
 * El aislamiento entre hoteles manda sobre la audiencia: un anuncio con `hotelId` NUNCA sale de
 * ese hotel, cualquiera sea su `audience`.
 */
export function isVisibleFor(row: VisibilityRow, viewer: Viewer): boolean {
  const audience = effectiveAudience(row)

  if (audience === 'hotel') {
    return !!row.hotelId && row.hotelId === viewer.hotelId
  }

  if (row.hotelId && row.hotelId !== viewer.hotelId) return false
  if (audience === 'admins' && !ADMIN_ROLES.has(viewer.role)) return false
  return true
}

/**
 * ¿Está dentro de su ventana de vigencia?
 *
 * Una fecha que no parsea se ignora en vez de esconder el anuncio: un dato mal cargado no puede
 * silenciar un aviso que el hotel debería estar viendo.
 */
export function isWithinWindow(row: VisibilityRow, now: Date = new Date()): boolean {
  const t = now.getTime()

  if (row.startsAt) {
    const starts = Date.parse(row.startsAt)
    if (!Number.isNaN(starts) && starts > t) return false
  }
  if (row.endsAt) {
    const ends = Date.parse(row.endsAt)
    if (!Number.isNaN(ends) && ends < t) return false
  }
  return true
}

/** `active` viaja como 1/0 desde SQLite y como boolean desde algunos drivers. */
export function isActive(row: VisibilityRow): boolean {
  return row.active === 1 || row.active === true
}

/**
 * Orden del listado: lo más reciente primero, por `date` y con `createdAt` de respaldo (las filas
 * viejas pueden no tener `date`). Desempate por `id` para que dos llamadas devuelvan lo mismo.
 */
export function byRecencyDesc(
  a: { id: string; date?: string; createdAt?: string },
  b: { id: string; date?: string; createdAt?: string },
): number {
  const ta = Date.parse(String(a.date ?? a.createdAt ?? '')) || 0
  const tb = Date.parse(String(b.date ?? b.createdAt ?? '')) || 0
  if (tb !== ta) return tb - ta
  return String(a.id).localeCompare(String(b.id))
}

/** Quita repetidos conservando el primero: un anuncio puede venir de dos consultas distintas. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}
