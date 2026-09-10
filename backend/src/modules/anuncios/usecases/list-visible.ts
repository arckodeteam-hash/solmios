// anuncios/usecases/list-visible.ts — Qué anuncios recibe cada quien.
//
// Acá vive el arreglo del bug de fondo: el listado filtraba `hotelId = <hotel>` por IGUALDAD, y un
// anuncio de plataforma se guarda sin hotelId. `NULL` no matchea nunca, así que el mensaje del
// dueño de la plataforma no le llegaba a NINGÚN hotel.
//
// El ORM del framework solo sabe filtrar por igualdad (`kernel/db/orm-utils.ts:buildWhere`): no hay
// `OR`, ni `IN`, ni `IS NULL`. Por eso los anuncios de plataforma se buscan por `audience` —una
// columna que SIEMPRE tiene valor y por lo tanto sí es consultable— y por eso la unión de "lo mío"
// con "lo de plataforma" se arma en memoria. La alternativa era SQL crudo en el service, prohibido
// por las reglas del proyecto.

import type { RepositoryAdapter } from 'arckode-framework'
import type { AnnouncementAudience, AnunciosDTO, AnunciosPaginated, AnunciosScope } from '../types'
import {
  ADMIN_ROLES, byRecencyDesc, dedupeById, isActive, isVisibleFor, isWithinWindow,
} from '../../../shared/usecases/announcement-visibility'

export interface ListContext {
  isSuper: boolean
  /** Hotel del usuario (o el pedido por el super_admin en `?hotelId=`). */
  hotelId?: string
  queryHotelId?: string
  role: string
  scope: AnunciosScope
  page: number
  limit: number
}

/**
 * Anuncios de PLATAFORMA. `admins` solo se consulta para quien puede recibirlo: no tiene sentido
 * traer al proceso el texto de un aviso que después se va a descartar por rol.
 */
async function fetchPlatformWide(
  repo: RepositoryAdapter<AnunciosDTO>,
  base: Record<string, unknown>,
  viewerRole: string,
): Promise<AnunciosDTO[]> {
  const audiences: AnnouncementAudience[] = ADMIN_ROLES.has(viewerRole) ? ['all', 'admins'] : ['all']
  const batches = await Promise.all(audiences.map((audience) => repo.findMany({ ...base, audience })))
  return batches.flat()
}

/** Candidatos antes de aplicar visibilidad y vigencia. */
async function fetchCandidates(
  repo: RepositoryAdapter<AnunciosDTO>,
  base: Record<string, unknown>,
  ctx: ListContext,
): Promise<AnunciosDTO[]> {
  if (ctx.isSuper && !ctx.queryHotelId) return repo.findMany(base)

  const target = ctx.isSuper ? ctx.queryHotelId : ctx.hotelId
  const [own, platform] = await Promise.all([
    repo.findMany({ ...base, hotelId: target }),
    fetchPlatformWide(repo, base, ctx.role),
  ])
  return dedupeById([...own, ...platform])
}

export async function listVisibleAnuncios(
  repo: RepositoryAdapter<AnunciosDTO>,
  base: Record<string, unknown>,
  ctx: ListContext,
  now: Date = new Date(),
): Promise<AnunciosPaginated> {
  const candidates = await fetchCandidates(repo, base, ctx)
  const viewerHotel = ctx.isSuper ? (ctx.queryHotelId ?? null) : ctx.hotelId

  const visible = candidates.filter((row) => {
    // El super_admin administra: ve todo lo que pidió, sin recorte por audiencia — salvo que haya
    // pedido un hotel concreto, en cuyo caso ve lo que vería ese hotel.
    if (!ctx.isSuper && !isVisibleFor(row, { role: ctx.role, hotelId: viewerHotel })) return false
    if (ctx.isSuper && ctx.queryHotelId && !isVisibleFor(row, { role: 'hotel_admin', hotelId: ctx.queryHotelId })) return false
    if (ctx.scope === 'all') return true
    return isActive(row) && isWithinWindow(row, now)
  })

  const ordered = visible.sort(byRecencyDesc)
  const offset = (ctx.page - 1) * ctx.limit
  return {
    data: ordered.slice(offset, offset + ctx.limit),
    total: ordered.length,
    page: ctx.page,
    limit: ctx.limit,
    pages: Math.ceil(ordered.length / ctx.limit),
  }
}
