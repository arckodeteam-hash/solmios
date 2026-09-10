// anuncios/usecases/announcement-audience.ts — a quién le llega cada aviso (ANN-1).
//
// Un anuncio es GLOBAL cuando no tiene hotel (hotelId NULL o '' — las dos formas conviven en
// la base: el panel de plataforma crea con '' y las migraciones viejas dejaron NULL). Un global
// le llega a TODOS los hoteles; uno con hotel sólo al suyo. Antes `list()` filtraba por
// igualdad exacta (`hotelId = ?`) y los globales nunca salían del panel admin.
//
// Por qué se mezcla en memoria y no en el filtro: `buildWhere` del ORM (arckode-framework,
// kernel/db/orm-utils.ts) sólo genera `campo = ?` unidos con AND — no hay OR, IN ni IS NULL —
// y el proyecto no admite SQL crudo. Así que se pide la tabla vía repositorio (sin hotelId) y
// se filtra/pagina acá. Es el mismo patrón que el panel de plataforma, que ya trae la tabla
// entera en `admin/usecases/dashboard-queries.ts` (`listAnnouncements`): los anuncios son
// pocos por diseño (avisos operativos, no eventos), no vale una query por hotel.
import type { RepositoryAdapter, PageResult } from 'arckode-framework'
import type { AnunciosDTO } from '../types'

/** Global = sin hotel: NULL, undefined o '' (las tres formas están en la base). */
export function isGlobalAnnouncement(hotelId: unknown): boolean {
  return hotelId == null || hotelId === ''
}

/** El aviso le llega a `hotelId` si es global o es de ese mismo hotel. */
export function canSeeAnnouncement(item: { hotelId?: string | null }, hotelId: string | undefined): boolean {
  return isGlobalAnnouncement(item.hotelId) || item.hotelId === hotelId
}

/**
 * Página del listado para la audiencia de UN hotel: sus avisos más los globales.
 * `filters` NO debe traer hotelId (iría por igualdad y dejaría afuera a los globales);
 * el resto (type, priority, active) sí lo resuelve el repositorio. Devuelve la misma forma
 * que `repo.paginate` para que el service no distinga de dónde salió la página.
 */
export async function listForHotelAudience(
  repo: RepositoryAdapter<AnunciosDTO>,
  filters: Record<string, unknown>,
  hotelId: string,
  { offset, limit }: { offset: number; limit: number },
): Promise<PageResult<AnunciosDTO>> {
  const rows = await repo.findMany(filters)
  const visible = rows.filter((item) => canSeeAnnouncement(item, hotelId))
  const total = visible.length
  return {
    data: visible.slice(offset, offset + limit),
    total,
    limit,
    offset,
    pages: Math.ceil(total / limit),
  }
}
